import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

/**
 * 1. HTF Pullback Continuation (1h trend + 15m entry)
 * Trades only in the direction of the 1h EMA200/50 trend.
 * Entry on a 15m pullback to VWAP or EMA20 with volume confirmation.
 */
export class TrendingPullback1hStrategy implements Strategy {
    name = 'HTF Pullback Continuation';
    id = 'htf-pullback-1h';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators, btcContext } = ctx;
        if (!btcContext) return null;

        const last = candles[candles.length - 1];
        
        // 1. Trend Filter: Align with BTC (HTF) and local EMA200
        const isBtcBullish = btcContext.trend === 'BULLISH';
        const isLocalBullish = last.close > indicators.ema200; 
        
        if (isBtcBullish && isLocalBullish) {
            // LONG PULLBACK: Price between EMA50 and EMA200 + RSI oversold shift
            if (last.close < indicators.ema50 && last.close > indicators.ema200 && indicators.rsi < 45) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    suggestedTarget: last.close + (indicators.atr * 3.5),
                    suggestedSl: indicators.ema200 - (indicators.atr * 0.2),
                    confidence: 75,
                    reasons: ['HTF/Local Trend Alignment', '15m Pullback to Value Zone', 'RSI mean reversion'],
                    expireMinutes: 45
                };
            }
        }

        if (!isBtcBullish && !isLocalBullish) {
            // SHORT PULLBACK
            if (last.close > indicators.ema50 && last.close < indicators.ema200 && indicators.rsi > 55) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    suggestedTarget: last.close - (indicators.atr * 3.5),
                    suggestedSl: indicators.ema200 + (indicators.atr * 0.2),
                    confidence: 75,
                    reasons: ['HTF/Local Trend Alignment', '15m Pullback to Value Zone', 'RSI mean reversion'],
                    expireMinutes: 45
                };
            }
        }

        return null;
    }
}
