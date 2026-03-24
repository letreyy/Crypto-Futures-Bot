import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { MarketRegimeType, SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

export class EmaRibbonScalpStrategy implements Strategy {
    name = 'EMA Ribbon Scalp';
    id = 'ema-ribbon-scalp';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { indicators, candles, regime } = ctx;
        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];

        // Only scalp in a strong trending regime
        if (regime.type !== MarketRegimeType.TREND) return null;

        const ribbon = indicators.emaRibbon; // [8, 13, 21, 34, 55]
        if (!ribbon || ribbon.length < 5) return null;

        // Bullish ribbon: lowest EMA is highest value
        const isBullishRibbon = ribbon[0] > ribbon[1] && ribbon[1] > ribbon[2] && ribbon[2] > ribbon[3] && ribbon[3] > ribbon[4];
        
        // Bearish ribbon: lowest EMA is lowest value
        const isBearishRibbon = ribbon[0] < ribbon[1] && ribbon[1] < ribbon[2] && ribbon[2] < ribbon[3] && ribbon[3] < ribbon[4];

        // LONG SCALP: Ribbon is bullish, price drops into EMA 8-13 area, then prints a bullish candle closing above EMA 8
        if (isBullishRibbon) {
            const inValueZone = prev.low <= ribbon[1] && prev.low >= ribbon[2];
            const strongClose = last.close > ribbon[0] && last.close > last.open;
            
            if (inValueZone && strongClose) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    confidence: 80,
                    reasons: ['EMA Ribbon aligned bullishly', 'Pullback to 8-13 value area', 'Strong momentum resume'],
                    expireMinutes: 15
                };
            }
        }

        // SHORT SCALP: Ribbon is bearish, price pops into EMA 8-13 area, then prints a bearish candle closing below EMA 8
        if (isBearishRibbon) {
            const inValueZone = prev.high >= ribbon[1] && prev.high <= ribbon[2];
            const strongClose = last.close < ribbon[0] && last.close < last.open;
            
            if (inValueZone && strongClose) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    confidence: 80,
                    reasons: ['EMA Ribbon aligned bearishly', 'Pop to 8-13 value area', 'Strong momentum resume'],
                    expireMinutes: 15
                };
            }
        }

        return null;
    }
}
