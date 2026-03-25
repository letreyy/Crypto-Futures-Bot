import { FinalSignal, StrategyContext } from '../core/types/bot-types.js';
import { logger } from '../core/utils/logger.js';
import { SignalDirection } from '../core/constants/enums.js';
import { telegramNotifier } from '../notifications/telegram/telegram-notifier.js';
import { Strategy } from '../strategies/base/strategy.js';

interface PaperTrade {
    id: string;
    symbol: string;
    direction: SignalDirection;
    entryPrice: number;
    sl: number;
    tp: number;
    leverage: number;
    pnlPercent: number;
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
     * Checks open paper trades against the latest candle
     */
    async updatePaperTrades(ctx: StrategyContext) {
        if (this.isLive) return;
        
        const lastCandle = ctx.candles[ctx.candles.length - 1];

        this.activeTrades = this.activeTrades.filter(trade => {
            if (trade.symbol !== ctx.symbol) return true;

            let closed = false;
            let finalPnlRaw = 0;
            let hitSl = false;

            if (trade.direction === SignalDirection.LONG) {
                if (lastCandle.low <= trade.sl) {
                    closed = true;
                    hitSl = true;
                    finalPnlRaw = (trade.sl - trade.entryPrice) / trade.entryPrice;
                } else if (lastCandle.high >= trade.tp) {
                    closed = true;
                    finalPnlRaw = (trade.tp - trade.entryPrice) / trade.entryPrice;
                }
            } else {
                if (lastCandle.high >= trade.sl) {
                    closed = true;
                    hitSl = true;
                    finalPnlRaw = (trade.entryPrice - trade.sl) / trade.entryPrice;
                } else if (lastCandle.low <= trade.tp) {
                    closed = true;
                    finalPnlRaw = (trade.entryPrice - trade.tp) / trade.entryPrice;
                }
            }

            if (closed) {
                const leveragedPnl = finalPnlRaw * trade.leverage * 100;
                this.todaysPnlPercent += leveragedPnl;
                
                // Record Strategy Stats
                if (!this.strategyStats[trade.strategyName]) {
                    this.strategyStats[trade.strategyName] = { win: 0, loss: 0, pnl: 0 };
                }
                const stats = this.strategyStats[trade.strategyName];
                if (leveragedPnl > 0) stats.win++;
                else stats.loss++;
                stats.pnl += leveragedPnl;

                // If stopped out, put this symbol+strategy combo on cooldown
                if (hitSl) {
                    const cooldownKey = `${trade.symbol}:${trade.strategyName}`;
                    this.slCooldown.set(cooldownKey, Date.now());
                    logger.info(`[SL COOLDOWN] ${cooldownKey} blocked for 1 hour`);
                }

                logger.info(`[PAPER TRADE CLOSED] ${trade.symbol} ${trade.direction} | PnL: ${leveragedPnl.toFixed(2)}% | Str: ${trade.strategyName}`);
                telegramNotifier.sendTradeResult(trade.symbol, trade.direction, leveragedPnl, this.todaysPnlPercent);
                return false;
            }

            return true;
        });
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
            logger.info(`[PAPER TRADE] Opening ${signal.direction} on ${signal.symbol} at ${signal.levels.entry.toFixed(4)} | Leverage: x${signal.leverageSuggestion}`);
            this.activeTrades.push({
                id: `${signal.symbol}-${signal.timestamp}`,
                symbol: signal.symbol,
                direction: signal.direction,
                entryPrice: signal.levels.entry,
                sl: signal.levels.sl,
                tp: signal.levels.tp[1], // TP2 as default target for paper trading
                leverage: signal.leverageSuggestion,
                pnlPercent: 0,
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

