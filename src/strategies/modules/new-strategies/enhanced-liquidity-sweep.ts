import { StrategyContext, StrategySignalCandidate } from '../../../core/types/bot-types.js';
import { SignalDirection } from '../../../core/constants/enums.js';
import { Strategy } from '../../base/strategy.js';
import { binanceClient } from '../../../exchange/binance/binance-client.js';

/**
 * 5. Liquidity Sweep (Smart Money Concept)
 * Type: Liquidity grab / False Breakout
 * Enters on capture of Equal Highs/Lows levels
 */
export class EnhancedLiquiditySweepStrategy implements Strategy {
    name = 'Enhanced Liquidity Sweep';
    id = 'enhanced-liquidity-sweep';

    async execute(ctx: StrategyContext): Promise<StrategySignalCandidate | null> {
        const { indicators, candles, symbol } = ctx;
        if (candles.length < 50) return null;

        const last = candles[candles.length - 1];

        let eqLows: number | null = null;
        let eqHighs: number | null = null;
        try {
            const h1Candles = await binanceClient.getKlines(symbol, '1h', 100);
            if (h1Candles) {
                const lows = h1Candles.map(c => c.low);
                for (let i = 0; i < lows.length; i++) {
                    for (let j = i + 5; j < lows.length; j++) {
                        if (Math.abs(lows[i] - lows[j]) / lows[i] < 0.002) {
                            eqLows = (lows[i] + lows[j]) / 2;
                            break;
                        }
                    }
                    if (eqLows) break;
                }
                const highs = h1Candles.map(c => c.high);
                for (let i = 0; i < highs.length; i++) {
                    for (let j = i + 5; j < highs.length; j++) {
                        if (Math.abs(highs[i] - highs[j]) / highs[i] < 0.002) {
                            eqHighs = (highs[i] + highs[j]) / 2;
                            break;
                        }
                    }
                    if (eqHighs) break;
                }
            }
        } catch (e) { return null; }

        if (eqLows && last.low < eqLows * (1 - 0.003)) {
            if (last.close > eqLows && last.volume >= indicators.volumeSma * 1.5) {
                const deltaCurrent = (last.close - last.open) / (last.high - last.low);
                if (deltaCurrent > 0) {
                    return {
                        strategyName: this.name,
                        direction: SignalDirection.LONG,
                        suggestedTarget: last.close + (indicators.atr * 4),
                        suggestedSl: last.low - (indicators.atr * 0.2),
                        confidence: 88,
                        reasons: [
                            'Equal Lows liquidity pool identifies on 1h',
                            'Aggressive sweep (>0.3%) with volume reclaim',
                            'Market structure maintained (Reclaim of structural low)'
                        ],
                        expireMinutes: 90
                    };
                }
            }
        }

        if (eqHighs && last.high > eqHighs * (1 + 0.003)) {
            if (last.close < eqHighs && last.volume >= indicators.volumeSma * 1.5) {
                const deltaCurrent = (last.close - last.open) / (last.high - last.low);
                if (deltaCurrent < 0) {
                    return {
                        strategyName: this.name,
                        direction: SignalDirection.SHORT,
                        suggestedTarget: last.close - (indicators.atr * 4),
                        suggestedSl: last.high + (indicators.atr * 0.2),
                        confidence: 88,
                        reasons: [
                            'Equal Highs liquidity pool identifies on 1h',
                            'Aggressive sweep (>0.3%) with volume reclaim',
                            'Market structure maintained (Reclaim of structural high)'
                        ],
                        expireMinutes: 90
                    };
                }
            }
        }

        return null;
    }
}
