import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

export class OIDivergenceStrategy implements Strategy {
    name = 'OI Divergence';
    id = 'oi-divergence';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { openInterest, candles } = ctx;
        if (!openInterest || openInterest.oiHistory.length < 5) return null;

        const lastCandle = candles[candles.length - 1];
        const prevCandle = candles[candles.length - 2];
        const priceChange = (lastCandle.close - prevCandle.close) / prevCandle.close;

        // Compare current OI with OI from 5 periods ago
        const currentOI = openInterest.oi;
        const pastOI = openInterest.oiHistory[openInterest.oiHistory.length - 5]; 
        const oiChange = (currentOI - pastOI) / pastOI;

        // Scenario 1: Price goes up significantly, but OI goes down -> Longs are closing, weakening trend
        if (priceChange > 0.01 && oiChange < -0.01) {
                const swingHigh = Math.max(...candles.slice(-5).map(c => c.high));
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    suggestedTarget: ctx.liquidity.localRangeLow || undefined,
                    suggestedSl: swingHigh + (ctx.indicators.atr * 0.2),
                    confidence: 70,
                    reasons: ['Price up but OI down (Longs taking profit)', 'Trend weakening divergence'],
                    expireMinutes: 20
                };
        }

        // Scenario 2: Price goes down significantly, but OI goes down -> Shorts are closing, weakening downtrend
        if (priceChange < -0.01 && oiChange < -0.01) {
                const swingLow = Math.min(...candles.slice(-5).map(c => c.low));
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    suggestedTarget: ctx.liquidity.localRangeHigh || undefined,
                    suggestedSl: swingLow - (ctx.indicators.atr * 0.2),
                    confidence: 70,
                    reasons: ['Price down but OI down (Shorts taking profit)', 'Trend weakening divergence'],
                    expireMinutes: 20
                };
        }

        // Scenario 3: Price drops rapidly, OI shoots up -> Aggressive new Shorts entering, potential bounce squeeze later,
        // but for now, we follow the momentum downward or use it as a warning.
        // For the sake of a clear signal, we look for divergence, not following.

        return null;
    }
}
