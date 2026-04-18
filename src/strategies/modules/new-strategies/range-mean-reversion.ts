import { StrategyContext, StrategySignalCandidate } from '../../../core/types/bot-types.js';
import { SignalDirection } from '../../../core/constants/enums.js';
import { Strategy } from '../../base/strategy.js';
import { TechnicalIndicators } from '../../../market/indicators/indicator-engine.js';
import { binanceClient } from '../../../exchange/binance/binance-client.js';

/**
 * 3. Range Mean-Reversion
 * Type: Counter-trend in sideways market
 * Regime: RANGE
 */
export class RangeMeanReversionStrategy implements Strategy {
    name = 'Range Mean-Reversion';
    id = 'range-mean-reversion';

    async execute(ctx: StrategyContext): Promise<StrategySignalCandidate | null> {
        const { indicators, candles, symbol } = ctx;
        if (candles.length < 50) return null;

        const last = candles[candles.length - 1];
        
        if (indicators.adx >= 20) return null;

        try {
            const h1Candles = await binanceClient.getKlines(symbol, '1h', 50);
            if (h1Candles) {
                const h1Adx = TechnicalIndicators.adx(h1Candles, 14);
                if (h1Adx >= 20) return null;
            }
        } catch (e) { return null; }

        const lookback50 = candles.slice(-50);
        const rangeHigh = Math.max(...lookback50.map(c => c.high));
        const rangeLow = Math.min(...lookback50.map(c => c.low));
        const rangeSize = rangeHigh - rangeLow;

        if (last.close <= rangeLow + (rangeSize * 0.15) && indicators.rsi < 30) {
            const calculateDelta = (c: any) => {
                const range = c.high - c.low;
                if (range === 0) return 0;
                return ((c.close - c.open) / range) * c.volume;
            };
            const currentCvd = calculateDelta(last);
            const prevCvd = calculateDelta(candles[candles.length - 2]);

            if (currentCvd > prevCvd) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    suggestedTarget: indicators.bbMid,
                    suggestedSl: rangeLow - (indicators.atr * 0.5),
                    confidence: 72,
                    reasons: [
                        'Dual timeframe range environment (ADX < 20)',
                        'Oversold (RSI < 30) at Range Low',
                        'Volume Delta (CVD) turning positive'
                    ],
                    expireMinutes: 60
                };
            }
        }

        if (last.close >= rangeHigh - (rangeSize * 0.15) && indicators.rsi > 70) {
            const calculateDelta = (c: any) => {
                const range = c.high - c.low;
                if (range === 0) return 0;
                return ((c.close - c.open) / range) * c.volume;
            };
            const currentCvd = calculateDelta(last);
            const prevCvd = calculateDelta(candles[candles.length - 2]);

            if (currentCvd < prevCvd) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    suggestedTarget: indicators.bbMid,
                    suggestedSl: rangeHigh + (indicators.atr * 0.5),
                    confidence: 72,
                    reasons: [
                        'Dual timeframe range environment (ADX < 20)',
                        'Overbought (RSI > 70) at Range High',
                        'Volume Delta (CVD) turning negative'
                    ],
                    expireMinutes: 60
                };
            }
        }

        return null;
    }
}
