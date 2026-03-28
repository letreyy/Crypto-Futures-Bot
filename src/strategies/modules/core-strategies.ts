import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';


export class VWAPReversionStrategy implements Strategy {
    name = 'VWAP Reversion';
    id = 'vwap-reversion';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { indicators, candles } = ctx;
        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];

        // Adaptive threshold: deviation must exceed 1.5× ATR from VWAP
        // This scales with actual market volatility instead of fixed 2%
        const deviationAbs = Math.abs(last.close - indicators.vwap);
        const adaptiveThreshold = indicators.atr * 1.5;
        if (deviationAbs < adaptiveThreshold) return null;

        const deviation = (last.close - indicators.vwap) / indicators.vwap;
        const deviationPct = (deviation * 100).toFixed(2);

        // LONG: price overextended below VWAP + bullish candle confirmation
        if (last.close < indicators.vwap && indicators.rsi < 35) {
            // Candle confirmation: current or previous must have started bouncing
            const bullishConfirm = last.close > last.open || (prev.close < indicators.vwap && last.close > prev.close);
            if (!bullishConfirm) return null;

            if (last.volume > indicators.volumeSma * 1.3) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    confidence: 77,
                    reasons: [
                        `VWAP deviation: ${deviationPct}% (>${(adaptiveThreshold / indicators.vwap * 100).toFixed(2)}% threshold)`,
                        'RSI oversold confirmation',
                        'Volume + bullish candle confirm reversal'
                    ],
                    expireMinutes: 20
                };
            }
        }

        // SHORT: price overextended above VWAP + bearish candle confirmation
        if (last.close > indicators.vwap && indicators.rsi > 65) {
            const bearishConfirm = last.close < last.open || (prev.close > indicators.vwap && last.close < prev.close);
            if (!bearishConfirm) return null;

            if (last.volume > indicators.volumeSma * 1.3) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    confidence: 77,
                    reasons: [
                        `VWAP deviation: +${deviationPct}% (>${(adaptiveThreshold / indicators.vwap * 100).toFixed(2)}% threshold)`,
                        'RSI overbought confirmation',
                        'Volume + bearish candle confirm rejection'
                    ],
                    expireMinutes: 20
                };
            }
        }

        return null;
    }
}

export class LiquiditySweepStrategy implements Strategy {
    name = 'Liquidity Sweep';
    id = 'liquidity-sweep';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { liquidity, candles, indicators } = ctx;
        const last = candles[candles.length - 1];
        
        // Volume must be higher than average to validate the sweep and reclaim
        if (last.volume <= indicators.volumeSma * 1.2) return null;

        if (liquidity.sweptLow && liquidity.reclaimedLevel && liquidity.localRangeLow) {
            // SL behind the wick that swept (the absolute low of recent candles)
            const sweepWickLow = Math.min(...candles.slice(-5).map(c => c.low));
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                orderType: 'LIMIT',
                suggestedEntry: liquidity.localRangeLow, // Retest of the swept level
                suggestedTarget: liquidity.localRangeHigh || undefined, // Target the opposite side of the range
                suggestedSl: sweepWickLow - (indicators.atr * 0.2), // Behind the sweep wick + buffer
                confidence: 90,
                reasons: [
                    'Swing low sweep with volume', 
                    'Range reclaimed → expecting retest of the low',
                    `Limit set at original range low: ${liquidity.localRangeLow.toFixed(4)}`
                ],
                expireMinutes: 90 // 1.5 hours to retest
            };
        }
        if (liquidity.sweptHigh && liquidity.reclaimedLevel && liquidity.localRangeHigh) {
            // SL behind the wick that swept (the absolute high of recent candles)
            const sweepWickHigh = Math.max(...candles.slice(-5).map(c => c.high));
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                orderType: 'LIMIT',
                suggestedEntry: liquidity.localRangeHigh, // Retest of the swept level
                suggestedTarget: liquidity.localRangeLow || undefined, // Target the opposite side of the range
                suggestedSl: sweepWickHigh + (indicators.atr * 0.2), // Behind the sweep wick + buffer
                confidence: 90,
                reasons: [
                    'Swing high sweep with volume', 
                    'Range reclaimed → expecting retest of the high',
                    `Limit set at original range high: ${liquidity.localRangeHigh.toFixed(4)}`
                ],
                expireMinutes: 90 // 1.5 hours to retest
            };
        }
        return null;
    }
}

// ... other strategies will be added similarly
