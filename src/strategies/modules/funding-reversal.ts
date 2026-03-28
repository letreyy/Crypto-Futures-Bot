import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

export class FundingReversalStrategy implements Strategy {
    name = 'Funding Reversal';
    id = 'funding-reversal';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { funding, candles, indicators } = ctx;
        if (!funding) return null;

        const last = candles[candles.length - 1];
        const change = (last.close - last.open) / last.open;

        if (funding.rate > 0.0005) {
            // Strong bearish candle (reversal)
            if (change < -0.01 && last.volume > indicators.volumeSma * 1.5) {
                const swingHigh = Math.max(...candles.slice(-5).map(c => c.high));
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    suggestedTarget: indicators.vwap, // Mean reversion
                    suggestedSl: swingHigh + (indicators.atr * 0.2), // Behind the local high
                    confidence: 85,
                    reasons: ['Extreme High Funding Rate (Over-leveraged Longs)', 'Bearish reversal candle', 'Volume spike'],
                    expireMinutes: 30
                };
            }
        }

        if (funding.rate < -0.0005) {
            // Strong bullish candle (reversal)
            if (change > 0.01 && last.volume > indicators.volumeSma * 1.5) {
                const swingLow = Math.min(...candles.slice(-5).map(c => c.low));
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    suggestedTarget: indicators.vwap, // Mean reversion
                    suggestedSl: swingLow - (indicators.atr * 0.2),
                    confidence: 85,
                    reasons: ['Extreme Low Funding Rate (Over-leveraged Shorts)', 'Bullish reversal candle', 'Volume spike'],
                    expireMinutes: 30
                };
            }
        }

        return null;
    }
}
