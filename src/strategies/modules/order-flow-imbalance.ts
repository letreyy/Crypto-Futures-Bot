import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

export class OrderFlowImbalanceStrategy implements Strategy {
    name = 'Order Flow Imbalance';
    id = 'order-flow-imbalance';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators, liquidity } = ctx;
        const last = candles[candles.length - 1];

        const avgVolume = indicators.volumeSma;
        if (last.volume < avgVolume * 2) return null; // We only care about high volume prints

        const bodySize = Math.abs(last.close - last.open);
        const fullSize = last.high - last.low;
        const bodyRatio = bodySize / fullSize;

        // Buying imbalance / Absorption
        // If price is near local lows, volume is massive, and it closes as a strong pinbar or bullish candle
        if (last.close > last.open && bodyRatio > 0.6 && last.low <= (liquidity.localRangeLow || 0)) {
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                confidence: 85,
                reasons: ['Strong Buying Imbalance at Swing Low', 'High relative volume', 'Bullish Delta approximation'],
                expireMinutes: 20
            };
        }

        // Selling imbalance / Absorption
        // If price is near local highs, volume is massive, and it closes as a strong bearish pinbar or candle
        if (last.close < last.open && bodyRatio > 0.6 && last.high >= (liquidity.localRangeHigh || Number.MAX_SAFE_INTEGER)) {
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                confidence: 85,
                reasons: ['Strong Selling Imbalance at Swing High', 'High relative volume', 'Bearish Delta approximation'],
                expireMinutes: 20
            };
        }

        return null;
    }
}
