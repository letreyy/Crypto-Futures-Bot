import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

export class MomentumBreakoutStrategy implements Strategy {
    name = 'Momentum Breakout';
    id = 'momentum-breakout';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { indicators, candles, liquidity } = ctx;
        const last = candles[candles.length - 1];

        if (last.close > (liquidity.localRangeHigh || 0) && last.volume > indicators.volumeSma * 1.5) {
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                confidence: 70,
                reasons: ['Local range breakout', 'High volume momentum'],
                expireMinutes: 40
            };
        }
        if (last.close < (liquidity.localRangeLow || 0) && last.volume > indicators.volumeSma * 1.5) {
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                confidence: 70,
                reasons: ['Local range breakdown', 'High volume momentum'],
                expireMinutes: 40
            };
        }
        return null;
    }
}

export class PumpDetectorStrategy implements Strategy {
    name = 'Pump Detector';
    id = 'pump-detector';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { indicators, candles } = ctx;
        const last = candles[candles.length - 1];
        const change = (last.close - last.open) / last.open;

        if (change > 0.015 && last.volume > indicators.volumeSma * 3) {
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                confidence: 65,
                reasons: ['Outsized pump detected', 'Massive relative volume'],
                expireMinutes: 30
            };
        }
        if (change < -0.015 && last.volume > indicators.volumeSma * 3) {
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                confidence: 65,
                reasons: ['Outsized dump detected', 'Massive relative volume'],
                expireMinutes: 30
            };
        }
        return null;
    }
}

export class MicroPullbackStrategy implements Strategy {
    name = 'Micro Pullback';
    id = 'micro-pullback';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles } = ctx;
        if (candles.length < 10) return null;
        
        const last = candles[candles.length - 1];
        const slice = candles.slice(-5);
        const prevTrend = slice[0].close < slice[2].close; // Bullish impulse check

        if (prevTrend && last.close < slice[2].close && last.close > slice[0].close) {
            // Shallow pullback detected for Long
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                confidence: 70,
                reasons: ['Impulse-Correction pattern', 'Shallow pullback', 'Market structure bullish'],
                expireMinutes: 20
            };
        }
        return null;
    }
}

export class DumpBounceStrategy implements Strategy {
    name = 'Dump Bounce';
    id = 'dump-bounce';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { indicators, candles } = ctx;
        const last = candles[candles.length - 1];
        
        if (indicators.rsi < 20 && last.close > last.open && last.volume > indicators.volumeSma * 2) {
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                confidence: 75,
                reasons: ['RSI Oversold bounce', 'Rejection candle', 'Volume spike'],
                expireMinutes: 15
            };
        }
        return null;
    }
}

export class RangeBounceStrategy implements Strategy {
    name = 'Range Bounce';
    id = 'range-bounce';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { indicators, candles, liquidity } = ctx;
        const last = candles[candles.length - 1];

        if (indicators.adx < 20) {
            if (last.low <= (liquidity.localRangeLow || 0) && indicators.rsi < 40) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    confidence: 60,
                    reasons: ['Range floor bounce', 'Low ADX regime', 'RSI convergence'],
                    expireMinutes: 30
                };
            }
            if (last.high >= (liquidity.localRangeHigh || 0) && indicators.rsi > 60) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    confidence: 60,
                    reasons: ['Range ceiling bounce', 'Low ADX regime', 'RSI divergence'],
                    expireMinutes: 30
                };
            }
        }
        return null;
    }
}

export class BreakoutFailureStrategy implements Strategy {
    name = 'Breakout Failure';
    id = 'breakout-failure';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { liquidity, candles } = ctx;
        const last = candles[candles.length - 1];
        
        if (last.high > (liquidity.localRangeHigh || Number.MAX_SAFE_INTEGER) && last.close < (liquidity.localRangeHigh || 0)) {
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                confidence: 80,
                reasons: ['Failed bullish breakout', 'Return to range', 'Bull Trap detected'],
                expireMinutes: 25
            };
        }

        if (last.low < (liquidity.localRangeLow || 0) && last.close > (liquidity.localRangeLow || Number.MAX_SAFE_INTEGER)) {
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                confidence: 80,
                reasons: ['Failed bearish breakdown', 'Return to range', 'Bear Trap detected'],
                expireMinutes: 25
            };
        }
        return null;
    }
}
