import { logger } from '../core/utils/logger.js';
import { SignalDirection } from '../core/constants/enums.js';
import { telegramNotifier } from '../notifications/telegram/telegram-notifier.js';
export class TradeExecutor {
    isLive = false;
    activeTrades = [];
    todaysPnlPercent = 0;
    /**
     * Initializes the auto-trading subsystem
     */
    async init() {
        // TODO: Validate API Keys have Trade permissions
        // TODO: Fetch account balance
        logger.info('Trade Executor initialized. Status: ' + (this.isLive ? 'LIVE' : 'PAPER TRADING'));
        // Register Telegram Command
        telegramNotifier.onCommand(/\/stats/, () => {
            const status = this.isLive ? 'LIVE' : 'PAPER TRADING';
            const sign = this.todaysPnlPercent > 0 ? '+' : '';
            const msg = `📊 <b>Bot Statistics</b>
🤖 <b>Status:</b> ${status}
📂 <b>Active Trades:</b> ${this.activeTrades.length}
💰 <b>Total PnL Today:</b> ${sign}${this.todaysPnlPercent.toFixed(2)}%

<i>Active Symbols:</i>
${this.activeTrades.map(t => `- ${t.symbol} ${t.direction}`).join('\n') || '- None'}`;
            telegramNotifier.sendTextMessage(msg);
        });
    }
    /**
     * Checks open paper trades against the latest candle
     */
    async updatePaperTrades(ctx) {
        if (this.isLive)
            return;
        const lastCandle = ctx.candles[ctx.candles.length - 1];
        this.activeTrades = this.activeTrades.filter(trade => {
            if (trade.symbol !== ctx.symbol)
                return true;
            let closed = false;
            let finalPnlRaw = 0;
            if (trade.direction === SignalDirection.LONG) {
                if (lastCandle.low <= trade.sl) {
                    closed = true;
                    finalPnlRaw = (trade.sl - trade.entryPrice) / trade.entryPrice;
                }
                else if (lastCandle.high >= trade.tp) {
                    closed = true;
                    finalPnlRaw = (trade.tp - trade.entryPrice) / trade.entryPrice;
                }
            }
            else {
                if (lastCandle.high >= trade.sl) {
                    closed = true;
                    finalPnlRaw = (trade.entryPrice - trade.sl) / trade.entryPrice;
                }
                else if (lastCandle.low <= trade.tp) {
                    closed = true;
                    finalPnlRaw = (trade.entryPrice - trade.tp) / trade.entryPrice;
                }
            }
            if (closed) {
                const leveragedPnl = finalPnlRaw * trade.leverage * 100;
                this.todaysPnlPercent += leveragedPnl;
                logger.info(`[PAPER TRADE CLOSED] ${trade.symbol} ${trade.direction} | PnL: ${leveragedPnl.toFixed(2)}%`);
                telegramNotifier.sendTradeResult(trade.symbol, trade.direction, leveragedPnl, this.todaysPnlPercent);
                return false;
            }
            return true;
        });
    }
    /**
     * Checks if a symbol already has an open paper trade
     */
    hasActiveTrade(symbol) {
        return this.activeTrades.some(t => t.symbol === symbol);
    }
    /**
     * Executes a trade based on a final signal

     * @param signal The generated and filtered signal
     */
    async processSignal(signal) {
        if (!this.isLive) {
            logger.info(`[PAPER TRADE] Opening ${signal.direction} on ${signal.symbol} at ${signal.levels.entry.toFixed(4)}`);
            this.activeTrades.push({
                id: `${signal.symbol}-${signal.timestamp}`,
                symbol: signal.symbol,
                direction: signal.direction,
                entryPrice: signal.levels.entry,
                sl: signal.levels.sl,
                tp: signal.levels.tp[1], // Simulated targeting TP2
                leverage: signal.leverageSuggestion,
                pnlPercent: 0,
                timestamp: signal.timestamp
            });
            return;
        }
        try {
            await this.placeOrder(signal);
            await this.placeTakeProfits(signal);
            await this.placeStopLoss(signal);
        }
        catch (error) {
            logger.error(`Failed to execute trade for ${signal.symbol}`, { error: error.message });
        }
    }
    async placeOrder(signal) {
        // TODO: Call Binance API Client to place Market or Limit Entry Order
        logger.info(`Placing Entry Order for ${signal.symbol}`);
    }
    async placeTakeProfits(signal) {
        // TODO: Call Binance API Client to place Limit EXIT Orders at signal.levels.tp array
        logger.info(`Placing TP Orders for ${signal.symbol}`);
    }
    async placeStopLoss(signal) {
        // TODO: Call Binance API Client to place Stop Market EXIT Order at signal.levels.sl
        logger.info(`Placing SL Order for ${signal.symbol}`);
    }
}
export const tradeExecutor = new TradeExecutor();
//# sourceMappingURL=trade-executor.js.map