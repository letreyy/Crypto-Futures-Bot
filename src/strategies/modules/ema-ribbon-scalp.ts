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

        // ─── ATR body filter: skip tiny/noisy candles ───
        // Body must be at least 30% of ATR — filters out indecision candles
        const bodySize = Math.abs(last.close - last.open);
        if (bodySize < indicators.atr * 0.3) return null;

        // Bullish ribbon: EMAs stacked 8>13>21>34>55
        const isBullishRibbon = ribbon[0] > ribbon[1] && ribbon[1] > ribbon[2] && ribbon[2] > ribbon[3] && ribbon[3] > ribbon[4];
        
        // Bearish ribbon: EMAs stacked 8<13<21<34<55
        const isBearishRibbon = ribbon[0] < ribbon[1] && ribbon[1] < ribbon[2] && ribbon[2] < ribbon[3] && ribbon[3] < ribbon[4];

        // LONG SCALP: Ribbon bullish, price dips to EMA8-13 zone, bullish close back above EMA8 + volume
        if (isBullishRibbon) {
            const inValueZone = prev.low <= ribbon[1] && prev.low >= ribbon[2];
            const strongClose = last.close > ribbon[0] && last.close > last.open;
            const hasVolume = last.volume > indicators.volumeSma * 1.1;

            if (inValueZone && strongClose && hasVolume) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.LONG,
                    confidence: 82,
                    reasons: [
                        'EMA Ribbon fully aligned bullish (8>13>21>34>55)',
                        'Pullback to EMA8–13 value zone',
                        `Momentum resume: body ${(bodySize / indicators.atr * 100).toFixed(0)}% of ATR`
                    ],
                    expireMinutes: 15
                };
            }
        }

        // SHORT SCALP: Ribbon bearish, price pops to EMA8-13 zone, bearish close below EMA8 + volume
        if (isBearishRibbon) {
            const inValueZone = prev.high >= ribbon[1] && prev.high <= ribbon[2];
            const strongClose = last.close < ribbon[0] && last.close < last.open;
            const hasVolume = last.volume > indicators.volumeSma * 1.1;

            if (inValueZone && strongClose && hasVolume) {
                return {
                    strategyName: this.name,
                    direction: SignalDirection.SHORT,
                    confidence: 82,
                    reasons: [
                        'EMA Ribbon fully aligned bearish (8<13<21<34<55)',
                        'Pop to EMA8–13 value zone',
                        `Momentum resume short: body ${(bodySize / indicators.atr * 100).toFixed(0)}% of ATR`
                    ],
                    expireMinutes: 15
                };
            }
        }

        return null;
    }
}
