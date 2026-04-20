import { StrategyContext, StrategySignalCandidate } from '../../../core/types/bot-types.js';
import { SignalDirection } from '../../../core/constants/enums.js';
import { Strategy } from '../../base/strategy.js';

/**
 * 3. Range Mean-Reversion
 * Type: Counter-trend in sideways market
 * Regime: RANGE (ADX < 20 on 15m AND 1h)
 */
export class RangeMeanReversionStrategy implements Strategy {
    name = 'OP Range Mean-Reversion';
    id = 'range-mean-reversion';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { indicators, candles } = ctx;
        if (candles.length < 50) return null;

        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];

        if (indicators.adx >= 20) return null;
        if (ctx.h1Indicators && ctx.h1Indicators.adx >= 22) return null;

        const lookback50 = candles.slice(-50);
        const rangeHigh = Math.max(...lookback50.map(c => c.high));
        const rangeLow = Math.min(...lookback50.map(c => c.low));
        const rangeSize = rangeHigh - rangeLow;

        // Need a wide enough range for 1.5R+ to be reachable
        if (rangeSize / last.close < 0.015) return null;

        // Cumulative delta over last 5 candles (proper CVD, not single-candle delta).
        const calcSignedVolume = (c: any) => {
            const r = c.high - c.low;
            if (r === 0) return 0;
            return ((c.close - c.open) / r) * c.volume;
        };
        const recentCvd = candles.slice(-5).reduce((s, c) => s + calcSignedVolume(c), 0);
        const prevCvd = candles.slice(-10, -5).reduce((s, c) => s + calcSignedVolume(c), 0);

        // ─── LONG at range low ───
        if (last.close <= rangeLow + (rangeSize * 0.15) && indicators.rsi < 30) {
            // Confirmation: CVD turning positive AND bullish candle close
            if (recentCvd > prevCvd && last.close > last.open && last.close > prev.close) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    suggestedTarget: indicators.bbMid,
                    suggestedSl: rangeLow - (indicators.atr * 0.5),
                    confidence: 72,
                    reasons: [
                        'Dual-TF range environment (ADX < 20)',
                        'Oversold (RSI < 30) at Range Low',
                        'Cumulative delta turning positive',
                        'Bullish confirmation candle'
                    ],
                    expireMinutes: 60
                };
            }
        }

        // ─── SHORT at range high ───
        if (last.close >= rangeHigh - (rangeSize * 0.15) && indicators.rsi > 70) {
            if (recentCvd < prevCvd && last.close < last.open && last.close < prev.close) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    suggestedTarget: indicators.bbMid,
                    suggestedSl: rangeHigh + (indicators.atr * 0.5),
                    confidence: 72,
                    reasons: [
                        'Dual-TF range environment (ADX < 20)',
                        'Overbought (RSI > 70) at Range High',
                        'Cumulative delta turning negative',
                        'Bearish confirmation candle'
                    ],
                    expireMinutes: 60
                };
            }
        }

        return null;
    }
}
