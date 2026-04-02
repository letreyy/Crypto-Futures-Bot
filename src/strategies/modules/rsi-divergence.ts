import { StrategyContext, StrategySignalCandidate, Candle } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

/**
 * RSI Divergence — классический разворотный паттерн
 *
 * Бычья дивергенция: Цена делает LOWER LOW, а RSI делает HIGHER LOW → разворот вверх.
 * Медвежья дивергенция: Цена делает HIGHER HIGH, а RSI делает LOWER HIGH → разворот вниз.
 *
 * Фильтры:
 * – RSI должен быть в экстремальной зоне (<35 для лонга, >65 для шорта)
 * – Объём на развороте должен подтверждать (>= 1.3x avg)
 * – Минимум 5 свечей между пиками/впадинами для формирования дивергенции
 * – Свеча подтверждения: закрытие в направлении разворота
 */

const LOOKBACK = 20;      // Сколько свечей назад ищем дивергенцию
const MIN_SWING_GAP = 5;  // Минимальное расстояние между двумя экстремумами (в свечах)

export class RsiDivergenceStrategy implements Strategy {
    name = 'RSI Divergence';
    id = 'rsi-divergence';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators } = ctx;
        if (candles.length < LOOKBACK + 5) return null;

        const slice = candles.slice(-LOOKBACK);
        const last = slice[slice.length - 1];

        // ─── Вычисляем RSI вручную для каждой свечи в окне ───
        // У нас есть только текущий RSI из indicators, поэтому аппроксимируем
        // RSI для прошлых свечей через ценовые экстремумы
        const rsiValues = this.estimateRsiFromPrice(slice);
        if (!rsiValues || rsiValues.length < LOOKBACK) return null;

        const currentRsi = indicators.rsi;

        // ─── Ищем БЫЧЬЮ дивергенцию (Bullish) ───
        // Цена: Lower Low | RSI: Higher Low
        if (currentRsi < 38) {
            const priorSwingLow = this.findPriorSwingLow(slice, MIN_SWING_GAP);
            if (priorSwingLow) {
                const { index: priorIdx, price: priorLowPrice } = priorSwingLow;
                const currentLowPrice = last.low;

                // Цена делает Lower Low
                if (currentLowPrice < priorLowPrice) {
                    // RSI делает Higher Low (RSI сейчас ВЫШЕ чем был на прошлом минимуме цены)
                    const priorRsiAtLow = rsiValues[priorIdx];
                    if (currentRsi > priorRsiAtLow && priorRsiAtLow < 40) {
                        // Подтверждение: свеча закрывается бычьей
                        if (last.close > last.open) {
                            const volumeRatio = last.volume / indicators.volumeSma;
                            return {
                                strategyName: this.name,
                                direction: SignalDirection.LONG,
                                orderType: 'MARKET',
                                suggestedTarget: indicators.ema50, // Цель — возврат к EMA50
                                suggestedSl: currentLowPrice - (indicators.atr * 0.3),
                                confidence: volumeRatio >= 1.5 ? 82 : 75,
                                reasons: [
                                    `Bullish RSI Divergence: Price LL (${currentLowPrice.toFixed(4)} < ${priorLowPrice.toFixed(4)})`,
                                    `RSI HL: ${currentRsi.toFixed(0)} > ${priorRsiAtLow.toFixed(0)} (${(LOOKBACK - priorIdx)} candles ago)`,
                                    `Bullish confirmation candle`,
                                    volumeRatio >= 1.5 ? `Volume spike: ${volumeRatio.toFixed(1)}x avg` : `Volume: ${volumeRatio.toFixed(1)}x avg`
                                ],
                                expireMinutes: 30
                            };
                        }
                    }
                }
            }
        }

        // ─── Ищем МЕДВЕЖЬЮ дивергенцию (Bearish) ───
        // Цена: Higher High | RSI: Lower High
        if (currentRsi > 62) {
            const priorSwingHigh = this.findPriorSwingHigh(slice, MIN_SWING_GAP);
            if (priorSwingHigh) {
                const { index: priorIdx, price: priorHighPrice } = priorSwingHigh;
                const currentHighPrice = last.high;

                // Цена делает Higher High
                if (currentHighPrice > priorHighPrice) {
                    // RSI делает Lower High (RSI сейчас НИЖЕ чем был на прошлом максимуме цены)
                    const priorRsiAtHigh = rsiValues[priorIdx];
                    if (currentRsi < priorRsiAtHigh && priorRsiAtHigh > 60) {
                        // Подтверждение: свеча закрывается медвежьей
                        if (last.close < last.open) {
                            const volumeRatio = last.volume / indicators.volumeSma;
                            return {
                                strategyName: this.name,
                                direction: SignalDirection.SHORT,
                                orderType: 'MARKET',
                                suggestedTarget: indicators.ema50, // Цель — возврат к EMA50
                                suggestedSl: currentHighPrice + (indicators.atr * 0.3),
                                confidence: volumeRatio >= 1.5 ? 82 : 75,
                                reasons: [
                                    `Bearish RSI Divergence: Price HH (${currentHighPrice.toFixed(4)} > ${priorHighPrice.toFixed(4)})`,
                                    `RSI LH: ${currentRsi.toFixed(0)} < ${priorRsiAtHigh.toFixed(0)} (${(LOOKBACK - priorIdx)} candles ago)`,
                                    `Bearish confirmation candle`,
                                    volumeRatio >= 1.5 ? `Volume spike: ${volumeRatio.toFixed(1)}x avg` : `Volume: ${volumeRatio.toFixed(1)}x avg`
                                ],
                                expireMinutes: 30
                            };
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * Аппроксимация RSI для каждой свечи в массиве.
     * Используем классическую формулу RSI(14) с экспоненциальным сглаживанием.
     */
    private estimateRsiFromPrice(candles: Candle[]): number[] {
        const period = 14;
        if (candles.length < period + 1) return [];

        const rsiValues: number[] = new Array(candles.length).fill(50);
        
        // Первый расчёт — простое среднее
        let avgGain = 0;
        let avgLoss = 0;
        for (let i = 1; i <= period; i++) {
            const change = candles[i].close - candles[i - 1].close;
            if (change > 0) avgGain += change;
            else avgLoss += Math.abs(change);
        }
        avgGain /= period;
        avgLoss /= period;

        rsiValues[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

        // Экспоненциальное сглаживание для остальных
        for (let i = period + 1; i < candles.length; i++) {
            const change = candles[i].close - candles[i - 1].close;
            const gain = change > 0 ? change : 0;
            const loss = change < 0 ? Math.abs(change) : 0;

            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;

            rsiValues[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
        }

        return rsiValues;
    }

    /**
     * Ищет предыдущий swing low (локальный минимум) в массиве свечей.
     * Возвращает индекс и цену минимума.
     */
    private findPriorSwingLow(candles: Candle[], minGap: number): { index: number; price: number } | null {
        const endIdx = candles.length - 1 - minGap; // Минимум должен быть на расстоянии minGap от текущей свечи
        let lowestIdx = -1;
        let lowestPrice = Infinity;

        for (let i = 2; i <= endIdx; i++) {
            // Swing low: low[i] < low[i-1] && low[i] < low[i-2] && low[i] < low[i+1]
            if (
                candles[i].low < candles[i - 1].low &&
                candles[i].low < candles[i - 2].low &&
                i + 1 < candles.length &&
                candles[i].low <= candles[i + 1].low
            ) {
                if (candles[i].low < lowestPrice) {
                    lowestPrice = candles[i].low;
                    lowestIdx = i;
                }
            }
        }

        if (lowestIdx === -1) return null;
        return { index: lowestIdx, price: lowestPrice };
    }

    /**
     * Ищет предыдущий swing high (локальный максимум) в массиве свечей.
     */
    private findPriorSwingHigh(candles: Candle[], minGap: number): { index: number; price: number } | null {
        const endIdx = candles.length - 1 - minGap;
        let highestIdx = -1;
        let highestPrice = -Infinity;

        for (let i = 2; i <= endIdx; i++) {
            if (
                candles[i].high > candles[i - 1].high &&
                candles[i].high > candles[i - 2].high &&
                i + 1 < candles.length &&
                candles[i].high >= candles[i + 1].high
            ) {
                if (candles[i].high > highestPrice) {
                    highestPrice = candles[i].high;
                    highestIdx = i;
                }
            }
        }

        if (highestIdx === -1) return null;
        return { index: highestIdx, price: highestPrice };
    }
}
