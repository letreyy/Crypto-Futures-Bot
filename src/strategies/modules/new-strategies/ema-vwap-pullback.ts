import { StrategyContext, StrategySignalCandidate } from '../../../core/types/bot-types.js';
import { SignalDirection, MarketRegimeType } from '../../../core/constants/enums.js';
import { Strategy } from '../../base/strategy.js';
import { TechnicalIndicators } from '../../../market/indicators/indicator-engine.js';
import { binanceClient } from '../../../exchange/binance/binance-client.js';

/**
 * 1. EMA Ribbon + VWAP Pullback
 * Type: Trend-following, Long/Short
 * Regime: TREND (ADX > 25)
 */
export class EmaVwapPullbackStrategy implements Strategy {
    name = 'OP EMA Ribbon + VWAP Pullback';
    id = 'ema-vwap-pullback';

    async execute(ctx: StrategyContext): Promise<StrategySignalCandidate | null> {
        const { indicators, candles, regime, symbol } = ctx;
        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];

        if (regime.type !== MarketRegimeType.TREND || indicators.adx < 25) return null;

        const ema9 = TechnicalIndicators.ema(candles.map(c => c.close), 9);
        const ema21 = indicators.emaRibbon[2]; 
        const ema50 = indicators.ema50;

        let h1Trend = false;
        try {
            const h1Candles = await binanceClient.getKlines(symbol, '1h', 200);
            if (h1Candles && h1Candles.length >= 200) {
                const h1Closes = h1Candles.map(c => c.close);
                const h1Ema50 = TechnicalIndicators.ema(h1Closes, 50);
                const h1Ema200 = TechnicalIndicators.ema(h1Closes, 200);
                
                if (last.close > ema50) {
                    h1Trend = h1Ema50 > h1Ema200;
                } else {
                    h1Trend = h1Ema50 < h1Ema200;
                }
            }
        } catch (e) {
            return null;
        }

        if (!h1Trend) return null;

        if (ema9 > ema21 && ema21 > ema50 && last.close > indicators.vwap) {
            const lookback = candles.slice(-5, -1);
            const touchedEma21 = lookback.some(c => c.low <= ema21);
            if (!touchedEma21) return null;

            const isBullishEngulfing = last.close > prev.open && last.open < prev.close && last.close > last.open;
            const body = Math.abs(last.close - last.open);
            const lowerWick = last.open > last.close ? last.low - last.close : last.low - last.open;
            const isPinBar = Math.abs(lowerWick) >= 2 * body;

            if (!isBullishEngulfing && !isPinBar) return null;

            if (last.volume >= indicators.volumeSma * 1.2) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    suggestedTarget: last.close + (indicators.atr * 3),
                    suggestedSl: Math.min(last.low, ema50) - (indicators.atr * 0.2),
                    confidence: 82,
                    reasons: [
                        'Strong 1h/15m trend alignment',
                        'EMA 21 Pullback confirmed',
                        'Bullish volume spike at support',
                        'Above Session VWAP'
                    ],
                    expireMinutes: 45
                };
            }
        }

        if (ema9 < ema21 && ema21 < ema50 && last.close < indicators.vwap) {
            const lookback = candles.slice(-5, -1);
            const touchedEma21 = lookback.some(c => c.high >= ema21);
            if (!touchedEma21) return null;

            const isBearishEngulfing = last.close < prev.open && last.open > prev.close && last.close < last.open;
            const body = Math.abs(last.close - last.open);
            const upperWick = last.close > last.open ? last.high - last.close : last.high - last.open;
            const isPinBar = Math.abs(upperWick) >= 2 * body;

            if (!isBearishEngulfing && !isPinBar) return null;

            if (last.volume >= indicators.volumeSma * 1.2) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    suggestedTarget: last.close - (indicators.atr * 3),
                    suggestedSl: Math.max(last.high, ema50) + (indicators.atr * 0.2),
                    confidence: 82,
                    reasons: [
                        'Strong 1h/15m trend alignment',
                        'EMA 21 Pullback confirmed',
                        'Bearish volume spike at resistance',
                        'Below Session VWAP'
                    ],
                    expireMinutes: 45
                };
            }
        }

        return null;
    }
}
