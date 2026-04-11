import { FinalSignal, StrategyContext } from '../core/types/bot-types.js';
import { config } from '../config/index.js';
import * as ccxt from 'ccxt';
import { logger } from '../core/utils/logger.js';
import { SignalDirection } from '../core/constants/enums.js';
import { telegramNotifier } from '../notifications/telegram/telegram-notifier.js';
import { Strategy } from '../strategies/base/strategy.js';
import { universeLoader } from '../market/universe/universe-loader.js';
import { COMBO_DEFINITIONS } from '../strategies/combination-engine.js';
import { statsService } from '../stats/stats-service.js';

interface PaperTrade {
    id: string;
    symbol: string;
    direction: SignalDirection;
    entryPrice: number;
    sl: number;
    tp: number[];            // All 4 TP levels
    tpHit: number;           // How many TPs already hit (0-4)
    remainingPortion: number; // 1.0 = full position, 0.75/0.50/0.25/0 after each TP
    leverage: number;
    accumulatedPnl: number;  // Running total of realized PnL from partial closes
    timestamp: number;
    strategyName: string;
    history: string[];       // Step-by-step trade log for notifications
    status: 'PENDING' | 'ACTIVE'; // Pending for limit orders, active once filled
    expireAt: number;        // Timestamp (ms) when a pending order should be cancelled
    orderType: 'MARKET' | 'LIMIT';
    dcaCount: number;        // How many times this position has been averaged down (max 1 usually)
}

interface LeverageConfig {
    mode: 'dynamic' | 'fixed';
    fixedValue: number;
    minValue: number;
    maxValue: number;
}

// Key: "SYMBOL:STRATEGY_NAME", Value: timestamp of last SL hit
type SlCooldownMap = Map<string, number>;

const SL_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown after a stop-loss

function getTimestamp(): string {
    return `[${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })}]`;
}
export class TradeExecutor {
    private exchange: ccxt.Exchange | null = null;
    private isLive: boolean = config.exchangeId === 'mexc' ? config.mexc.isLiveMode : config.binance.isLiveMode;
    private activeTrades: PaperTrade[] = [];
    private todaysPnlPercent: number = 0;
    private strategyStats: Record<string, { win: number, loss: number, pnl: number }> = {};
    private disabledStrategies: Set<string> = new Set();
    private slCooldown: SlCooldownMap = new Map();
    private targetRiskPercent: number = config.bot.targetRiskPercent; // By default risk from config percentage of balance
    private leverageConfig: LeverageConfig = { mode: 'dynamic', fixedValue: 20, minValue: 1, maxValue: 50 }; // increased max for tiny SMC SLs
    private registeredStrategies: Strategy[] = [];

