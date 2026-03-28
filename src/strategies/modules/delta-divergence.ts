import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

/**
 * Delta Divergence Strategy — v2
 *
 * Approximates CVD using candle body direction weighted by volume.
 * Detects divergence between PRICE TREND and BUYING/SELLING PRESSURE:
 *
 * - Price trend up over window + net delta negative → bears absorbing (hidden selling) → SHORT
 * - Price trend down over window + net delta positive → bulls absorbing (hidden buying) → LONG
 *
 * Improvements over v1:
 * - Looks at full 3 windows (past / mid / current) to detect turning point
 * - Normalizes delta by ATR so score is comparable across assets
 * - Requires delta sign to actually flip (not just be smaller)
 * - Stricter RSI gating
 */

const WINDOW = 10; // candles per window

/** Signed volume delta: positive = net buying, negative = net selling */
function netDelta(candles: { open: number; close: number; volume: number }[]): number {
    return candles.reduce((sum, c) => {
        const direction = c.close >= c.open ? 1 : -1;
        return sum + c.volume * direction;
    }, 0);
}

/** Simple price return over window */
function priceReturn(candles: { close: number }[]): number {
    return candles[candles.length - 1].close - candles[0].close;
}

export class DeltaDivergenceStrategy implements Strategy {
    name = 'Delta Divergence';
    id = 'delta-divergence';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators } = ctx;
        if (candles.length < WINDOW * 3 + 2) return null;

        // Three back-to-back windows
        const w1 = candles.slice(-(WINDOW * 3), -(WINDOW * 2)); // oldest
        const w2 = candles.slice(-(WINDOW * 2), -WINDOW);       // middle
        const w3 = candles.slice(-WINDOW);                       // most recent

        const delta1 = netDelta(w1);
        const delta2 = netDelta(w2);
        const delta3 = netDelta(w3);

        const price3 = priceReturn(w3);

        // Normalize delta by ATR-equivalent (volumeSma * atr = price-volume unit)
        const normFactor = indicators.volumeSma * indicators.atr;
        if (normFactor <= 0) return null;

        const normDelta3 = delta3 / normFactor;

        // ─── BEARISH divergence: price rising but delta turning negative ───
        // Price went up in window 3, but selling pressure overtook buying (delta flipped negative)
        if (price3 > 0 && delta3 < 0 && delta3 < delta2 * 0.5) {
            // Additional confirm: delta was positive in earlier windows (confirms it's a flip, not noise)
            if (delta1 > 0 || delta2 > 0) {
                if (indicators.rsi > 58) {
                    const swingHigh = Math.max(...candles.slice(-5).map(c => c.high));
                    return {
                        strategyName: this.name,
                        direction: SignalDirection.SHORT,
                        suggestedTarget: indicators.vwap, // Mean reversion
                        suggestedSl: swingHigh + (indicators.atr * 0.2),
                        confidence: 76,
                        reasons: [
                            'Price rising but net delta turned negative',
                            `Delta: ${delta1.toFixed(0)} → ${delta2.toFixed(0)} → ${delta3.toFixed(0)} (flip)`,
                            `Normalized pressure: ${normDelta3.toFixed(2)} units`,
                            'Hidden selling absorption detected'
                        ],
                        expireMinutes: 20
                    };
                }
            }
        }

        // ─── BULLISH divergence: price falling but delta turning positive ───
        if (price3 < 0 && delta3 > 0 && delta3 > delta2 * 0.5) {
            if (delta1 < 0 || delta2 < 0) {
                if (indicators.rsi < 42) {
                    const swingLow = Math.min(...candles.slice(-5).map(c => c.low));
                    return {
                        strategyName: this.name,
                        direction: SignalDirection.LONG,
                        suggestedTarget: indicators.vwap, // Mean reversion
                        suggestedSl: swingLow - (indicators.atr * 0.2),
                        confidence: 76,
                        reasons: [
                            'Price falling but net delta turned positive',
                            `Delta: ${delta1.toFixed(0)} → ${delta2.toFixed(0)} → ${delta3.toFixed(0)} (flip)`,
                            `Normalized pressure: ${normDelta3.toFixed(2)} units`,
                            'Hidden buying absorption detected'
                        ],
                        expireMinutes: 20
                    };
                }
            }
        }

        return null;
    }
}

