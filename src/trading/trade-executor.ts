import { FinalSignal, StrategyContext } from '../core/types/bot-types.js';
import { logger } from '../core/utils/logger.js';
import { SignalDirection } from '../core/constants/enums.js';
import { telegramNotifier } from '../notifications/telegram/telegram-notifier.js';
import { Strategy } from '../strategies/base/strategy.js';
import { universeLoader } from '../market/universe/universe-loader.js';
import { COMBO_DEFINITIONS } from '../strategies/combination-engine.js';

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

export class TradeExecutor {
    private isLive: boolean = false;
    private activeTrades: PaperTrade[] = [];
    private todaysPnlPercent: number = 0;
    private strategyStats: Record<string, { win: number, loss: number, pnl: number }> = {};
    private disabledStrategies: Set<string> = new Set();
    private slCooldown: SlCooldownMap = new Map();
    private leverageConfig: LeverageConfig = { mode: 'dynamic', fixedValue: 20, minValue: 1, maxValue: 20 };
    private registeredStrategies: Strategy[] = [];

    /**
     * Initializes the auto-trading subsystem
     */
    async init(strategies: Strategy[]) {
        this.registeredStrategies = strategies;
        logger.info('Trade Executor initialized. Status: ' + (this.isLive ? 'LIVE' : 'PAPER TRADING'));

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

            const msg = `📊 <b>Bot Statistics</b>
🤖 <b>Status:</b> ${status}
📂 <b>Active Trades:</b> ${this.activeTrades.length}
💰 <b>Total PnL Today:</b> ${sign}${this.todaysPnlPercent.toFixed(2)}%
📐 <b>Leverage:</b> ${levInfo}${stratMsg}

<i>Active Symbols:</i>
${this.activeTrades.map(t => `- ${t.symbol} ${t.direction} (${t.strategyName})`).join('\n') || '- None'}`;
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
    }

    /**
     * Checks if a strategy is disabled
     */
    isStrategyDisabled(strategyName: string): boolean {
        return this.disabledStrategies.has(strategyName);
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
     * Calculate leverage based on current config
     */
    calculateLeverage(riskPercent: number): number {
        if (this.leverageConfig.mode === 'fixed') {
            return this.leverageConfig.fixedValue;
        }
        // Dynamic: higher risk → lower leverage
        const raw = Math.floor(10 / (riskPercent || 1));
        return Math.max(this.leverageConfig.minValue, Math.min(this.leverageConfig.maxValue, raw));
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

            // ─── Check Stop Loss first (closes entire remaining position) ───
            const slHit = isLong
                ? lastCandle.low <= trade.sl
                : lastCandle.high >= trade.sl;

            if (slHit) {
                const slPnlRaw = isLong
                    ? (trade.sl - trade.entryPrice) / trade.entryPrice
                    : (trade.entryPrice - trade.sl) / trade.entryPrice;
                const slPnl = slPnlRaw * trade.remainingPortion * trade.leverage * 100;
                const totalPnl = trade.accumulatedPnl + slPnl;
                this.todaysPnlPercent += slPnl;

                this.recordStrategyResult(trade.strategyName, totalPnl);

                const cooldownKey = `${trade.symbol}:${trade.strategyName}`;
                this.slCooldown.set(cooldownKey, Date.now());
                logger.info(`[SL COOLDOWN] ${cooldownKey} blocked for 1 hour`);
                logger.info(`[PAPER CLOSED by SL] ${trade.symbol} ${trade.direction} | Partial PnL: ${slPnl.toFixed(2)}% | Total: ${totalPnl.toFixed(2)}%`);
                telegramNotifier.sendTradeResult(trade.symbol, trade.direction, totalPnl, this.todaysPnlPercent);
                return false; // Remove trade
            }

            // ─── Check TP levels (ladder: 25% at each level) ───
            while (trade.tpHit < 4) {
                const nextTp = trade.tp[trade.tpHit];
                const tpReached = isLong
                    ? lastCandle.high >= nextTp
                    : lastCandle.low <= nextTp;

                if (!tpReached) break;

                // Close 25% of the original position
                const portion = 0.25;
                const tpPnlRaw = isLong
                    ? (nextTp - trade.entryPrice) / trade.entryPrice
                    : (trade.entryPrice - nextTp) / trade.entryPrice;
                const tpPnl = tpPnlRaw * portion * trade.leverage * 100;

                trade.accumulatedPnl += tpPnl;
                trade.remainingPortion -= portion;
                trade.tpHit++;
                this.todaysPnlPercent += tpPnl;

                logger.info(`[TP${trade.tpHit} HIT] ${trade.symbol} ${trade.direction} | +${tpPnl.toFixed(2)}% (25%) | Remaining: ${(trade.remainingPortion * 100).toFixed(0)}%`);
            }

            // All 4 TPs hit — position fully closed
            if (trade.tpHit >= 4) {
                const totalPnl = trade.accumulatedPnl;
                this.recordStrategyResult(trade.strategyName, totalPnl);
                logger.info(`[PAPER CLOSED FULL TP] ${trade.symbol} ${trade.direction} | Total: ${totalPnl.toFixed(2)}%`);
                telegramNotifier.sendTradeResult(trade.symbol, trade.direction, totalPnl, this.todaysPnlPercent);
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
    }

    /**
     * Checks if a symbol already has an open paper trade
     */
    hasActiveTrade(symbol: string): boolean {
        return this.activeTrades.some(t => t.symbol === symbol);
    }

    /**
     * Executes a trade based on a final signal
     * @param signal The generated and filtered signal
     */
    async processSignal(signal: FinalSignal) {
        if (!this.isLive) {
            logger.info(`[PAPER TRADE] Opening ${signal.direction} on ${signal.symbol} at ${signal.levels.entry.toFixed(4)} | Leverage: x${signal.leverageSuggestion} | TPs: ${signal.levels.tp.map(t => t.toFixed(4)).join(', ')}`);
            this.activeTrades.push({
                id: `${signal.symbol}-${signal.timestamp}`,
                symbol: signal.symbol,
                direction: signal.direction,
                entryPrice: signal.levels.entry,
                sl: signal.levels.sl,
                tp: signal.levels.tp,        // All 4 TP levels
                tpHit: 0,
                remainingPortion: 1.0,
                leverage: signal.leverageSuggestion,
                accumulatedPnl: 0,
                timestamp: signal.timestamp,
                strategyName: signal.strategyName
            });
            return;
        }

        try {
            await this.placeOrder(signal);
            await this.placeTakeProfits(signal);
            await this.placeStopLoss(signal);
        } catch (error: any) {
            logger.error(`Failed to execute trade for ${signal.symbol}`, { error: error.message });
        }
    }

    private async placeOrder(signal: FinalSignal) {
        logger.info(`Placing Entry Order for ${signal.symbol}`);
    }

    private async placeTakeProfits(signal: FinalSignal) {
        logger.info(`Placing TP Orders for ${signal.symbol}`);
    }

    private async placeStopLoss(signal: FinalSignal) {
        logger.info(`Placing SL Order for ${signal.symbol}`);
    }
}

export const tradeExecutor = new TradeExecutor();