    /**
     * Initializes the auto-trading subsystem
     */
    async init(strategies: Strategy[]) {
        this.registeredStrategies = strategies;
        const exchangeId = config.exchangeId;
        const exConfig = exchangeId === 'mexc' ? config.mexc : config.binance;

        if (this.isLive) {
            if (!exConfig.apiKey || !exConfig.apiSecret) {
                logger.error(`${exchangeId.toUpperCase()} API Key or Secret missing! Reverting to Paper Trading.`);
                this.isLive = false;
            } else {
                try {
                    const options: any = {
                        apiKey: exConfig.apiKey,
                        secret: exConfig.apiSecret,
                        options: { defaultType: 'swap' } // Essential for MEXC and Binance Futures
                    };
                    
                    if (exchangeId === 'mexc') {
                        this.exchange = new ccxt.mexc(options);
                    } else {
                        this.exchange = new ccxt.binance(options);
                    }
                    
                    logger.info(`Live Trading enabled on ${exchangeId.toUpperCase()}.`);
                } catch (err: any) {
                    logger.error(`Failed to initialize CCXT ${exchangeId} client`, { error: err.message });
                    this.isLive = false;
                }
            }
        } else {
            logger.info('Paper Trading mode active (simulated).');
        }
        logger.info('Trade Executor initialized. Status: ' + (this.isLive ? 'LIVE' : 'PAPER TRADING') + ` (${exchangeId.toUpperCase()})`);

        // ─── 📊 Статистика ───
        telegramNotifier.onCommand(/(\/stats|📊 Статистика)/, () => {
            const status = this.isLive ? 'LIVE' : 'PAPER TRADING';
            const sign = this.todaysPnlPercent > 0 ? '+' : '';
            
            const strategyBreakdown = Object.entries(this.strategyStats)
                .sort((a, b) => b[1].pnl - a[1].pnl)
                .map(([name, s]) => {
                    const sSign = s.pnl > 0 ? '+' : '';
                    const winrate = s.win + s.loss > 0 ? ((s.win / (s.win + s.loss)) * 100).toFixed(0) : '0';
                    const disabled = this.disabledStrategies.has(name) ? ' 🚫' : '';
                    return `• <b>${name}</b>${disabled}: ${sSign}${s.pnl.toFixed(2)}% (W:${s.win} L:${s.loss} ${winrate}%)`;
                }).join('\n');
            const stratMsg = strategyBreakdown ? `\n\n🎯 <b>Strategy Performance:</b>\n${strategyBreakdown}` : '';

            const levInfo = this.leverageConfig.mode === 'fixed'
                ? `x${this.leverageConfig.fixedValue} (fixed)`
                : `x${this.leverageConfig.minValue}-${this.leverageConfig.maxValue} (dynamic)`;

            const activePositions = this.activeTrades.filter(t => t.status === 'ACTIVE');
            const pendingOrders = this.activeTrades.filter(t => t.status === 'PENDING');

            const msg = `📊 <b>Bot Statistics</b>
🤖 <b>Status:</b> ${status}
💰 <b>Total PnL Today:</b> ${sign}${this.todaysPnlPercent.toFixed(2)}%
📐 <b>Leverage:</b> ${levInfo}${stratMsg}

📍 <b>Active Positions:</b> ${activePositions.length}
${activePositions.map(t => `- <b>${t.symbol}</b> ${t.direction} (Entry: ${t.entryPrice.toFixed(4)})`).join('\n') || '<i>None</i>'}

⏳ <b>Pending Limit Orders:</b> ${pendingOrders.length}
${pendingOrders.map(t => `- <b>${t.symbol}</b> ${t.direction} (Limit: ${t.entryPrice.toFixed(4)})`).join('\n') || '<i>None</i>'}`;
            telegramNotifier.sendTextMessage(msg);
        });

        // ─── ⚙️ Стратегии ───
        telegramNotifier.onCommand(/(\/strategies|⚙️ Стратегии)/, () => {
            const lines = this.registeredStrategies.map(s => {
                const disabled = this.disabledStrategies.has(s.name);
                return `${disabled ? '🔴' : '🟢'} <b>${s.name}</b> [${s.id}]`;
            });
            const msg = `⚙️ <b>Strategy Manager</b>

${lines.join('\n')}

<i>To toggle, send:</i>
<code>/toggle StrategyName</code>
<i>Example:</i> <code>/toggle EMA Pullback</code>`;
            telegramNotifier.sendTextMessage(msg);
        });

        // ─── 🧩 Комбо ───
        telegramNotifier.onCommand(/(\/combos|🧩 Комбо)/, () => {
            const lines = COMBO_DEFINITIONS.map(c => {
                const reqStrats = c.requiredStrategies.join(', ');
                return `🔹 <b>${c.name}</b>\n└ <i>Requires ${c.minMatch} of:</i> ${reqStrats}`;
            });
            const msg = `🧩 <b>Combo Strategies</b>\n\n${lines.join('\n\n')}\n\n<i>Combos trigger automatically when their constituent strategies align, offering higher confidence signals.</i>`;
            telegramNotifier.sendTextMessage(msg);
        });

        // ─── /toggle StrategyName ───
        telegramNotifier.onCommand(/\/toggle (.+)/, (_msg: any, match: any) => {
            const name = match[1].trim();
            if (this.disabledStrategies.has(name)) {
                this.disabledStrategies.delete(name);
                telegramNotifier.sendTextMessage(`🟢 Strategy <b>${name}</b> is now <b>ENABLED</b>`);
                logger.info(`Strategy "${name}" enabled via Telegram`);
            } else {
                this.disabledStrategies.add(name);
                telegramNotifier.sendTextMessage(`🔴 Strategy <b>${name}</b> is now <b>DISABLED</b>`);
                logger.info(`Strategy "${name}" disabled via Telegram`);
            }
        });

        // ─── 📐 Плечо ───
        telegramNotifier.onCommand(/(\/leverage$|📐 Плечо)/, () => {
            const levInfo = this.leverageConfig.mode === 'fixed'
                ? `x${this.leverageConfig.fixedValue} (fixed)`
                : `x${this.leverageConfig.minValue}-${this.leverageConfig.maxValue} (dynamic)`;
            const msg = `📐 <b>Leverage Settings</b>
Current: <b>${levInfo}</b>

<i>Commands:</i>
<code>/leverage fixed 20</code> — set fixed x20
<code>/leverage dynamic 5 25</code> — dynamic from x5 to x25
<code>/leverage dynamic</code> — reset to default dynamic (x1-x20)`;
            telegramNotifier.sendTextMessage(msg);
        });

        // ─── /leverage fixed N ───
        telegramNotifier.onCommand(/\/leverage fixed (\d+)/, (_msg: any, match: any) => {
            const val = parseInt(match[1]);
            if (val < 1 || val > 125) {
                telegramNotifier.sendTextMessage('❌ Leverage must be between 1 and 125');
                return;
            }
            this.leverageConfig = { mode: 'fixed', fixedValue: val, minValue: val, maxValue: val };
            telegramNotifier.sendTextMessage(`📐 Leverage set to <b>fixed x${val}</b>`);
            logger.info(`Leverage set to fixed x${val} via Telegram`);
        });

        // ─── /leverage dynamic [min] [max] ───
        telegramNotifier.onCommand(/\/leverage dynamic(?:\s+(\d+)\s+(\d+))?/, (_msg: any, match: any) => {
            const min = match[1] ? parseInt(match[1]) : 1;
            const max = match[2] ? parseInt(match[2]) : 20;
            this.leverageConfig = { mode: 'dynamic', fixedValue: max, minValue: min, maxValue: max };
            telegramNotifier.sendTextMessage(`📐 Leverage set to <b>dynamic x${min}-x${max}</b>`);
            logger.info(`Leverage set to dynamic x${min}-x${max} via Telegram`);
        });

        // ─── 🛡️ Риск Менеджмент ───
        telegramNotifier.onCommand(/(?:\/risk|🛡️ Риск)(?:\s+([\d.]+))?/, (_msg: any, match: any) => {
            const riskStr = match[1]; // e.g. "2.0" or undefined
            if (!riskStr || isNaN(parseFloat(riskStr))) {
                const msg = `🛡️ <b>Risk Management</b>
Current Target Risk: <b>${this.targetRiskPercent.toFixed(1)}%</b> per trade

<i>Commands:</i>
<code>/risk 0.5</code> — low risk
<code>/risk 1.0</code> — standard
<code>/risk 2.0</code> — aggressive
<code>/risk 3.0</code> — degenerate

<i>Dynamic leverage mode will automatically calculate your position leverage as Leverage = ${this.targetRiskPercent.toFixed(1)}% / StopLossDistance%.</i>`;
                telegramNotifier.sendTextMessage(msg);
                return;
            }

            const val = parseFloat(riskStr);
            if (val < 0.1 || val > 10.0) {
                telegramNotifier.sendTextMessage('❌ Risk must be between 0.1% and 10.0%');
                return;
            }
            this.targetRiskPercent = val;
            telegramNotifier.sendTextMessage(`🛡️ Target risk set to <b>${val.toFixed(1)}%</b> per trade`);
            logger.info(`Target risk set to ${val.toFixed(1)}% via Telegram`);
        });

        // ─── 🚫 Монеты ───
        telegramNotifier.onCommand(/(\/coins|🚫 Монеты)/, () => {
            const disabled = universeLoader.getDisabledSymbols();
            const list = disabled.length > 0
                ? disabled.map(s => `🔴 ${s}`).join('\n')
                : '<i>Нет заблокированных монет</i>';
            const msg = `🚫 <b>Blocked Coins</b>

${list}

<i>Commands:</i>
<code>/coin block BTCUSDT</code> — block a coin
<code>/coin unblock BTCUSDT</code> — unblock a coin`;
            telegramNotifier.sendTextMessage(msg);
        });

        // ─── /coin block SYMBOL ───
        telegramNotifier.onCommand(/\/coin block (\w+)/, (_msg: any, match: any) => {
            const sym = match[1].toUpperCase();
            universeLoader.disableSymbol(sym);
            telegramNotifier.sendTextMessage(`🔴 <b>${sym}</b> заблокирована и исключена из сканирования`);
            logger.info(`Symbol ${sym} blocked via Telegram`);
        });

        // ─── /coin unblock SYMBOL ───
        telegramNotifier.onCommand(/\/coin unblock (\w+)/, (_msg: any, match: any) => {
            const sym = match[1].toUpperCase();
            universeLoader.enableSymbol(sym);
            telegramNotifier.sendTextMessage(`🟢 <b>${sym}</b> разблокирована`);
            logger.info(`Symbol ${sym} unblocked via Telegram`);
        });

        // ─── 🔄 Переключение режима (Live/Paper) ───
        telegramNotifier.onCommand(/(\/mode|🔄 Режим)(?:\s+(live|paper))?/, (_msg: any, match: any) => {
            const requestedMode = match[2]; // match[1] is the command/button text, match[2] is the mode
            if (!requestedMode) {
                const current = this.isLive ? '🚀 LIVE' : '📝 PAPER';
                telegramNotifier.sendTextMessage(`Current Mode: <b>${current}</b>\n\nUse <code>/mode live</code> or <code>/mode paper</code> to switch.`);
                return;
            }

            if (requestedMode === 'live') {
                const exConfig = config.exchangeId === 'mexc' ? config.mexc : config.binance;
                if (!exConfig.apiKey || !exConfig.apiSecret) {
                    telegramNotifier.sendTextMessage(`❌ Cannot switch to LIVE: API keys for ${config.exchangeId.toUpperCase()} missing in .env`);
                    return;
                }
                this.isLive = true;
                this.init(this.registeredStrategies); 
                telegramNotifier.sendTextMessage(`⚠️ <b>MODE CHANGED TO LIVE</b>\nBot will now execute real trades on ${config.exchangeId.toUpperCase()}!`);
            } else {
                this.isLive = false;
                telegramNotifier.sendTextMessage('📝 <b>MODE CHANGED TO PAPER</b>\nBot will now simulate trades.');
            }
        });

        // ─── 🚨 PANIC BUTTON ───
        telegramNotifier.onCommand(/(\/panic|🚨 ПАНИКА)/, async () => {
            telegramNotifier.sendTextMessage('🚨 <b>PANIC INITIATED</b>: Closing all positions...');
            await this.panicCloseAll();
        });
    }

