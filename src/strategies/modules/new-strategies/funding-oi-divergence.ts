import { StrategyContext, StrategySignalCandidate } from '../../../core/types/bot-types.js';
import { SignalDirection } from '../../../core/constants/enums.js';
import { Strategy } from '../../base/strategy.js';

/**
 * 4. Funding + OI Divergence
 * Type: Event-based Counter-trend
 * Identifies sentiment extremes (overleveraged longs/shorts)
 */
export class FundingOiDivergenceStrategy implements Strategy {
    name = 'OP Funding + OI Divergence';
    id = 'funding-oi-divergence';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { funding, openInterest, indicators, candles } = ctx;
        if (!funding || !openInterest || openInterest.oiHistory.length < 16) return null;

        const last = candles[candles.length - 1];

        // OI change over history (~4h on 15m OI snapshots)
        const oldOi = openInterest.oiHistory[0];
        const oiChange = (openInterest.oi - oldOi) / oldOi;
        if (Math.abs(oiChange) < 0.08) return null; // relaxed from 10% → 8% (still rare)

        // Use cached 1h RSI
        const rsi1h = ctx.h1Indicators?.rsi ?? 50;

        // Price change over last ~2h (8 × 15m candles)
        const price2hAgo = candles[candles.length - 8].close;
        const priceChange2h = (last.close - price2hAgo) / price2hAgo;

        // ─── SHORT: Overleveraged Longs ───
        if (funding.rate > 0.0005 && indicators.rsi > 70 && rsi1h > 62) {
            // Price stagnation or rejection starting
            if (Math.abs(priceChange2h) < 0.012 || last.close < candles[candles.length - 2].close) {
                const body = Math.abs(last.close - last.open);
                const upperWick = last.high - Math.max(last.open, last.close);
                const isShootingStar = body > 0 && upperWick >= 2 * body;
                const isBearishEngulf = last.close < candles[candles.length - 2].open && last.close < last.open;

                if (isShootingStar || isBearishEngulf) {
                    return {
                        strategyName: this.name,
                        direction: SignalDirection.SHORT,
                        suggestedTarget: last.close - (indicators.atr * 4),
                        suggestedSl: last.high + (indicators.atr * 0.3),
                        confidence: 85,
                        reasons: [
                            `Extreme positive funding (${(funding.rate * 100).toFixed(4)}%)`,
                            `OI surge (${(oiChange * 100).toFixed(1)}%) without price follow-through`,
                            'Overbought 15m + 1h timeframes',
                            'Bearish rejection pattern'
                        ],
                        expireMinutes: 120
                    };
                }
            }
        }

        // ─── LONG: Overleveraged Shorts ───
        if (funding.rate < -0.0005 && indicators.rsi < 30 && rsi1h < 38) {
            if (Math.abs(priceChange2h) < 0.012 || last.close > candles[candles.length - 2].close) {
                const body = Math.abs(last.close - last.open);
                const lowerWick = Math.min(last.open, last.close) - last.low;
                const isHammer = body > 0 && lowerWick >= 2 * body;
                const isBullishEngulf = last.close > candles[candles.length - 2].open && last.close > last.open;

                if (isHammer || isBullishEngulf) {
                    return {
                        strategyName: this.name,
                        direction: SignalDirection.LONG,
                        suggestedTarget: last.close + (indicators.atr * 4),
                        suggestedSl: last.low - (indicators.atr * 0.3),
                        confidence: 85,
                        reasons: [
                            `Extreme negative funding (${(funding.rate * 100).toFixed(4)}%)`,
                            `OI surge (${(oiChange * 100).toFixed(1)}%) without price follow-through`,
                            'Oversold 15m + 1h timeframes',
                            'Bullish reclaim pattern'
                        ],
                        expireMinutes: 120
                    };
                }
            }
        }

        return null;
    }
}
