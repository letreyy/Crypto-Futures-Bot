import { StrategyContext, StrategySignalCandidate, Candle } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

/**
 * Fair Value Gap (FVG) Strategy
 * Also known as "Imbalance" in ICT / Smart Money Concepts.
 *
 * What is an FVG on futures?
 *  - It's a 3-candle pattern where candle[1] moves so fast that the wicks of candle[0] and candle[2] don't overlap
 *  - This creates a "gap" in price — an area where no two-sided trading occurred
 *  - Futures price tends to return to fill these gaps (especially on liquid perps like Binance)
 *  - The entry is taken when price RETURNS and tests the FVG zone, then shows a rejection
 *
 * Bullish FVG:
 *   candle[0].high < candle[2].low  →  gap between top of first candle and bottom of third = unfilled up-gap
 *   Entry on retest from above when candle[2].low is touched
 *
 * Bearish FVG:
 *   candle[0].low > candle[2].high  →  gap between bottom of first candle and top of third = unfilled down-gap
 *   Entry on retest from below when candle[2].high is touched
 *
 * FVG filters for futures quality:
 *  1. FVG must be recent (within last 30 candles)
 *  2. FVG size must be meaningful (> 0.1% of price) to avoid micro-noise
 *  3. The middle candle (the impulse) must have strong volume (> 1.5x average volume)
 *  4. Overall trend must align (bullish FVG = only trade in uptrend, bearish = downtrend)
 */

interface FVGZone {
    top: number;
    bottom: number;
    midpoint: number;
    direction: 'BULLISH' | 'BEARISH';
    strength: number; // gap size as % of price
    candleIdx: number;
    volumeStrength: number; // impulse volume vs average
    partiallyFilled: boolean; // price has already crossed the midpoint = zone weakened
}

const FVG_LOOKBACK = 50; // search this many candles back for FVGs
const FVG_MIN_SIZE_PCT = 0.08; // minimum gap size (0.08% of price)
const FVG_VOLUME_MULTIPLIER = 1.6; // bumped from 1.4 — require stronger impulse

function findFVGs(candles: Candle[], avgVolume: number): FVGZone[] {
    const zones: FVGZone[] = [];
    const start = Math.max(1, candles.length - FVG_LOOKBACK);
    const end = candles.length - 2; // Leave last 2 candles as "current" price

    for (let i = start; i < end; i++) {
        const c0 = candles[i - 1];
        const c1 = candles[i];     // Impulse candle
        const c2 = candles[i + 1];

        const midPrice = c1.close;
        const minSize = midPrice * (FVG_MIN_SIZE_PCT / 100);
        const volStrength = c1.volume / (avgVolume || 1);

        // Only look at high-volume impulse candles
        if (volStrength < FVG_VOLUME_MULTIPLIER) continue;

        // Bullish FVG: gap between c0.high and c2.low (c1 moved UP strongly)
        if (c2.low > c0.high) {
            const gapSize = c2.low - c0.high;
            if (gapSize >= minSize) {
                const top = c2.low;
                const bottom = c0.high;
                const midpoint = (top + bottom) / 2;
                // Check if any subsequent candle's LOW crossed below the midpoint (partial fill)
                const partiallyFilled = candles.slice(i + 2).some(c => c.low < midpoint);
                zones.push({ top, bottom, midpoint, direction: 'BULLISH', strength: (gapSize / midPrice) * 100, candleIdx: i, volumeStrength: volStrength, partiallyFilled });
            }
        }

        // Bearish FVG: gap between c0.low and c2.high (c1 moved DOWN strongly)
        if (c0.low > c2.high) {
            const gapSize = c0.low - c2.high;
            if (gapSize >= minSize) {
                const top = c0.low;
                const bottom = c2.high;
                const midpoint = (top + bottom) / 2;
                // Check if any subsequent candle's HIGH crossed above the midpoint (partial fill)
                const partiallyFilled = candles.slice(i + 2).some(c => c.high > midpoint);
                zones.push({ top, bottom, midpoint, direction: 'BEARISH', strength: (gapSize / midPrice) * 100, candleIdx: i, volumeStrength: volStrength, partiallyFilled });
            }
        }
    }

    return zones;
}

export class FairValueGapStrategy implements Strategy {
    name = 'Fair Value Gap';
    id = 'fair-value-gap';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators } = ctx;
        if (candles.length < FVG_LOOKBACK + 5) return null;

        const last = candles[candles.length - 1];
        const currentPrice = last.close;

        const fvgZones = findFVGs(candles, indicators.volumeSma);
        if (fvgZones.length === 0) return null;

        const currentIdx = candles.length - 1;

        // ─── Find an unmitigated FVG and place LIMIT at Equilibrium (50%) ───
        for (const zone of fvgZones) {
            const age = currentIdx - zone.candleIdx;

            // FVG must be recent but not literally the current candle
            if (age < 2 || age > 30) continue;

            // Skip zones where price already passed the midpoint (losing/lost their magnetism)
            if (zone.partiallyFilled) continue;

            // ─── BULLISH FVG RETEST ───
            // Price is currently above the midpoint, we set a LIMIT order exactly at the midpoint
            if (zone.direction === 'BULLISH' && currentPrice > zone.midpoint) {
                // Trend filter: price must be in bullish structure
                if (indicators.ema50 < indicators.ema200) continue; // Only trade FVG LONG in HTF uptrend

                // RSI filter: not overbought, meaning there is room to run after the bounce
                if (indicators.rsi > 72) continue;

                // We don't want to set a limit if price is too far away (e.g. 5% away)
                if ((currentPrice - zone.midpoint) / zone.midpoint > 0.05) continue;

                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    orderType: 'LIMIT',
                    suggestedEntry: zone.midpoint, // Equilibrium (50%)
                    confidence: 85,
                    reasons: [
                        `Bullish FVG found: zone ${zone.bottom.toFixed(4)}–${zone.top.toFixed(4)}`,
                        `Targeting FVG Equilibrium (50%): ${zone.midpoint.toFixed(4)}`,
                        `Gap size: ${zone.strength.toFixed(3)}% | Impulse vol: ${zone.volumeStrength.toFixed(1)}x avg`,
                        `FVG age: ${age} candles`
                    ],
                    expireMinutes: 60 * 12 // 12 hours
                };
            }
            // ─── BEARISH FVG RETEST ───
            // Price is currently below the midpoint, we set a LIMIT order exactly at the midpoint
            if (zone.direction === 'BEARISH' && currentPrice < zone.midpoint) {
                // Trend filter: downtrend
                if (indicators.ema50 > indicators.ema200) continue; // Only trade FVG SHORT in HTF downtrend

                // RSI filter: not oversold, meaning room to drop
                if (indicators.rsi < 28) continue;

                // We don't want to set a limit if price is too far away
                if ((zone.midpoint - currentPrice) / zone.midpoint > 0.05) continue;

                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    orderType: 'LIMIT',
                    suggestedEntry: zone.midpoint,
                    confidence: 85,
                    reasons: [
                        `Bearish FVG found: zone ${zone.bottom.toFixed(4)}–${zone.top.toFixed(4)}`,
                        `Targeting FVG Equilibrium (50%): ${zone.midpoint.toFixed(4)}`,
                        `Gap size: ${zone.strength.toFixed(3)}% | Impulse vol: ${zone.volumeStrength.toFixed(1)}x avg`,
                        `FVG age: ${age} candles`
                    ],
                    expireMinutes: 60 * 12 // 12 hours
                };
            }
        }

        return null;
    }
}
