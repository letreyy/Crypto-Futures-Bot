import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

/**
 * EMA Cross Momentum — трендовый вход по пересечению скользящих средних
 *
 * Золотой крест (EMA20 пересекает EMA50 вверх) + объём + ADX → LONG
 * Мёртвый крест (EMA20 пересекает EMA50 вниз) + объём + ADX → SHORT
 *
 * Фильтры:
 * – Пересечение должно быть СВЕЖИМ (текущий бар: EMA20 > EMA50, предыдущий: EMA20 <= EMA50)
 * – ADX > 20 — тренд должен быть реальным, не боковик
 * – Объём >= 1.5x avg — подтверждение институционального участия
 * – Цена должна быть по правильную сторону от EMA200 (трендовый фильтр)
 */
export class EmaCrossMomentumStrategy implements Strategy {
    name = 'EMA Cross Momentum';
    id = 'ema-cross-momentum';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators, prevIndicators } = ctx;
        if (candles.length < 5) return null;

        const last = candles[candles.length - 1];

        // Текущие и предыдущие значения EMA
        const currEma20 = indicators.ema20;
        const currEma50 = indicators.ema50;
        const prevEma20 = prevIndicators.ema20;
        const prevEma50 = prevIndicators.ema50;

        // Фильтр: тренд должен быть (ADX > 20)
        if (indicators.adx < 20) return null;

        // Фильтр: объём
        const volumeRatio = last.volume / indicators.volumeSma;
        if (volumeRatio < 1.5) return null;

        // ─── Золотой крест: EMA20 пересекла EMA50 ВВЕРХ ───
        if (currEma20 > currEma50 && prevEma20 <= prevEma50) {
            // Трендовый фильтр: цена выше EMA200
            if (last.close > indicators.ema200) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    orderType: 'MARKET',
                    suggestedTarget: last.close + (indicators.atr * 3.5),
                    suggestedSl: Math.min(currEma50, last.low) - (indicators.atr * 0.2),
                    confidence: 77,
                    reasons: [
                        'Golden Cross: EMA20 × EMA50 (bullish)',
                        `ADX: ${indicators.adx.toFixed(0)} — confirmed trend`,
                        `Volume: ${volumeRatio.toFixed(1)}x avg`,
                        'Price above EMA200 — trend aligned'
                    ],
                    expireMinutes: 30
                };
            }
        }

        // ─── Мёртвый крест: EMA20 пересекла EMA50 ВНИЗ ───
        if (currEma20 < currEma50 && prevEma20 >= prevEma50) {
            // Трендовый фильтр: цена ниже EMA200
            if (last.close < indicators.ema200) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    orderType: 'MARKET',
                    suggestedTarget: last.close - (indicators.atr * 3.5),
                    suggestedSl: Math.max(currEma50, last.high) + (indicators.atr * 0.2),
                    confidence: 77,
                    reasons: [
                        'Death Cross: EMA20 × EMA50 (bearish)',
                        `ADX: ${indicators.adx.toFixed(0)} — confirmed trend`,
                        `Volume: ${volumeRatio.toFixed(1)}x avg`,
                        'Price below EMA200 — trend aligned'
                    ],
                    expireMinutes: 30
                };
            }
        }

        return null;
    }
}