    /**
     * Get number of currently active positions or pending limit orders
     */
    getActiveAndPendingCount(): number {
        return this.activeTrades.length;
    }

    /**
     * Get number of active/pending trades in a specific direction
     */
    getActiveCountByDirection(direction: SignalDirection): number {
        return this.activeTrades.filter(t => t.direction === direction).length;
    }

    /**
     * Checks if a strategy is disabled (manually or by circuit breaker)
     */
    isStrategyDisabled(strategyName: string): boolean {
        if (this.disabledStrategies.has(strategyName)) return true;
        return statsService.isPaused(strategyName);
    }

    /**
     * Check if a symbol+strategy combo is on SL cooldown (prevent re-entry after stop-loss)
     */
    isOnSlCooldown(symbol: string, strategyName: string): boolean {
        const key = `${symbol}:${strategyName}`;
        const lastSl = this.slCooldown.get(key);
        if (!lastSl) return false;
        return Date.now() - lastSl < SL_COOLDOWN_MS;
    }

    /**
     * Calculate leverage based on current config and stop-loss distance
     */
    calculateLeverage(slDistancePercent: number): number {
        if (this.leverageConfig.mode === 'fixed') {
            return this.leverageConfig.fixedValue;
        }
        // Dynamic: Leverage = Target Risk / SL Distance Percent
        // Example: SL is 0.5% away. We want to risk 1.0%. Leverage = 1.0 / 0.5 = x2
        // Wait, standard perp sizing: If price moves 0.5%, and we have x20 leverage, our PNL is -10%. 
        // We want SL to equal targetRiskPercent.
        // Therefore, Leverage = targetRiskPercent / slDistancePercent.
        // e.g. targetRisk 1.0%, slDistance = 0.5%. Leverage = 1 / 0.5 = x2... no wait.
        // Position size * SL distance % = Target Risk % of Account
        // If we use 100% of our account * (1 / Leverage)...
        // Pnl% at StopLoss should be EXACTLY `targetRiskPercent`.
        // So: targetRiskPercent = slDistancePercent * Leverage
        // Leverage = targetRiskPercent / slDistancePercent
        const targetLeverage = (this.targetRiskPercent / (slDistancePercent + 0.0001)); 
        
        return Math.max(this.leverageConfig.minValue, Math.min(this.leverageConfig.maxValue, Math.round(targetLeverage)));
    }

