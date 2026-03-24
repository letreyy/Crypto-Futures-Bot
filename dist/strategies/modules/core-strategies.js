import { SignalDirection } from '../../core/constants/enums.js';
export class EMAPullbackStrategy {
    name = 'EMA Pullback';
    id = 'ema-pullback';
    execute(ctx) {
        const { indicators, candles } = ctx;
        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];
        const is15mTrendUp = indicators.ema50 > indicators.ema200;
        const is15mTrendDown = indicators.ema50 < indicators.ema200;
        // LONG: Price pulls back to EMA20 and closes back above it with volume
        if (is15mTrendUp && indicators.adx > 25 && prev.low <= indicators.ema20 && prev.low >= indicators.ema50 && last.close > indicators.ema20 && last.volume > indicators.volumeSma * 1.2) {
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                confidence: 80,
                reasons: ['15m Trend Aligned', 'ADX > 25 (Strong trend)', 'EMA20 pullback', 'Volume confirmation'],
                expireMinutes: 30
            };
        }
        if (is15mTrendDown && indicators.adx > 25 && prev.high >= indicators.ema20 && prev.high <= indicators.ema50 && last.close < indicators.ema20 && last.volume > indicators.volumeSma * 1.2) {
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                confidence: 80,
                reasons: ['15m Trend Aligned', 'ADX > 25 (Strong dump)', 'EMA20 pullback', 'Volume confirmation'],
                expireMinutes: 30
            };
        }
        return null;
    }
}
export class SqueezeBreakoutStrategy {
    name = 'Squeeze Breakout';
    id = 'squeeze-breakout';
    execute(ctx) {
        const { indicators, candles } = ctx;
        const last = candles[candles.length - 1];
        const bbWidth = (indicators.bbUpper - indicators.bbLower) / indicators.bbMid;
        const kcUpper = indicators.ema20 + 1.5 * indicators.atr;
        const kcLower = indicators.ema20 - 1.5 * indicators.atr;
        // TTM Squeeze logic: BB should be inside KC for squeeze, and break out of BB for signal
        const isSqueezed = indicators.bbUpper < kcUpper && indicators.bbLower > kcLower;
        if (isSqueezed || bbWidth < 0.005) { // Tight squeeze or TTM Squeeze
            if (last.close > indicators.bbUpper && last.volume > indicators.volumeSma * 1.5) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    confidence: 85,
                    reasons: ['Volatility Squeeze (TTM)', 'Upper BB breakout', 'Volume surge'],
                    expireMinutes: 40
                };
            }
            if (last.close < indicators.bbLower && last.volume > indicators.volumeSma * 1.5) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    confidence: 85,
                    reasons: ['Volatility Squeeze (TTM)', 'Lower BB breakout', 'Volume surge'],
                    expireMinutes: 40
                };
            }
        }
        return null;
    }
}
export class VWAPReversionStrategy {
    name = 'VWAP Reversion';
    id = 'vwap-reversion';
    execute(ctx) {
        const { indicators, candles } = ctx;
        const last = candles[candles.length - 1];
        const deviation = (last.close - indicators.vwap) / indicators.vwap;
        if (deviation < -0.02 && indicators.rsi < 30 && last.volume > indicators.volumeSma * 1.5) {
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                confidence: 75,
                reasons: ['Extreme VWAP deviation', 'RSI Oversold', 'High absorption volume', 'Potential mean reversion'],
                expireMinutes: 20
            };
        }
        if (deviation > 0.02 && indicators.rsi > 70 && last.volume > indicators.volumeSma * 1.5) {
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                confidence: 75,
                reasons: ['Extreme VWAP deviation', 'RSI Overbought', 'High absorption volume', 'Potential mean reversion'],
                expireMinutes: 20
            };
        }
        return null;
    }
}
export class LiquiditySweepStrategy {
    name = 'Liquidity Sweep';
    id = 'liquidity-sweep';
    execute(ctx) {
        const { liquidity, candles, indicators } = ctx;
        const last = candles[candles.length - 1];
        // Volume must be higher than average to validate the sweep and reclaim
        if (last.volume <= indicators.volumeSma * 1.2)
            return null;
        if (liquidity.sweptLow && liquidity.reclaimedLevel) {
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                confidence: 90,
                reasons: ['Swing low sweep', 'Quick reclaim with Volume', 'High probability stop hunt'],
                expireMinutes: 30
            };
        }
        if (liquidity.sweptHigh && liquidity.reclaimedLevel) {
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                confidence: 90,
                reasons: ['Swing high sweep', 'Quick reclaim with Volume', 'High probability stop hunt'],
                expireMinutes: 30
            };
        }
        return null;
    }
}
// ... other strategies will be added similarly
//# sourceMappingURL=core-strategies.js.map