import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

/**
 * Opening Range Scalp — London/NY Session Open Momentum
 *
 * Logic: In the first 30-45 minutes of London (06:00-06:45 UTC) or NY (13:00-13:45 UTC),
 * the market typically picks a direction. We enter in the direction of the initial impulse:
 * – If the first few candles close well above the prior Asian range high → LONG
 * – If the first few candles close well below the prior Asian range low  → SHORT
 *
 * Additional filters:
 * – Volume must spike (x1.8) to confirm genuine institutional flow
 * – RSI must not be in extreme (30-70) to avoid chasing
 * – ATR expansion: current candle ATR > 1.2x average (confirms momentum)
 */
export class OpeningRangeScalpStrategy implements Strategy {
    name = 'Opening Range Scalp';
    id = 'opening-range-scalp';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators, liquidity } = ctx;
        if (candles.length < 5) return null;

        const last = candles[candles.length - 1];
        const utcHour = new Date().getUTCHours();

        // Only fire in the first 45 minutes of London or NY open
        const isLondonOpen = utcHour === 6 || utcHour === 7;
        const isNYOpen = utcHour === 13 || utcHour === 14;
        if (!isLondonOpen && !isNYOpen) return null;

        // Volume must spike to confirm institutional participation
        if (last.volume < indicators.volumeSma * 1.8) return null;

        // ATR expansion: current candle range should be larger than normal
        const candleRange = last.high - last.low;
        const avgRange = indicators.atr;
        if (candleRange < avgRange * 1.2) return null;

        // RSI must not be oversold/overbought already (avoid chasing)
        if (indicators.rsi < 30 || indicators.rsi > 70) return null;

        // Bullish ORB: strong green candle breaking out of the Asian range
        if (
            liquidity.localRangeHigh &&
            last.close > liquidity.localRangeHigh &&
            last.close > last.open &&
            (last.close - last.open) / candleRange > 0.6 // Strong bullish body
        ) {
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                orderType: 'MARKET',
                suggestedTarget: last.close + indicators.atr * 3.0,
                suggestedSl: liquidity.localRangeHigh - indicators.atr * 0.3, // Below the breakout level
                confidence: 82,
                reasons: [
                    `${isLondonOpen ? 'London' : 'NY'} Open Breakout`,
                    `Volume x${(last.volume / indicators.volumeSma).toFixed(1)} avg`,
                    'Bullish ORB above Asian range',
                    'ATR expansion confirmed'
                ],
                expireMinutes: 20
            };
        }

        // Bearish ORB: strong red candle breaking below the Asian range
        if (
            liquidity.localRangeLow &&
            last.close < liquidity.localRangeLow &&
            last.close < last.open &&
            (last.open - last.close) / candleRange > 0.6 // Strong bearish body
        ) {
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                orderType: 'MARKET',
                suggestedTarget: last.close - indicators.atr * 3.0,
                suggestedSl: liquidity.localRangeLow + indicators.atr * 0.3, // Above the breakdown level
                confidence: 82,
                reasons: [
                    `${isLondonOpen ? 'London' : 'NY'} Open Breakdown`,
                    `Volume x${(last.volume / indicators.volumeSma).toFixed(1)} avg`,
                    'Bearish ORB below Asian range',
                    'ATR expansion confirmed'
                ],
                expireMinutes: 20
            };
        }

        return null;
    }
}
