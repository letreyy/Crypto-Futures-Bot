import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

/**
 * 2. Volatility Squeeze (NR7 + BB Expansion)
 * Identifies periods of extreme volatility contraction (NR7)
 * and enters on the subsequent expansion with volume confirmation.
 */
export class VolatilitySqueezeStrategy implements Strategy {
    name = 'Volatility Squeeze';
    id = 'vol-squeeze';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators } = ctx;
        if (candles.length < 8) return null;

        const last = candles[candles.length - 1];
        const last7 = candles.slice(-7);
        
        // 1. NR7: Current candle range is the smallest in the last 7
        const currentRange = last.high - last.low;
        const previousRanges = last7.slice(0, -1).map(c => c.high - c.low);
        const isNR7 = currentRange < Math.min(...previousRanges);
        
        if (!isNR7) return null;

        // 2. BB Squeeze: BB Width should be low (e.g. less than 0.8% of price)
        const bbWidth = (indicators.bbUpper - indicators.bbLower) / last.close * 100;
        if (bbWidth > 1.2) return null; // Only tight squeezes

        // 3. Expansion + Volume: If the next candle (we are looking at the current closed one) 
        // broke out OR if current candle is already starting to expand (hard to tell on closed).
        // Since we scan every 30s, we can look for breakout of previous NR7 high/low.
        
        // For simplicity in a 15m scanning setup: 
        // If NR7 + Tight BB + Volume spike + Close near High/Low -> Entry
        if (last.volume > indicators.volumeSma * 1.5) {
            if (last.close >= last.high - (currentRange * 0.1)) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    suggestedTarget: last.close + (indicators.atr * 4.0),
                    suggestedSl: last.low - (indicators.atr * 0.2),
                    confidence: 80,
                    reasons: ['NR7 Volatility Contraction', 'BB Squeeze (width < 1.2%)', 'Bullish Expansion + Volume'],
                    expireMinutes: 30
                };
            }
            if (last.close <= last.low + (currentRange * 0.1)) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    suggestedTarget: last.close - (indicators.atr * 4.0),
                    suggestedSl: last.high + (indicators.atr * 0.2),
                    confidence: 80,
                    reasons: ['NR7 Volatility Contraction', 'BB Squeeze (width < 1.2%)', 'Bearish Expansion + Volume'],
                    expireMinutes: 30
                };
            }
        }

        return null;
    }
}