    /**
     * Checks open paper trades against the latest candle.
     * Ladder TP: closes 25% of position at each TP level (TP1-TP4).
     * SL closes whatever portion remains.
     */
    async updatePaperTrades(ctx: StrategyContext) {
        if (this.isLive) return;
        
        const lastCandle = ctx.candles[ctx.candles.length - 1];

        this.activeTrades = this.activeTrades.filter(trade => {
            if (trade.symbol !== ctx.symbol) return true;

            const isLong = trade.direction === SignalDirection.LONG;

            // ─── PENDING LIMIT ORDERS ───
            if (trade.status === 'PENDING') {
                const triggered = isLong ? lastCandle.low <= trade.entryPrice : lastCandle.high >= trade.entryPrice;
                if (triggered) {
                    trade.status = 'ACTIVE';
                    trade.history.push(`${getTimestamp()} Limit Filled at ${trade.entryPrice.toFixed(4)}`);
                    logger.info(`[LIMIT FILLED] ${trade.symbol} ${trade.direction} at ${trade.entryPrice.toFixed(4)}`);
                } else if (Date.now() > trade.expireAt) {
                    logger.info(`[LIMIT EXPIRED] ${trade.symbol} ${trade.direction} at ${trade.entryPrice.toFixed(4)}`);
                    return false; // Remove pending trade
                } else {
                    return true; // Still pending, keep waiting
                }
            }

            const isEntryCandle = trade.timestamp === lastCandle.timestamp;

            // ─── Check Stop Loss first (closes entire remaining position) ───
            // If it's the same 5m candle we entered on, we cannot use .low/.high because those include 
            // price action that happened BEFORE our entry. We must evaluate only the current live price (.close).
            const slHit = isEntryCandle
                ? (isLong ? lastCandle.close <= trade.sl : lastCandle.close >= trade.sl)
                : (isLong ? lastCandle.low <= trade.sl : lastCandle.high >= trade.sl);

            if (slHit) {
                const slPnlRaw = isLong
                    ? (trade.sl - trade.entryPrice) / trade.entryPrice
                    : (trade.entryPrice - trade.sl) / trade.entryPrice;
                const slPnl = slPnlRaw * trade.remainingPortion * trade.leverage * 100;
                const totalPnl = trade.accumulatedPnl + slPnl;
                this.todaysPnlPercent += slPnl;

                this.recordStrategyResult(trade.strategyName, totalPnl);

                trade.history.push(`${getTimestamp()} SL hit (${slPnl.toFixed(2)}%)`);

                const cooldownKey = `${trade.symbol}:${trade.strategyName}`;
                this.slCooldown.set(cooldownKey, Date.now());
                logger.info(`[SL COOLDOWN] ${cooldownKey} blocked for 1 hour`);
                logger.info(`[PAPER CLOSED by SL] ${trade.symbol} ${trade.direction} | Partial PnL: ${slPnl.toFixed(2)}% | Total: ${totalPnl.toFixed(2)}%`);
                telegramNotifier.sendTradeResult(trade.symbol, trade.direction, totalPnl, this.todaysPnlPercent, trade.history);
                return false; // Remove trade
            }

            // ─── Check TP levels (ladder: 4 steps: 35%, 35%, 15%, 15%) ───
            while (trade.tpHit < 4) {
                const nextTp = trade.tp[trade.tpHit];
                const tpReached = isEntryCandle
                    ? (isLong ? lastCandle.close >= nextTp : lastCandle.close <= nextTp)
                    : (isLong ? lastCandle.high >= nextTp : lastCandle.low <= nextTp);

                if (!tpReached) break;

                // 40% for TP1 and TP2, index 0 and 1
                // 10% for TP3 and TP4, index 2 and 3
                const portion = trade.tpHit < 2 ? 0.40 : 0.10;
                const tpPnlRaw = isLong
                    ? (nextTp - trade.entryPrice) / trade.entryPrice
                    : (trade.entryPrice - nextTp) / trade.entryPrice;
                const tpPnl = tpPnlRaw * portion * trade.leverage * 100;

                trade.accumulatedPnl += tpPnl;
                trade.remainingPortion -= portion;
                trade.tpHit++;
                this.todaysPnlPercent += tpPnl;
                
                trade.history.push(`${getTimestamp()} TP${trade.tpHit} hit (+${tpPnl.toFixed(2)}%)`);

                // Move trailing stop loss
                if (trade.tpHit === 1) { // Hit TP1 -> move SL to Break-Even
                    trade.sl = trade.entryPrice;
                    trade.history.push(`${getTimestamp()} SL moved to BE (${trade.sl.toFixed(4)})`);
                } else if (trade.tpHit === 2) { // Hit TP2 (Main) -> move SL to TP1
                    trade.sl = trade.tp[0];
                    trade.history.push(`${getTimestamp()} SL moved to TP1 (${trade.sl.toFixed(4)})`);
                } else if (trade.tpHit === 3) { // Hit TP3 -> move SL to TP2
                    trade.sl = trade.tp[1];
                    trade.history.push(`${getTimestamp()} SL moved to TP2 (${trade.sl.toFixed(4)})`);
                }

                logger.info(`[TP${trade.tpHit} HIT] ${trade.symbol} ${trade.direction} | +${tpPnl.toFixed(2)}% (${(portion * 100).toFixed(0)}%) | Remaining: ${(trade.remainingPortion * 100).toFixed(0)}%`);
            }

            // All 4 TPs hit — position fully closed
            if (trade.tpHit >= 4) {
                const totalPnl = trade.accumulatedPnl;
                this.recordStrategyResult(trade.strategyName, totalPnl);
                logger.info(`[PAPER CLOSED FULL TP] ${trade.symbol} ${trade.direction} | Total: ${totalPnl.toFixed(2)}%`);
                telegramNotifier.sendTradeResult(trade.symbol, trade.direction, totalPnl, this.todaysPnlPercent, trade.history);
                return false;
            }

            return true; // Trade still open with remaining portion
        });
    }

