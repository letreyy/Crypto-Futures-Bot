import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

export class EMAPullbackStrategy implements Strategy {
  name = 'EMA Pullback';
  id = 'ema-pullback';

  execute(ctx: StrategyContext): StrategySignalCandidate | null {
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

export class SqueezeBreakoutStrategy implements Strategy {
    name = 'Squeeze Breakout';
    id = 'squeeze-breakout';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { indicators, candles } = ctx;
        const last = candles[candles.length - 1];

        const kcUpper = indicators.ema20 + 1.5 * indicators.atr;
        const kcLower = indicators.ema20 - 1.5 * indicators.atr;

        // TTM Squeeze: BB must be INSIDE Keltner Channel (true squeeze only, no bbWidth fallback)
        const isSqueezed = indicators.bbUpper < kcUpper && indicators.bbLower > kcLower;
        if (!isSqueezed) return null;

        // Momentum confirmation: ADX must show developing trend (squeeze releasing into move)
        if (indicators.adx < 20) return null;

        if (last.close > indicators.bbUpper && last.volume > indicators.volumeSma * 2.0) {
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                confidence: 87,
                reasons: [
                    'TTM Squeeze: BB inside Keltner Channel',
                    'Upper BB breakout with ADX momentum',
                    `Volume expansion: ${(last.volume / indicators.volumeSma).toFixed(1)}x avg`
                ],
                expireMinutes: 40
            };
        }
        if (last.close < indicators.bbLower && last.volume > indicators.volumeSma * 2.0) {
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                confidence: 87,
                reasons: [
                    'TTM Squeeze: BB inside Keltner Channel',
                    'Lower BB breakdown with ADX momentum',
                    `Volume expansion: ${(last.volume / indicators.volumeSma).toFixed(1)}x avg`
                ],
                expireMinutes: 40
            };
        }
        return null;
    }
}

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
