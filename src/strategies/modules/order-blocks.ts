import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

export class OrderBlocksStrategy implements Strategy {
    name = 'Order Block Retest';
    id = 'order-blocks';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators } = ctx;
        if (candles.length < 50) return null;

        // We look for a recent impulsive move (within last 15 candles)
        // that created an unmitigated Order Block.
        const LOOKBACK = 15;
        
        for (let i = candles.length - 1; i >= candles.length - LOOKBACK; i--) {
            const current = candles[i];
            const prev1 = candles[i - 1];
            const prev2 = candles[i - 2];
            if (!prev1 || !prev2) continue;

            // ─── Bullish Order Block ───
                // 2 consecutive strong bullish candles (impulse)
                const isBullImpulse = 
                    current.close > current.open &&
                    prev1.close > prev1.open &&
                    (current.close - prev1.open) > (indicators.atr * 1.5) &&
                    (current.close - current.open) / (current.high - current.low) > 0.6; // Body-to-wick ratio (strong candles)

                if (isBullImpulse && prev2.close < prev2.open) {
                    // Trend alignment check for long OB
                    if (indicators.ema20 < indicators.ema50) continue;

                    // prev2 is the bearish candle before the impulse (The Order Block)
                    const obHigh = prev2.high;
                    const obLow = prev2.low;
                    const obSizePct = (obHigh - obLow) / obHigh * 100;

                    // Skip "monster" order blocks where SL would be too deep
                    if (obSizePct > 5.0) continue; 

                    // Ensure it's unmitigated (no candle after the impulse has touched obHigh)
                    let unmitigated = true;
                    for (let j = i + 1; j < candles.length; j++) {
                        if (candles[j].low <= obHigh) {
                            unmitigated = false;
                            break;
                        }
                    }

                    if (unmitigated) {
                        // Check if current price is approaching the OB (within 1.5% but not yet touched)
                        const lastPrice = candles[candles.length - 1].close;
                        if (lastPrice > obHigh && lastPrice < obHigh * 1.015) {
                            return {
                                strategyName: this.name,
                                direction: SignalDirection.LONG,
                                orderType: 'LIMIT',
                                suggestedEntry: obHigh, // Limit order at the top of the OB
                                suggestedTarget: ctx.liquidity.localRangeHigh || (obHigh + (obHigh - obLow) * 3), // Target opposite liquidity or 3R
                                suggestedSl: obLow - (indicators.atr * 0.1), // tighter buffer
                                confidence: 85,
                                reasons: [
                                    `Unmitigated Bullish Order Block found at ${obHigh.toFixed(4)}`,
                                    'Price is approaching the OB zone for a retest',
                                    'Trend Alignment: EMA20 > EMA50 confirmed'
                                ],
                                expireMinutes: 60 * 12 // 12 hours to hit the limit
                            };
                        }
                    }
                }

            // ─── Bearish Order Block ───
            // 2 consecutive strong bearish candles (downward impulse)
            const isBearImpulse = 
                current.close < current.open &&
                prev1.close < prev1.open &&
                (prev1.open - current.close) > (indicators.atr * 1.5) &&
                (current.open - current.close) / (current.high - current.low) > 0.6; // Body-to-wick ratio (strong candles)

            if (isBearImpulse && prev2.close > prev2.open) {
                // Trend alignment check
                if (indicators.ema20 > indicators.ema50) continue;

                // prev2 is the bullish candle before the dump
                const obLow = prev2.low;
                const obHigh = prev2.high;
                const obSizePct = (obHigh - obLow) / obLow * 100;

                // Skip "monster" order blocks
                if (obSizePct > 5.0) continue;

                let unmitigated = true;
                for (let j = i + 1; j < candles.length; j++) {
                    if (candles[j].high >= obLow) {
                        unmitigated = false;
                        break;
                    }
                }

                if (unmitigated) {
                    const lastPrice = candles[candles.length - 1].close;
                    if (lastPrice < obLow && lastPrice > obLow * 0.985) {
                        return {
                            strategyName: this.name,
                            direction: SignalDirection.SHORT,
                            orderType: 'LIMIT',
                            suggestedEntry: obLow, // Limit order at the bottom of the OB
                            suggestedTarget: ctx.liquidity.localRangeLow || (obLow - (obHigh - obLow) * 3),
                            suggestedSl: obHigh + (indicators.atr * 0.1), // tighter buffer
                            confidence: 85,
                            reasons: [
                                `Unmitigated Bearish Order Block found at ${obLow.toFixed(4)}`,
                                'Price is approaching the OB zone for a retest',
                                'Trend Alignment: EMA20 < EMA50 confirmed'
                             ],
                            expireMinutes: 60 * 12 // 12 hours
                        };
                    }
                }
            }
        }

        return null;
    }
}
