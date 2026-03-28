import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

/**
 * Absorption Strategy — v2
 *
 * A high-volume doji/spinning-top candle AFTER a sustained directional move signals
 * that one side is absorbing the other's aggression. The key is context:
 * - You MUST see 3+ candles moving in one direction BEFORE the absorption candle
 * - The absorption candle must have a large range (traded a lot, went nowhere)
 * - Volume must be exceptional (2.5x+ average)
 */

const TREND_LOOKBACK = 5; // candles to check for prior trend
const MIN_TREND_CANDLES = 3; // minimum consecutive same-direction candles

export class AbsorptionStrategy implements Strategy {
    name = 'Absorption';
    id = 'absorption';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators } = ctx;
        if (candles.length < TREND_LOOKBACK + 3) return null;

        const last = candles[candles.length - 1];

        // ─── Absorption candle conditions ───
        const bodySize = Math.abs(last.close - last.open);
        const fullRange = last.high - last.low;
        if (fullRange <= 0) return null;

        const bodyRatio = bodySize / fullRange;
        const volumeRatio = last.volume / indicators.volumeSma;

        // Strict: tiny body (< 20% of range), high volume (2.5x+), AND range >= 0.5× ATR (not a tiny candle)
        if (volumeRatio < 2.5) return null;
        if (bodyRatio > 0.20) return null;
        if (fullRange < indicators.atr * 0.5) return null; // Must be a wide-ranging candle, not just a tiny doji

        // ─── Prior trend check: count consecutive directional candles ───
        const priorCandles = candles.slice(-(TREND_LOOKBACK + 1), -1);
        let bearCount = 0;
        let bullCount = 0;

        for (const c of priorCandles) {
            if (c.close < c.open) bearCount++;
            else if (c.close > c.open) bullCount++;
        }

        // ─── BULLISH ABSORPTION: 3+ bearish candles before → bears exhausted ───
        if (bearCount >= MIN_TREND_CANDLES && indicators.rsi < 38) {
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                suggestedTarget: indicators.vwap, // Mean reversion back to VWAP
                suggestedSl: last.low - (indicators.atr * 0.2), // Micro SL below the absorption candle
                confidence: 76,
                reasons: [
                    `${bearCount}/${TREND_LOOKBACK} prior candles bearish (trend context)`,
                    `Volume absorption: ${volumeRatio.toFixed(1)}x avg | Body: ${(bodyRatio * 100).toFixed(0)}% of range`,
                    `Wide range: ${(fullRange / indicators.atr).toFixed(2)}× ATR — genuine absorption`,
                    'RSI oversold → reversal setup'
                ],
                expireMinutes: 20
            };
        }

        // ─── BEARISH ABSORPTION: 3+ bullish candles before → bulls exhausted ───
        if (bullCount >= MIN_TREND_CANDLES && indicators.rsi > 62) {
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                suggestedTarget: indicators.vwap, // Mean reversion back to VWAP
                suggestedSl: last.high + (indicators.atr * 0.2), // Micro SL above the absorption candle
                confidence: 76,
                reasons: [
                    `${bullCount}/${TREND_LOOKBACK} prior candles bullish (trend context)`,
                    `Volume absorption: ${volumeRatio.toFixed(1)}x avg | Body: ${(bodyRatio * 100).toFixed(0)}% of range`,
                    `Wide range: ${(fullRange / indicators.atr).toFixed(2)}× ATR — genuine absorption`,
                    'RSI overbought → reversal setup'
                ],
                expireMinutes: 20
            };
        }

        return null;
    }
}

