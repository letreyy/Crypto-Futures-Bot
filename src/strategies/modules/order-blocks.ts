import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

/**
 * Order Block Retest
 * Identifies an unmitigated order block before a strong displacement and
 * places a LIMIT order inside the block (50% fill) for retest entry.
 */
export class OrderBlocksStrategy implements Strategy {
    name = 'Order Block Retest';
    id = 'order-blocks';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators } = ctx;
        if (candles.length < 50) return null;

        const LOOKBACK = 15;

        for (let i = candles.length - 1; i >= candles.length - LOOKBACK; i--) {
            const current = candles[i];
            const prev1 = candles[i - 1];
            const prev2 = candles[i - 2];
            if (!prev1 || !prev2) continue;

            // ─── Bullish Order Block ───
            const isBullImpulse =
                current.close > current.open &&
                prev1.close > prev1.open &&
                (current.close - prev1.open) > (indicators.atr * 1.5) &&
                (current.close - current.open) / Math.max(1e-9, current.high - current.low) > 0.6;

            if (isBullImpulse && prev2.close < prev2.open) {
                if (indicators.ema20 < indicators.ema50) continue;

                const obHigh = prev2.high;
                const obLow = prev2.low;
                const obSizePct = (obHigh - obLow) / obHigh * 100;
                if (obSizePct > 5.0 || obSizePct < 0.05) continue;

                // Softer "unmitigated": allow shallow touches (up to 30% into the block).
                const mitigationThreshold = obHigh - (obHigh - obLow) * 0.3;
                let deeplyMitigated = false;
                for (let j = i + 1; j < candles.length; j++) {
                    if (candles[j].low <= mitigationThreshold) {
                        deeplyMitigated = true;
                        break;
                    }
                }
                if (deeplyMitigated) continue;

                const lastPrice = candles[candles.length - 1].close;
                // Approach band: price above the OB but within 2% of top.
                if (lastPrice > obHigh && lastPrice < obHigh * 1.02) {
                    // Place LIMIT at 50% into the block (more realistic fill probability).
                    const limitEntry = obHigh - (obHigh - obLow) * 0.5;
                    return {
                        strategyName: this.name,
                        direction: SignalDirection.LONG,
                        orderType: 'LIMIT',
                        suggestedEntry: limitEntry,
                        suggestedTarget: ctx.liquidity.localRangeHigh && ctx.liquidity.localRangeHigh > limitEntry
                            ? ctx.liquidity.localRangeHigh
                            : limitEntry + (obHigh - obLow) * 4,
                        suggestedSl: obLow - (indicators.atr * 0.15),
                        confidence: 85,
                        reasons: [
                            `Unmitigated Bullish OB at ${obHigh.toFixed(4)}-${obLow.toFixed(4)}`,
                            'Price approaching — limit inside OB (50% depth)',
                            'Trend aligned: EMA20 > EMA50'
                        ],
                        expireMinutes: 60 * 8
                    };
                }
            }

            // ─── Bearish Order Block ───
            const isBearImpulse =
                current.close < current.open &&
                prev1.close < prev1.open &&
                (prev1.open - current.close) > (indicators.atr * 1.5) &&
                (current.open - current.close) / Math.max(1e-9, current.high - current.low) > 0.6;

            if (isBearImpulse && prev2.close > prev2.open) {
                if (indicators.ema20 > indicators.ema50) continue;

                const obLow = prev2.low;
                const obHigh = prev2.high;
                const obSizePct = (obHigh - obLow) / obLow * 100;
                if (obSizePct > 5.0 || obSizePct < 0.05) continue;

                const mitigationThreshold = obLow + (obHigh - obLow) * 0.3;
                let deeplyMitigated = false;
                for (let j = i + 1; j < candles.length; j++) {
                    if (candles[j].high >= mitigationThreshold) {
                        deeplyMitigated = true;
                        break;
                    }
                }
                if (deeplyMitigated) continue;

                const lastPrice = candles[candles.length - 1].close;
                if (lastPrice < obLow && lastPrice > obLow * 0.98) {
                    const limitEntry = obLow + (obHigh - obLow) * 0.5;
                    return {
                        strategyName: this.name,
                        direction: SignalDirection.SHORT,
                        orderType: 'LIMIT',
                        suggestedEntry: limitEntry,
                        suggestedTarget: ctx.liquidity.localRangeLow && ctx.liquidity.localRangeLow < limitEntry
                            ? ctx.liquidity.localRangeLow
                            : limitEntry - (obHigh - obLow) * 4,
                        suggestedSl: obHigh + (indicators.atr * 0.15),
                        confidence: 85,
                        reasons: [
                            `Unmitigated Bearish OB at ${obHigh.toFixed(4)}-${obLow.toFixed(4)}`,
                            'Price approaching — limit inside OB (50% depth)',
                            'Trend aligned: EMA20 < EMA50'
                        ],
                        expireMinutes: 60 * 8
                    };
                }
            }
        }

        return null;
    }
}
