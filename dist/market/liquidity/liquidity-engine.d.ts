import { Candle, LiquidityContext } from '../../core/types/bot-types.js';
export declare class LiquidityEngine {
    static getContext(candles: Candle[], lookback?: number): LiquidityContext;
}
