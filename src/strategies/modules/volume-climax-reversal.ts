import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

/**
 * Volume Climax Reversal — разворот на экстремальном объёме
 *
 * Логика: Когда крупный игрок массово ликвидирует/набирает позицию,
 * появляется свеча с аномально высоким объёмом и длинным фитилём (тенью).
 * Длинный фитиль = цена была отвергнута на этом уровне.
 * Это один из самых надёжных разворотных сигналов.
 *
 * Условия входа:
 * 1. Объём >= 3.0x от среднего (настоящий выброс, не просто повышенный)
 * 2. Фитиль >= 60% от общего диапазона свечи (отвержение цены)
 * 3. Перед выбросом было 3+ свечи в одном направлении (расходовали импульс)
 * 4. RSI в экстремальной зоне (подтверждение перепроданности/перекупленности)
 *
 * Дополнительный бонус к confidence:
 * - Если свеча «пробила и вернулась» за ключевой уровень (liquidity sweep) → +5
 * - Если объём > 5x → +5
 */

const TREND_LOOKBACK = 6;
const MIN_TREND_CANDLES = 3;
const MIN_VOLUME_RATIO = 3.0;
const MIN_WICK_RATIO = 0.55; // Фитиль >= 55% от всего диапазона свечи

export class VolumeClimaxReversalStrategy implements Strategy {
    name = 'Volume Climax Reversal';
    id = 'volume-climax-reversal';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators, liquidity } = ctx;
        if (candles.length < TREND_LOOKBACK + 3) return null;

        const last = candles[candles.length - 1];
        const fullRange = last.high - last.low;
        if (fullRange <= 0) return null;

        // ─── 1. Объёмный выброс ───
        const volumeRatio = last.volume / indicators.volumeSma;
        if (volumeRatio < MIN_VOLUME_RATIO) return null;

        // ─── 2. Анализ фитилей ───
        const bodyTop = Math.max(last.open, last.close);
        const bodyBot = Math.min(last.open, last.close);
        const upperWick = last.high - bodyTop;
        const lowerWick = bodyBot - last.low;
        const upperWickRatio = upperWick / fullRange;
        const lowerWickRatio = lowerWick / fullRange;

        // ─── 3. Проверка предшествующего тренда ───
        const priorCandles = candles.slice(-(TREND_LOOKBACK + 1), -1);
        let bearCount = 0;
        let bullCount = 0;
        for (const c of priorCandles) {
            if (c.close < c.open) bearCount++;
            else if (c.close > c.open) bullCount++;
        }

        // ═══════════════════════════════════
        // БЫЧИЙ РАЗВОРОТ (Bullish Volume Climax)
        // ═══════════════════════════════════
        // Длинный НИЖНИЙ фитиль после падения = покупатели отвергли цену внизу
        if (
            lowerWickRatio >= MIN_WICK_RATIO &&
            bearCount >= MIN_TREND_CANDLES &&
            indicators.rsi < 38
        ) {
            let confidence = 78;
            const reasons: string[] = [
                `Volume Climax: ${volumeRatio.toFixed(1)}x avg — institutional exhaustion`,
                `Lower wick rejection: ${(lowerWickRatio * 100).toFixed(0)}% of candle range`,
                `${bearCount}/${TREND_LOOKBACK} prior candles bearish → selling exhausted`,
                `RSI oversold: ${indicators.rsi.toFixed(0)}`
            ];

            // Бонус: swept liquidity (пробили уровень и вернулись)
            if (liquidity.sweptLow && liquidity.isWickSweep) {
                confidence += 5;
                reasons.push('Liquidity sweep confirmed — stop hunt reversal');
            }
            // Бонус: экстремальный объём
            if (volumeRatio >= 5.0) {
                confidence += 5;
                reasons.push(`Extreme volume: ${volumeRatio.toFixed(1)}x — likely capitulation`);
            }

            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                orderType: 'MARKET',
                suggestedTarget: indicators.vwap, // Цель — возврат к VWAP
                suggestedSl: last.low - (indicators.atr * 0.15), // Стоп прямо под хвостом
                confidence: Math.min(confidence, 92),
                reasons,
                expireMinutes: 25
            };
        }

        // ═══════════════════════════════════
        // МЕДВЕЖИЙ РАЗВОРОТ (Bearish Volume Climax)
        // ═══════════════════════════════════
        // Длинный ВЕРХНИЙ фитиль после роста = продавцы отвергли цену наверху
        if (
            upperWickRatio >= MIN_WICK_RATIO &&
            bullCount >= MIN_TREND_CANDLES &&
            indicators.rsi > 62
        ) {
            let confidence = 78;
            const reasons: string[] = [
                `Volume Climax: ${volumeRatio.toFixed(1)}x avg — institutional exhaustion`,
                `Upper wick rejection: ${(upperWickRatio * 100).toFixed(0)}% of candle range`,
                `${bullCount}/${TREND_LOOKBACK} prior candles bullish → buying exhausted`,
                `RSI overbought: ${indicators.rsi.toFixed(0)}`
            ];

            // Бонус: swept liquidity
            if (liquidity.sweptHigh && liquidity.isWickSweep) {
                confidence += 5;
                reasons.push('Liquidity sweep confirmed — stop hunt reversal');
            }
            if (volumeRatio >= 5.0) {
                confidence += 5;
                reasons.push(`Extreme volume: ${volumeRatio.toFixed(1)}x — likely distribution`);
            }

            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                orderType: 'MARKET',
                suggestedTarget: indicators.vwap,
                suggestedSl: last.high + (indicators.atr * 0.15),
                confidence: Math.min(confidence, 92),
                reasons,
                expireMinutes: 25
            };
        }

        return null;
    }
}
