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
    name = 'VWAP Bands';
    id = 'vwap-bands';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators } = ctx;
        if (candles.length < 50) return null;

        const last = candles[candles.length - 1];
        const vwap = indicators.vwap;

        // Calculate standard deviation of close prices from VWAP over last 100 candles
        const lookback = Math.min(100, candles.length);
        const recentCloses = candles.slice(-lookback).map(c => c.close);
        const stdDev = calculateStdDev(recentCloses, vwap);

        if (stdDev <= 0) return null;

        const band2Upper = vwap + 2 * stdDev;
        const band2Lower = vwap - 2 * stdDev;

        const deviation = (last.close - vwap) / stdDev;

        // LONG: price at or below -2σ + bullish candle
        if (last.close <= band2Lower && last.close > last.open) {
            if (indicators.rsi < 35) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    confidence: 76,
                    reasons: [
                        `Price at VWAP -2σ (${deviation.toFixed(2)}σ deviation)`,
                        `VWAP: ${vwap.toFixed(4)} | Band: ${band2Lower.toFixed(4)}`,
                        'Extreme oversold → mean reversion long',
                        'Bullish candle confirmation'
                    ],
                    expireMinutes: 25
                };
            }
        }

        // SHORT: price at or above +2σ + bearish candle
        if (last.close >= band2Upper && last.close < last.open) {
            if (indicators.rsi > 65) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    confidence: 76,
                    reasons: [
                        `Price at VWAP +2σ (${deviation.toFixed(2)}σ deviation)`,
                        `VWAP: ${vwap.toFixed(4)} | Band: ${band2Upper.toFixed(4)}`,
                        'Extreme overbought → mean reversion short',
                        'Bearish candle confirmation'
                    ],
                    expireMinutes: 25
                };
            }
        }

        return null;
    }
}
