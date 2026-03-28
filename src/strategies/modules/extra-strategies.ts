import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { SignalDirection, MarketRegimeType } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';


// ─── DISABLED: PumpDetector, MicroPullback, DumpBounce ───
// Kept as exports for backward compatibility, but execute() always returns null

export class PumpDetectorStrategy implements Strategy {
    name = 'Pump Detector';
    id = 'pump-detector';
    execute(_ctx: StrategyContext): StrategySignalCandidate | null { return null; }
}

export class MicroPullbackStrategy implements Strategy {
    name = 'Micro Pullback';
    id = 'micro-pullback';
    execute(_ctx: StrategyContext): StrategySignalCandidate | null { return null; }
}

export class DumpBounceStrategy implements Strategy {
    name = 'Dump Bounce';
    id = 'dump-bounce';
    execute(_ctx: StrategyContext): StrategySignalCandidate | null { return null; }
}

// ─── UPDATED: RangeBounce — только во флете (ADX < 18 + narrow ATR) ───

export class RangeBounceStrategy implements Strategy {
    name = 'Range Bounce';
    id = 'range-bounce';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { indicators, candles, liquidity, regime } = ctx;
        const last = candles[candles.length - 1];

        // STRICT flat filter: regime must be RANGE + ADX < 18
        if (regime.type !== MarketRegimeType.RANGE) return null;
        if (indicators.adx >= 18) return null;

        // ATR narrow-range filter: ATR must be less than 0.8% of price (low volatility = real flat)
        const atrPct = (indicators.atr / last.close) * 100;
        if (atrPct > 0.8) return null;

        if (last.low <= (liquidity.localRangeLow || 0) && indicators.rsi < 35) {
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                suggestedTarget: liquidity.localRangeHigh || undefined,
                suggestedSl: (liquidity.localRangeLow || last.low) - (indicators.atr * 0.2),
                confidence: 65,
                reasons: ['Range floor bounce', 'Flat regime (ADX < 18)', 'RSI oversold', `ATR: ${atrPct.toFixed(2)}% (narrow)`],
                expireMinutes: 30
            };
        }
        if (last.high >= (liquidity.localRangeHigh || 0) && indicators.rsi > 65) {
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                suggestedTarget: liquidity.localRangeLow || undefined,
                suggestedSl: (liquidity.localRangeHigh || last.high) + (indicators.atr * 0.2),
                confidence: 65,
                reasons: ['Range ceiling bounce', 'Flat regime (ADX < 18)', 'RSI overbought', `ATR: ${atrPct.toFixed(2)}% (narrow)`],
                expireMinutes: 30
            };
        }
        return null;
    }
}

// ─── UPDATED: BreakoutFailure — volume spike обязателен ───

export class BreakoutFailureStrategy implements Strategy {
    name = 'Breakout Failure';
    id = 'breakout-failure';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { liquidity, candles, indicators } = ctx;
        const last = candles[candles.length - 1];

        // REQUIRED: volume must be >= 1.5x average to confirm the failed breakout is real
        if (last.volume < indicators.volumeSma * 1.5) return null;
        
        if (last.high > (liquidity.localRangeHigh || Number.MAX_SAFE_INTEGER) && last.close < (liquidity.localRangeHigh || 0)) {
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                suggestedTarget: liquidity.localRangeLow || undefined,
                suggestedSl: last.high + (indicators.atr * 0.2), // Behind the bull trap wick
                confidence: 80,
                reasons: ['Failed bullish breakout', 'Return to range', 'Bull Trap + volume spike'],
                expireMinutes: 25
            };
        }

        if (last.low < (liquidity.localRangeLow || 0) && last.close > (liquidity.localRangeLow || Number.MAX_SAFE_INTEGER)) {
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                suggestedTarget: liquidity.localRangeHigh || undefined,
                suggestedSl: last.low - (indicators.atr * 0.2), // Behind the bear trap wick
                confidence: 80,
                reasons: ['Failed bearish breakdown', 'Return to range', 'Bear Trap + volume spike'],
                expireMinutes: 25
            };
        }
        return null;
    }
}

