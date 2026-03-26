import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

/**
 * Delta Divergence Strategy
 * Approximated CVD (Cumulative Volume Delta) using candle body direction as proxy.
 * If price is rising but buying delta (volume on bullish candles) is declining → SHORT
 * If price is falling but selling delta (volume on bearish candles) is declining → LONG
 */

const DELTA_LOOKBACK = 20;

function approximateDelta(candles: { open: number; close: number; volume: number }[]): number[] {
    return candles.map(c => {
        const bodyRatio = c.close !== c.open ? (c.close - c.open) / Math.abs(c.close - c.open) : 0;
        return c.volume * bodyRatio; // positive = buying, negative = selling
    });
}

export class DeltaDivergenceStrategy implements Strategy {
    name = 'Delta Divergence';
    id = 'delta-divergence';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators } = ctx;
        if (candles.length < DELTA_LOOKBACK + 5) return null;

        const recent = candles.slice(-DELTA_LOOKBACK);
        const deltas = approximateDelta(recent);

        // Split into two halves to detect divergence
        const half = Math.floor(DELTA_LOOKBACK / 2);
        const secondHalf = recent.slice(half);
        const firstDeltas = deltas.slice(0, half);
        const secondDeltas = deltas.slice(half);

        const priceChange2 = secondHalf[secondHalf.length - 1].close - secondHalf[0].close;

        const cumDelta1 = firstDeltas.reduce((a, b) => a + b, 0);
        const cumDelta2 = secondDeltas.reduce((a, b) => a + b, 0);

        // Bearish divergence: price rising, delta falling
        if (priceChange2 > 0 && cumDelta2 < cumDelta1 * 0.6 && cumDelta2 < 0) {
            if (indicators.rsi > 55) { // Confirmation: RSI somewhat elevated
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    confidence: 75,
                    reasons: [
                        'Price rising but buying delta declining',
                        `CumDelta shift: ${cumDelta1.toFixed(0)} → ${cumDelta2.toFixed(0)}`,
                        'Hidden selling pressure detected'
                    ],
                    expireMinutes: 20
                };
            }
        }

        // Bullish divergence: price falling, delta rising
        if (priceChange2 < 0 && cumDelta2 > cumDelta1 * 0.6 && cumDelta2 > 0) {
            if (indicators.rsi < 45) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    confidence: 75,
                    reasons: [
                        'Price falling but selling delta declining',
                        `CumDelta shift: ${cumDelta1.toFixed(0)} → ${cumDelta2.toFixed(0)}`,
                        'Hidden buying pressure detected'
                    ],
                    expireMinutes: 20
                };
            }
        }

        return null;
    }
}
