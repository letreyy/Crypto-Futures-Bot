import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

/**
 * Bollinger Band Reversal — отскок от крайних полос Боллинджера
 *
 * Когда цена выходит за пределы Bollinger Bands и возвращается обратно,
 * это сильный сигнал mean-reversion. Статистически цена находится
 * внутри BB ~95% времени, поэтому выход за пределы — аномалия.
 *
 * LONG: Цена опустилась НИЖЕ нижней BB, затем закрылась ОБРАТНО выше неё.
 * SHORT: Цена поднялась ВЫШЕ верхней BB, затем закрылась ОБРАТНО ниже неё.
 *
 * Фильтры:
 * – RSI подтверждает экстремум (<30 для лонга, >70 для шорта)
 * – Свеча должна быть в направлении разворота (подтверждение)
 * – Предыдущая свеча должна была быть за пределами BB (пробой произошёл)
 * – Объём >= 1.3x (участие рынка в развороте)
 */
export class BollingerBandReversalStrategy implements Strategy {
    name = 'Bollinger Band Reversal';
    id = 'bb-reversal';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators } = ctx;
        if (candles.length < 3) return null;

        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];

        const volumeRatio = last.volume / indicators.volumeSma;
        if (volumeRatio < 1.3) return null;

        // BB width check — не торгуем в экстремально сжатых BB (squeeze), 
        // там пробой, а не отскок
        const bbWidth = ((indicators.bbUpper - indicators.bbLower) / indicators.bbMid) * 100;
        if (bbWidth < 0.8) return null; // Слишком узкие полосы — скорее всего будет breakout

        // ═══════════════════════════════════
        // BULLISH: Отскок от нижней BB
        // ═══════════════════════════════════
        // Предыдущая свеча пробила нижнюю BB (low ниже), текущая закрылась выше
        if (
            prev.low < indicators.bbLower &&          // Предыдущая свеча уходила за нижнюю BB
            last.close > indicators.bbLower &&         // Текущая закрылась обратно выше BB
            last.close > last.open &&                  // Бычья свеча (подтверждение)
            indicators.rsi < 35                        // RSI в зоне перепроданности
        ) {
            // Бонус: если тело свечи маленькое относительно фитиля — pin bar
            const bodySize = Math.abs(last.close - last.open);
            const fullRange = last.high - last.low;
            const isPinBar = fullRange > 0 && bodySize / fullRange < 0.35;

            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                orderType: 'MARKET',
                suggestedTarget: indicators.bbMid, // Цель — средняя линия BB (mean reversion)
                suggestedSl: Math.min(last.low, prev.low) - (indicators.atr * 0.15),
                confidence: isPinBar ? 82 : 76,
                reasons: [
                    'BB Lower Band rejection — mean reversion',
                    `RSI oversold: ${indicators.rsi.toFixed(0)}`,
                    `Volume: ${volumeRatio.toFixed(1)}x avg`,
                    `BB Width: ${bbWidth.toFixed(1)}% — room for reversion`,
                    isPinBar ? 'Pin bar confirmation — strong rejection' : 'Bullish confirmation candle'
                ],
                expireMinutes: 25
            };
        }

        // ═══════════════════════════════════
        // BEARISH: Отскок от верхней BB
        // ═══════════════════════════════════
        if (
            prev.high > indicators.bbUpper &&          // Предыдущая свеча пробила верхнюю BB
            last.close < indicators.bbUpper &&          // Текущая закрылась обратно ниже BB
            last.close < last.open &&                   // Медвежья свеча
            indicators.rsi > 65                         // RSI в зоне перекупленности
        ) {
            const bodySize = Math.abs(last.close - last.open);
            const fullRange = last.high - last.low;
            const isPinBar = fullRange > 0 && bodySize / fullRange < 0.35;

            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                orderType: 'MARKET',
                suggestedTarget: indicators.bbMid,
                suggestedSl: Math.max(last.high, prev.high) + (indicators.atr * 0.15),
                confidence: isPinBar ? 82 : 76,
                reasons: [
                    'BB Upper Band rejection — mean reversion',
                    `RSI overbought: ${indicators.rsi.toFixed(0)}`,
                    `Volume: ${volumeRatio.toFixed(1)}x avg`,
                    `BB Width: ${bbWidth.toFixed(1)}% — room for reversion`,
                    isPinBar ? 'Pin bar confirmation — strong rejection' : 'Bearish confirmation candle'
                ],
                expireMinutes: 25
            };
        }

        return null;
    }
}
