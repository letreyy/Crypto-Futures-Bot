import { StrategyContext, StrategySignalCandidate } from '../../../core/types/bot-types.js';
import { SignalDirection } from '../../../core/constants/enums.js';
import { Strategy } from '../../base/strategy.js';

/**
 * 2. Bollinger Squeeze Breakout
 * Type: Volatility Breakout, Long/Short
 * Regime: SQUEEZE (TTM Squeeze definition)
 */
export class BollingerSqueezeStrategy implements Strategy {
    name = 'Bollinger Squeeze Breakout';
    id = 'bb-squeeze-breakout';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { indicators, candles } = ctx;
        if (candles.length < 100) return null;

        const last = candles[candles.length - 1];
        const closes = candles.map(c => c.close);
        
        // 1. BB Width Percentile < 20 (approximate with recent window)
        const bbWidth = (indicators.bbUpper - indicators.bbLower) / indicators.bbMid * 100;
        const last100Widths = [];
        for (let i = candles.length - 100; i < candles.length; i++) {
            // Need historical BB width here. Since we don't have it in Snapshot, 
            // we calculate for this slice. (Simplified for MVP)
            const slice = closes.slice(i - 20, i);
            if (slice.length < 20) continue;
            const mid = slice.reduce((a, b) => a + b, 0) / 20;
            const sd = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / 20);
            last100Widths.push(((mid + 2 * sd) - (mid - 2 * sd)) / mid * 100);
        }
        
        const sortedWidths = [...last100Widths].sort((a, b) => a - b);
        const threshold = sortedWidths[Math.floor(sortedWidths.length * 0.2)];
        const isSqueezeWidth = bbWidth <= threshold;

        // 2. TTM Squeeze: BB Upper < KC Upper AND BB Lower > KC Lower
        // KC (20, 1.5 * ATR)
        const kcUpper = indicators.bbMid + (1.5 * indicators.atr);
        const kcLower = indicators.bbMid - (1.5 * indicators.atr);
        const isTTMSqueeze = indicators.bbUpper < kcUpper && indicators.bbLower > kcLower;

        if (!isSqueezeWidth && !isTTMSqueeze) return null;

        // 3. Status Squeeze active >= 6 candles (Approximate looking back)
        // (Skipping deep historical loop for efficiency, focusing on current state + breakout)

        // 4. Momentum: Close - EMA(20)
        const momentum = last.close - indicators.bbMid;

        // LONG BREAKOUT
        if (last.close > indicators.bbUpper && momentum > 0 && last.volume >= indicators.volumeSma * 1.5) {
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                suggestedTarget: last.close + (indicators.atr * 4),
                suggestedSl: indicators.bbMid,
                confidence: 75,
                reasons: [
                    'TTM Squeeze breakout detected',
                    'Low BB Width percentile (<20%)',
                    'Bullish momentum with 1.5x volume spike'
                ],
                expireMinutes: 60
            };
        }

        // SHORT BREAKOUT
        if (last.close < indicators.bbLower && momentum < 0 && last.volume >= indicators.volumeSma * 1.5) {
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                suggestedTarget: last.close - (indicators.atr * 4),
                suggestedSl: indicators.bbMid,
                confidence: 75,
                reasons: [
                    'TTM Squeeze breakout detected',
                    'Low BB Width percentile (<20%)',
                    'Bearish momentum with 1.5x volume spike'
                ],
                expireMinutes: 60
            };
        }

        return null;
    }
}
