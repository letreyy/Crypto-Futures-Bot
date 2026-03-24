import { FinalSignal, StrategyContext } from '../core/types/bot-types.js';
export declare class TradeExecutor {
    private isLive;
    private activeTrades;
    private todaysPnlPercent;
    private strategyStats;
    /**
     * Initializes the auto-trading subsystem
     */
    init(): Promise<void>;
    /**
     * Checks open paper trades against the latest candle
     */
    updatePaperTrades(ctx: StrategyContext): Promise<void>;
    /**
     * Checks if a symbol already has an open paper trade
     */
    hasActiveTrade(symbol: string): boolean;
    /**
     * Executes a trade based on a final signal

     * @param signal The generated and filtered signal
     */
    processSignal(signal: FinalSignal): Promise<void>;
    private placeOrder;
    private placeTakeProfits;
    private placeStopLoss;
}
export declare const tradeExecutor: TradeExecutor;