    private recordStrategyResult(strategyName: string, totalPnl: number) {
        if (!this.strategyStats[strategyName]) {
            this.strategyStats[strategyName] = { win: 0, loss: 0, pnl: 0 };
        }
        const stats = this.strategyStats[strategyName];
        if (totalPnl > 0) stats.win++;
        else stats.loss++;
        stats.pnl += totalPnl;

        // Feed to Circuit Breaker
        statsService.recordTrade(strategyName, totalPnl);
    }

    /**
     * Finds an open paper trade for a given symbol
     */
    getActiveTrade(symbol: string): PaperTrade | undefined {
        return this.activeTrades.find(t => t.symbol === symbol);
    }

    /**
     * Executes a trade based on a final signal
     * If an active trade already exists, applies Smart DCA averaging if the setup qualifies.
     */
    async processSignal(signal: FinalSignal, currentPrice?: number) {
        if (this.isStrategyDisabled(signal.strategyName)) return;
        if (this.isOnSlCooldown(signal.symbol, signal.strategyName)) return;

        if (this.isLive) {
            await this.executeLiveTrade(signal);
            return;
        }

        // ─── PAPER TRADING LOGIC ───
        const existingTrade = this.getActiveTrade(signal.symbol);

        // ─── SMART DCA (AVERAGING) ───
        if (existingTrade) {
            const priceToCompare = currentPrice || signal.levels.entry;
            const isLong = existingTrade.direction === SignalDirection.LONG;

            if (existingTrade.direction === signal.direction && existingTrade.dcaCount === 0 && existingTrade.status === 'ACTIVE') {
                const drawdownPct = isLong 
                    ? (existingTrade.entryPrice - priceToCompare) / existingTrade.entryPrice * 100
                    : (priceToCompare - existingTrade.entryPrice) / existingTrade.entryPrice * 100;

                if (drawdownPct >= 1.0) {
                    const oldEntry = existingTrade.entryPrice;
                    const newAverageEntry = (oldEntry + signal.levels.entry) / 2;
                    
                    existingTrade.entryPrice = newAverageEntry;
                    existingTrade.sl = signal.levels.sl;
                    existingTrade.tp = signal.levels.tp;
                    existingTrade.tpHit = 0;
                    existingTrade.remainingPortion = 1.0;
                    existingTrade.dcaCount++;

                    const logMsg = `${getTimestamp()} DCA Averaged: Old ${oldEntry.toFixed(4)} -> New Avg ${newAverageEntry.toFixed(4)} via ${signal.strategyName}`;
                    existingTrade.history.push(logMsg);
                    logger.info(`[PAPER DCA] ${signal.symbol} ${signal.direction} | DCA Averaged: Old ${oldEntry.toFixed(4)} -> New Avg ${newAverageEntry.toFixed(4)}`);
                    telegramNotifier.sendTextMessage(`🔥 <b>SMART DCA Triggered</b>\n\n<b>${signal.symbol}</b> ${signal.direction}\nAverage Entry dropped from <code>${oldEntry.toFixed(4)}</code> to <code>${newAverageEntry.toFixed(4)}</code>!\nNew SL: <code>${existingTrade.sl.toFixed(4)}</code>`);
                    return;
                }
            }
            return;
        }

        // ─── NEW PAPER TRADE ───
        const status = signal.orderType === 'LIMIT' ? 'PENDING' : 'ACTIVE';
        const logEntryMsg = status === 'PENDING' 
            ? `${getTimestamp()} Limit set at ${signal.levels.entry.toFixed(4)}` 
            : `${getTimestamp()} Market entry at ${signal.levels.entry.toFixed(4)}`;

        logger.info(`[PAPER TRADE] Opening ${signal.direction} on ${signal.symbol} at ${signal.levels.entry.toFixed(4)} | Leverage: x${signal.leverageSuggestion}`);
        
        this.activeTrades.push({
            id: `${signal.symbol}-${signal.timestamp}`,
            symbol: signal.symbol,
            direction: signal.direction,
            entryPrice: signal.levels.entry,
            sl: signal.levels.sl,
            tp: signal.levels.tp,
            tpHit: 0,
            remainingPortion: 1.0,
            leverage: signal.leverageSuggestion,
            accumulatedPnl: 0,
            timestamp: signal.timestamp,
            strategyName: signal.strategyName,
            history: [logEntryMsg],
            status: status,
            expireAt: signal.timestamp + (signal.expireMinutes * 60 * 1000),
            orderType: signal.orderType || 'MARKET',
            dcaCount: 0
        });
    }

