import { StrategyContext, StrategySignalCandidate, Candle } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

/**
 * BOS / CHoCH Strategy (Break of Structure / Change of Character)
 * From Smart Money Concepts (SMC).
 *
 * Logic:
 *  - Identify the last significant swing high and swing low (using a lookback of N candles)
 *  - BOS (trend continuation): In an uptrend, price breaks above the last swing high → LONG
 *  - CHoCH (reversal): In a downtrend, price closes above the last swing high → signals potential reversal → LONG
 *  - Mirror logic for SHORT
 *
 * For futures this is particularly powerful because:
 *  - Large long/short positions are squeezed when structure breaks
 *  - It identifies where stop clusters are (just above swing highs / below swing lows)
 *  - Entry is on confirmed candle close BEYOND the structure level (not wick, body close)
 */

const SWING_LOOKBACK = 10; // number of candles left/right to identify swing points

function findSwings(candles: Candle[], lookback: number): { lastSwingHigh: number; lastSwingLow: number; swingHighIdx: number; swingLowIdx: number } {
    let lastSwingHigh = -Infinity;
    let lastSwingLow = Infinity;
    let swingHighIdx = 0;
    let swingLowIdx = 0;

    // Scan from older candles up to last confirmed swing (exclude last 3 forming candles)
    const end = candles.length - 3;
    for (let i = lookback; i < end; i++) {
        const window = candles.slice(i - lookback, i + lookback + 1);
        const c = candles[i];

        const isSwingHigh = window.every(w => w.high <= c.high);
        const isSwingLow = window.every(w => w.low >= c.low);

        if (isSwingHigh && c.high > lastSwingHigh) {
            lastSwingHigh = c.high;
            swingHighIdx = i;
        }
        if (isSwingLow && c.low < lastSwingLow) {
            lastSwingLow = c.low;
            swingLowIdx = i;
        }
    }

    return { lastSwingHigh, lastSwingLow, swingHighIdx, swingLowIdx };
}

export class BosChochStrategy implements Strategy {
    name = 'BOS/CHoCH';
    id = 'bos-choch';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators } = ctx;
        if (candles.length < SWING_LOOKBACK * 2 + 5) return null;

        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];

        const { lastSwingHigh, lastSwingLow, swingHighIdx, swingLowIdx } = findSwings(candles, SWING_LOOKBACK);

        if (lastSwingHigh === -Infinity || lastSwingLow === Infinity) return null;

        // Require structure levels to be recent (within last 40 candles) to avoid stale levels
        const currentIdx = candles.length - 1;
        const highRecent = currentIdx - swingHighIdx <= 40;
        const lowRecent = currentIdx - swingLowIdx <= 40;

        // ─── BULLISH BOS / CHoCH ───
        // Previous candle was below the swing high, current candle CLOSES above it (body close, not wick)
        // This means buyers had enough force to push price through the structure level
        if (highRecent &&
            prev.close < lastSwingHigh &&
            last.close > lastSwingHigh &&
            last.close > last.open // Bullish candle body
        ) {
            // Quality filter: RSI not overbought, some volume
            if (indicators.rsi > 70) return null; // Already extended

            const swingRange = lastSwingHigh - lastSwingLow;
            const breakStrength = (last.close - lastSwingHigh) / lastSwingHigh * 100;

            // Don't trade micro-breaks (< 0.05%)
            if (breakStrength < 0.05) return null;

            // Distinguish BOS vs CHoCH based on prior trend direction
            const trend = indicators.ema20 > indicators.ema50 ? 'BULLISH' : 'BEARISH';
            const signalType = trend === 'BULLISH' ? 'BOS' : 'CHoCH'; // CHoCH is reversal signal

            const reasons = [
                `${signalType}: Close above swing high at ${lastSwingHigh.toFixed(4)}`,
                `Break strength: ${breakStrength.toFixed(3)}%`,
                `Swing range: ${swingRange.toFixed(4)}`
            ];

            if (signalType === 'CHoCH') {
                reasons.push('Potential trend reversal from bearish to bullish');
            }

            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                confidence: signalType === 'BOS' ? 80 : 75, // CHoCH slightly less confident (reversal)
                reasons,
                expireMinutes: 20
            };
        }

        // ─── BEARISH BOS / CHoCH ───
        if (lowRecent &&
            prev.close > lastSwingLow &&
            last.close < lastSwingLow &&
            last.close < last.open // Bearish candle body
        ) {
            if (indicators.rsi < 30) return null; // Already oversold

            const breakStrength = (lastSwingLow - last.close) / lastSwingLow * 100;
            if (breakStrength < 0.05) return null;

            const trend = indicators.ema20 < indicators.ema50 ? 'BEARISH' : 'BULLISH';
            const signalType = trend === 'BEARISH' ? 'BOS' : 'CHoCH';

            const reasons = [
                `${signalType}: Close below swing low at ${lastSwingLow.toFixed(4)}`,
                `Break strength: ${breakStrength.toFixed(3)}%`,
            ];

            if (signalType === 'CHoCH') {
                reasons.push('Potential trend reversal from bullish to bearish');
            }

            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                confidence: signalType === 'BOS' ? 80 : 75,
                reasons,
                expireMinutes: 20
            };
        }

        return null;
    }
}
