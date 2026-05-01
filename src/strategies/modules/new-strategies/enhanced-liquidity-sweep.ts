import { StrategyContext, StrategySignalCandidate } from '../../../core/types/bot-types.js';
import { SignalDirection } from '../../../core/constants/enums.js';
import { Strategy } from '../../base/strategy.js';

/**
 * 5. Enhanced Liquidity Sweep (Smart Money Concept)
 * Captures Equal Highs/Lows level sweeps with volume reclaim.
 */
export class EnhancedLiquiditySweepStrategy implements Strategy {
    name = 'OP Enhanced Liquidity Sweep';
    id = 'enhanced-liquidity-sweep';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { indicators, candles } = ctx;
        if (candles.length < 50 || !ctx.h1Candles || ctx.h1Candles.length < 30) return null;

        const last = candles[candles.length - 1];
        const h1 = ctx.h1Candles;

        // ─── Filter 1: skip ultra-volatile symbols (memecoins) ───
        // Historical losers (BULLAUSDT, PIPPINUSDT, CRVUSDT, RIVERUSDT) all had 5%+ ATR,
        // where the swept level is meaningless — the next 15m candle moves further than
        // the SL allows.
        if (indicators.atr / last.close > 0.03) return null;

        // ─── HTF context: block counter-trend entries against a strong 1h trend ───
        const h1Adx = ctx.h1Indicators?.adx ?? 0;
        const h1Bull = ctx.h1Indicators ? ctx.h1Indicators.ema50 > ctx.h1Indicators.ema200 : false;
        const h1Bear = ctx.h1Indicators ? ctx.h1Indicators.ema50 < ctx.h1Indicators.ema200 : false;
        const strongHtfTrend = h1Adx > 30;

        // Build sorted arrays of lows/highs in O(n), find cluster centres.
        // "Equal" = within 0.15% of each other (tighter than original 0.2%).
        const TOL = 0.0015;

        const findCluster = (values: number[]): number | null => {
            // Bucket similar values; return the cluster with highest frequency.
            const buckets: { price: number; count: number; members: number[] }[] = [];
            for (const v of values) {
                let placed = false;
                for (const b of buckets) {
                    if (Math.abs(v - b.price) / b.price < TOL) {
                        b.members.push(v);
                        b.price = b.members.reduce((a, c) => a + c, 0) / b.members.length;
                        b.count++;
                        placed = true;
                        break;
                    }
                }
                if (!placed) buckets.push({ price: v, count: 1, members: [v] });
            }
            buckets.sort((a, b) => b.count - a.count);
            const top = buckets[0];
            return top && top.count >= 2 ? top.price : null;
        };

        const eqLows = findCluster(h1.map(c => c.low));
        const eqHighs = findCluster(h1.map(c => c.high));

        // ─── LONG: sweep of equal lows + reclaim ───
        // Skip if HTF is strongly bearish — sweep-and-reclaim against momentum keeps failing.
        if (eqLows && last.low < eqLows * (1 - 0.003) && !(strongHtfTrend && h1Bear)) {
            if (last.close > eqLows && last.volume >= indicators.volumeSma * 1.5) {
                const range = last.high - last.low;
                const deltaRatio = range > 0 ? (last.close - last.open) / range : 0;
                if (deltaRatio > 0.3) {
                    // LIMIT just above the swept level — wait for retest from above
                    // instead of chasing the reclaim candle close.
                    const limitEntry = eqLows * 1.001;
                    return {
                        strategyName: this.name,
                        direction: SignalDirection.LONG,
                        orderType: 'LIMIT',
                        suggestedEntry: limitEntry,
                        suggestedTarget: limitEntry + (indicators.atr * 4),
                        suggestedSl: last.low - (indicators.atr * 0.2),
                        confidence: 88,
                        reasons: [
                            `Equal Lows liquidity pool (${eqLows.toFixed(4)}) on 1h swept`,
                            'Volume reclaim (≥1.5x avg)',
                            'Bullish close — limit at swept-level retest'
                        ],
                        expireMinutes: 90
                    };
                }
            }
        }

        // ─── SHORT: sweep of equal highs + reclaim ───
        if (eqHighs && last.high > eqHighs * (1 + 0.003) && !(strongHtfTrend && h1Bull)) {
            if (last.close < eqHighs && last.volume >= indicators.volumeSma * 1.5) {
                const range = last.high - last.low;
                const deltaRatio = range > 0 ? (last.close - last.open) / range : 0;
                if (deltaRatio < -0.3) {
                    const limitEntry = eqHighs * 0.999;
                    return {
                        strategyName: this.name,
                        direction: SignalDirection.SHORT,
                        orderType: 'LIMIT',
                        suggestedEntry: limitEntry,
                        suggestedTarget: limitEntry - (indicators.atr * 4),
                        suggestedSl: last.high + (indicators.atr * 0.2),
                        confidence: 88,
                        reasons: [
                            `Equal Highs liquidity pool (${eqHighs.toFixed(4)}) on 1h swept`,
                            'Volume reclaim (≥1.5x avg)',
                            'Bearish close — limit at swept-level retest'
                        ],
                        expireMinutes: 90
                    };
                }
            }
        }

        return null;
    }
}