    private async executeLiveTrade(signal: FinalSignal) {
        if (!this.exchange) return;
        
        let symbol = signal.symbol;
        // MEXC/Unified symbol handling: BTCUSDT -> BTC/USDT:USDT
        if (config.exchangeId === 'mexc' && !symbol.includes('/')) {
            symbol = `${symbol.replace('USDT', '')}/USDT:USDT`;
        }

        const direction = signal.direction === SignalDirection.LONG ? 'buy' : 'sell';
        const side = signal.direction === SignalDirection.LONG ? 'LONG' : 'SHORT';
        
        try {
            await this.setExchangeSettings(symbol, signal.leverageSuggestion);
            const quantity = await this.calculateLivePositionSize(signal);
            
            if (quantity <= 0) {
                logger.error(`[LIVE] Skip ${symbol}: quantity calculated as 0 or insufficient balance`);
                return;
            }

            logger.info(`[LIVE] Opening ${side} on ${symbol} | Qty: ${quantity} | Entry: ${signal.levels.entry}`);

            const orderType = signal.orderType === 'LIMIT' ? 'limit' : 'market';
            const params: any = {
                // MEXC specifics
                openType: 2 // 2 = Cross on MEXC
            };
            if (orderType === 'limit') params.price = signal.levels.entry;

            const entryOrder = await this.exchange.createOrder(symbol, orderType, direction, quantity, signal.levels.entry, params);
            logger.info(`[LIVE] Entry order placed: ${entryOrder.id}`);

            const tps = signal.levels.tp;
            const tpPortions = [0.40, 0.40, 0.10, 0.10];
            const closeDirection = direction === 'buy' ? 'sell' : 'buy';

            for (let i = 0; i < tps.length; i++) {
                const tpQty = quantity * tpPortions[i];
                if (tpQty > 0) {
                    await this.exchange.createOrder(symbol, 'limit', closeDirection, tpQty, tps[i], { 
                        reduceOnly: true,
                        openType: 2 
                    });
                }
            }

            await this.exchange.createOrder(symbol, 'STOP_MARKET', closeDirection, quantity, undefined, {
                stopPrice: signal.levels.sl,
                reduceOnly: true,
                openType: 2
            });

            telegramNotifier.sendTextMessage(`🚀 <b>LIVE TRADE OPENED [${config.exchangeId.toUpperCase()}]</b>\n\n<b>${symbol}</b> ${side} x${signal.leverageSuggestion}\nQty: <code>${quantity.toFixed(4)}</code>\nEntry: <code>${signal.levels.entry}</code>\nSL: <code>${signal.levels.sl}</code>`);

        } catch (err: any) {
            logger.error(`[LIVE] Critical failure executing trade for ${symbol}`, { error: err.message });
            telegramNotifier.sendTextMessage(`❌ <b>LIVE EXECUTION FAILED</b>\n\n${symbol}: ${err.message}`);
        }
    }

