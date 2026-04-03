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

        // Extreme POSITIVE funding → over-leveraged longs → expect SHORT reversal
        if (funding.rate > 0.0005) {
            if (change < -0.005 && last.volume > indicators.volumeSma * 1.5) {
                const swingHigh = Math.max(...candles.slice(-5).map(c => c.high));
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    // No suggestedTarget — RiskEngine will use localRangeLow or ATR-based target
                    suggestedSl: swingHigh + (indicators.atr * 0.2),
                    confidence: 80,
                    reasons: [
                        `Extreme Positive Funding: ${(funding.rate * 100).toFixed(4)}% (over-leveraged longs)`,
                        `Bearish reversal candle: ${(change * 100).toFixed(2)}%`,
                        `Volume: ${(last.volume / indicators.volumeSma).toFixed(1)}x avg`
                    ],
                    expireMinutes: 30
                };
            }
        }

        // Extreme NEGATIVE funding → over-leveraged shorts → expect LONG reversal
        if (funding.rate < -0.0005) {
            if (change > 0.005 && last.volume > indicators.volumeSma * 1.5) {
                const swingLow = Math.min(...candles.slice(-5).map(c => c.low));
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    // No suggestedTarget — RiskEngine will use localRangeHigh or ATR-based target
                    suggestedSl: swingLow - (indicators.atr * 0.2),
                    confidence: 80,
                    reasons: [
                        `Extreme Negative Funding: ${(funding.rate * 100).toFixed(4)}% (over-leveraged shorts)`,
                        `Bullish reversal candle: ${(change * 100).toFixed(2)}%`,
                        `Volume: ${(last.volume / indicators.volumeSma).toFixed(1)}x avg`
                    ],
                    expireMinutes: 30
                };
            }
        }

        return null;
    }
}

