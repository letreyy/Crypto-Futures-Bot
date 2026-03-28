import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

/**
 * VWAP Bands Strategy
 * Uses VWAP + standard deviation bands (±1σ, ±2σ).
 * On futures:
 *  - Price > +2σ → overextended, short (mean reversion)
 *  - Price < −2σ → oversold, long (mean reversion)
 */

function calculateStdDev(values: number[], mean: number): number {
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
}

export class VwapBandsStrategy implements Strategy {
    name = 'VWAP Extremes';
    id = 'vwap-extremes';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators } = ctx;
        if (candles.length < 100) return null;

        const last = candles[candles.length - 1];
        const vwap = indicators.vwap;

        // Calculate standard deviation of close prices from VWAP over last 100 candles
        const lookback = 100;
        const recentCloses = candles.slice(-lookback).map(c => c.close);
        const stdDev = calculateStdDev(recentCloses, vwap);

        if (stdDev <= 0) return null;

        const band2Upper = vwap + 2 * stdDev;
        const band2Lower = vwap - 2 * stdDev;
        
        const band3Upper = vwap + 3 * stdDev;
        const band3Lower = vwap - 3 * stdDev;

        // We want to catch the knife AT the 3rd deviation when price breaks the 2nd deviation.
        // If price is currently outside the 2nd deviation, set a limit order at the 3rd deviation.
        
        // LONG: price crashed below -2σ -> place limit at -3σ
        if (last.close <= band2Lower && last.close > band3Lower) {
            if (indicators.rsi < 35) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    orderType: 'LIMIT',
                    suggestedEntry: band3Lower,
                    confidence: 85,
                    reasons: [
                        `Price crashed below VWAP -2σ`,
                        `Limit set at -3σ extreme: ${band3Lower.toFixed(4)}`,
                        'Extreme oversold → mean reversion long expected'
                    ],
                    expireMinutes: 120 // 2 hours to catch the knife
                };
            }
        }

        // SHORT: price pumped above +2σ -> place limit at +3σ
        if (last.close >= band2Upper && last.close < band3Upper) {
            if (indicators.rsi > 65) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    orderType: 'LIMIT',
                    suggestedEntry: band3Upper,
                    confidence: 85,
                    reasons: [
                        `Price pumped above VWAP +2σ`,
                        `Limit set at +3σ extreme: ${band3Upper.toFixed(4)}`,
                        'Extreme overbought → mean reversion short expected'
                    ],
                    expireMinutes: 120 // 2 hours to catch the top
                };
            }
        }

        return null;
    }
}
