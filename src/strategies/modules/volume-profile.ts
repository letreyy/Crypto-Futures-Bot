import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

/**
 * Volume Profile Strategy (simplified)
 * Creates a histogram of volume across price buckets.
 * - HVN (High Volume Node): price level with lots of volume → acts as support/resistance (bounce)
 * - LVN (Low Volume Node): price level with little volume → acts as speed zone (breakout)
 *
 * For futures: HVN = where stops cluster, LVN = where price accelerates through.
 */

const PROFILE_LOOKBACK = 100;
const NUM_BUCKETS = 30;

interface VolumeNode {
    priceLevel: number;
    volume: number;
    type: 'HVN' | 'LVN';
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function buildProfile(candles: { high: number; low: number; close: number; volume: number }[]): VolumeNode[] {
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const minPrice = Math.min(...lows);
    const maxPrice = Math.max(...highs);
    const range = maxPrice - minPrice;

    if (range <= 0) return [];

    const bucketSize = range / NUM_BUCKETS;
    const buckets: number[] = new Array(NUM_BUCKETS).fill(0);

    for (const c of candles) {
        const lo = Math.max(0, Math.floor((c.low - minPrice) / bucketSize));
        const hi = Math.min(NUM_BUCKETS - 1, Math.floor((c.high - minPrice) / bucketSize));
        const span = hi - lo + 1;
        for (let b = lo; b <= hi; b++) {
            buckets[b] += c.volume / span;
        }
    }

    // Use MEDIAN instead of average — adapts to skewed distributions
    const medVol = median(buckets);
    const nodes: VolumeNode[] = [];

    for (let i = 0; i < NUM_BUCKETS; i++) {
        const priceLevel = minPrice + (i + 0.5) * bucketSize;
        if (buckets[i] > medVol * 1.8) {
            // HVN: significantly above median
            nodes.push({ priceLevel, volume: buckets[i], type: 'HVN' });
        } else if (buckets[i] < medVol * 0.4) {
            // LVN: significantly below median
            nodes.push({ priceLevel, volume: buckets[i], type: 'LVN' });
        }
    }

    return nodes;
}

export class VolumeProfileStrategy implements Strategy {
    name = 'Volume Profile';
    id = 'volume-profile';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators } = ctx;
        if (candles.length < PROFILE_LOOKBACK) return null;

        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];
        const profileCandles = candles.slice(-PROFILE_LOOKBACK);
        const nodes = buildProfile(profileCandles);

        if (nodes.length === 0) return null;

        const price = last.close;
        const atr = indicators.atr;

        // ─── HVN Bounce: price approaching a High Volume Node → expect bounce ───
        for (const node of nodes) {
            if (node.type !== 'HVN') continue;
            const distance = Math.abs(price - node.priceLevel);
            if (distance > atr * 0.3) continue; // Must be close — tightened from 0.5

            // Bounce LONG from HVN below
            if (price > node.priceLevel && prev.low <= node.priceLevel * 1.001 && last.close > last.open) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    confidence: 70,
                    reasons: [
                        `HVN support bounce at ${node.priceLevel.toFixed(4)}`,
                        'High volume node acts as support',
                        'Bullish rejection from HVN level'
                    ],
                    expireMinutes: 25
                };
            }

            // Bounce SHORT from HVN above
            if (price < node.priceLevel && prev.high >= node.priceLevel * 0.999 && last.close < last.open) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    confidence: 70,
                    reasons: [
                        `HVN resistance bounce at ${node.priceLevel.toFixed(4)}`,
                        'High volume node acts as resistance',
                        'Bearish rejection from HVN level'
                    ],
                    expireMinutes: 25
                };
            }
        }

        // ─── LVN Breakout: price breaking through a Low Volume Node → expect acceleration ───
        for (const node of nodes) {
            if (node.type !== 'LVN') continue;

            // Need volume for breakout confirmation
            if (last.volume < indicators.volumeSma * 1.3) continue;

            // Bullish breakout through LVN
            if (prev.close < node.priceLevel && last.close > node.priceLevel && last.close > last.open) {
                // Guard: no blocking HVN within 2× ATR above
                const blockingHvn = nodes.some(n => n.type === 'HVN' && n.priceLevel > last.close && n.priceLevel < last.close + atr * 2);
                if (blockingHvn) continue;
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    confidence: 72,
                    reasons: [
                        `LVN breakout above ${node.priceLevel.toFixed(4)}`,
                        'Low volume node = speed zone',
                        'Expect acceleration through thin air'
                    ],
                    expireMinutes: 20
                };
            }

            // Bearish breakdown through LVN
            if (prev.close > node.priceLevel && last.close < node.priceLevel && last.close < last.open) {
                // Guard: no blocking HVN within 2× ATR below
                const blockingHvn = nodes.some(n => n.type === 'HVN' && n.priceLevel < last.close && n.priceLevel > last.close - atr * 2);
                if (blockingHvn) continue;
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    confidence: 72,
                    reasons: [
                        `LVN breakdown below ${node.priceLevel.toFixed(4)}`,
                        'Low volume node = speed zone',
                        'Expect acceleration through thin air'
                    ],
                    expireMinutes: 20
                };
            }
        }

        return null;
    }
}
