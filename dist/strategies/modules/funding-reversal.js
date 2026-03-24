import { SignalDirection } from '../../core/constants/enums.js';
export class FundingReversalStrategy {
    name = 'Funding Reversal';
    id = 'funding-reversal';
    execute(ctx) {
        const { funding, candles, indicators } = ctx;
        if (!funding)
            return null;
        const last = candles[candles.length - 1];
        const change = (last.close - last.open) / last.open;
        // If Funding Rate > 0.05% (Extremely Bullish Sentiment) -> Look for Short opportunities
        if (funding.rate > 0.0005) {
            // Strong bearish candle (reversal)
            if (change < -0.01 && last.volume > indicators.volumeSma * 1.5) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    confidence: 85,
                    reasons: ['Extreme High Funding Rate (Over-leveraged Longs)', 'Bearish reversal candle', 'Volume spike'],
                    expireMinutes: 30
                };
            }
        }
        // If Funding Rate < -0.05% (Extremely Bearish Sentiment) -> Look for Long opportunities
        if (funding.rate < -0.0005) {
            // Strong bullish candle (reversal)
            if (change > 0.01 && last.volume > indicators.volumeSma * 1.5) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    confidence: 85,
                    reasons: ['Extreme Low Funding Rate (Over-leveraged Shorts)', 'Bullish reversal candle', 'Volume spike'],
                    expireMinutes: 30
                };
            }
        }
        return null;
    }
}
//# sourceMappingURL=funding-reversal.js.map