    private async setExchangeSettings(symbol: string, leverage: number) {
        if (!this.exchange) return;
        try {
            if (config.exchangeId === 'mexc') {
                // MEXC sets margin mode via setLeverage params
                await this.exchange.setLeverage(leverage, symbol, { openType: 2 }); // 2 = Cross
            } else {
                try {
                    await this.exchange.setMarginMode('CROSSED', symbol);
                } catch (e) {}
                await this.exchange.setLeverage(leverage, symbol);
            }
        } catch (err: any) {
            logger.warn(`Failed to set exchange settings for ${symbol}`, { error: err.message });
        }
    }

    private async calculateLivePositionSize(signal: FinalSignal): Promise<number> {
        if (!this.exchange) return 0;
        try {
            const balance: any = await this.exchange.fetchBalance();
            const usdt = balance.free['USDT'] || 0;
            if (usdt < 10) return 0;

            const riskAmountUsdt = usdt * (this.targetRiskPercent / 100);
            const slDist = Math.abs(signal.levels.entry - signal.levels.sl) / signal.levels.entry;
            const positionSizeUsdt = riskAmountUsdt / (slDist + 0.00001);
            let quantity = positionSizeUsdt / signal.levels.entry;

            const maxAllowedQty = (usdt * signal.leverageSuggestion * 0.95) / signal.levels.entry;
            return Math.min(quantity, maxAllowedQty);
        } catch (err: any) {
            logger.error('Failed to calculate position size', { error: err.message });
            return 0;
        }
    }

    async panicCloseAll() {
        if (!this.isLive || !this.exchange) {
            this.activeTrades = [];
            telegramNotifier.sendTextMessage('🧹 Paper trades cleared.');
            return;
        }
        try {
            const positions = await this.exchange.fetchPositions();
            for (const pos of positions) {
                const size = Number(pos.contracts || 0);
                if (size !== 0 && pos.symbol) {
                    const symbol = pos.symbol;
                    const side: 'buy' | 'sell' = size > 0 ? 'sell' : 'buy';
                    await this.exchange.createOrder(symbol, 'market', side, Math.abs(size), undefined, { 
                        reduceOnly: true,
                        openType: 2 
                    });
                }
            }
            await this.exchange.cancelAllOrders();
            telegramNotifier.sendTextMessage(`🚨 <b>PANIC CLOSED</b>: All positions closed and orders cancelled on ${config.exchangeId.toUpperCase()}!`);
        } catch (err: any) {
            logger.error('Panic close failed', { error: err.message });
        }
    }
}

export const tradeExecutor = new TradeExecutor();

