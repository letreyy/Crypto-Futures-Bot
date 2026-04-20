import { StrategyContext, StrategySignalCandidate } from '../../../core/types/bot-types.js';
import { SignalDirection, MarketRegimeType } from '../../../core/constants/enums.js';
import { Strategy } from '../../base/strategy.js';
import { TechnicalIndicators } from '../../../market/indicators/indicator-engine.js';

/**
 * 1. EMA Ribbon + VWAP Pullback
 * Type: Trend-following, Long/Short
 * Regime: TREND (ADX > 25)
 */
export class EmaVwapPullbackStrategy implements Strategy {
    name = 'OP EMA Ribbon + VWAP Pullback';
    id = 'ema-vwap-pullback';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { indicators, candles, regime } = ctx;
        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];

        if (regime.type !== MarketRegimeType.TREND || indicators.adx < 25) return null;

        const ema9 = TechnicalIndicators.ema(candles.map(c => c.close), 9);
        const ema21 = indicators.emaRibbon[2];
        const ema50 = indicators.ema50;

        // Use pre-fetched h1 context instead of fetching per strategy per symbol
        if (!ctx.h1Indicators) return null;
        const { ema50: h1Ema50, ema200: h1Ema200 } = ctx.h1Indicators;

        const htfBull = h1Ema50 > h1Ema200;
        const htfBear = h1Ema50 < h1Ema200;

        // ─── LONG ───
        if (ema9 > ema21 && ema21 > ema50 && last.close > indicators.vwap && htfBull) {
            const lookback = candles.slice(-5, -1);
            const touchedEma21 = lookback.some(c => c.low <= ema21);
            if (!touchedEma21) return null;

            const body = Math.abs(last.close - last.open);
            const lowerWick = Math.min(last.open, last.close) - last.low;
            const isBullishEngulfing = last.close > prev.open && last.open < prev.close && last.close > last.open;
            const isPinBar = body > 0 && lowerWick >= 2 * body && last.close > last.open;

            if (!isBullishEngulfing && !isPinBar) return null;

            if (last.volume >= indicators.volumeSma * 1.2) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    suggestedTarget: last.close + (indicators.atr * 3),
                    suggestedSl: Math.min(last.low, ema50) - (indicators.atr * 0.2),
                    confidence: 82,
                    reasons: [
                        'Strong 1h/15m trend alignment',
                        'EMA 21 Pullback confirmed',
                        'Bullish volume spike at support',
                        'Above Session VWAP'
                    ],
                    expireMinutes: 45
                };
            }
        }

        // ─── SHORT ───
        if (ema9 < ema21 && ema21 < ema50 && last.close < indicators.vwap && htfBear) {
            const lookback = candles.slice(-5, -1);
            const touchedEma21 = lookback.some(c => c.high >= ema21);
            if (!touchedEma21) return null;

            const body = Math.abs(last.close - last.open);
            const upperWick = last.high - Math.max(last.open, last.close);
            const isBearishEngulfing = last.close < prev.open && last.open > prev.close && last.close < last.open;
            const isPinBar = body > 0 && upperWick >= 2 * body && last.close < last.open;

            if (!isBearishEngulfing && !isPinBar) return null;

            if (last.volume >= indicators.volumeSma * 1.2) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    suggestedTarget: last.close - (indicators.atr * 3),
                    suggestedSl: Math.max(last.high, ema50) + (indicators.atr * 0.2),
                    confidence: 82,
                    reasons: [
                        'Strong 1h/15m trend alignment',
                        'EMA 21 Pullback confirmed',
                        'Bearish volume spike at resistance',
                        'Below Session VWAP'
                    ],
                    expireMinutes: 45
                };
            }
        }

        return null;
    }
}
