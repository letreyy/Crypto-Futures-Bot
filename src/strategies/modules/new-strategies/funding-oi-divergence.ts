import { StrategyContext, StrategySignalCandidate } from '../../../core/types/bot-types.js';
import { SignalDirection } from '../../../core/constants/enums.js';
import { Strategy } from '../../base/strategy.js';
import { TechnicalIndicators } from '../../../market/indicators/indicator-engine.js';
import { binanceClient } from '../../../exchange/binance/binance-client.js';

/**
 * 4. Funding + OI Divergence
 * Type: Event-based Counter-trend
 * Identifies sentiment extremes (overleaveraged longs/shorts)
 */
export class FundingOiDivergenceStrategy implements Strategy {
    name = 'OP Funding + OI Divergence';
    id = 'funding-oi-divergence';

    async execute(ctx: StrategyContext): Promise<StrategySignalCandidate | null> {
        const { funding, openInterest, indicators, candles, symbol } = ctx;
        if (!funding || !openInterest || openInterest.oiHistory.length < 16) return null;

        const last = candles[candles.length - 1];
        
        // 1. OI Change >= 10% over last 4 hours (approx 16 candles of 15m)
        const oldOi = openInterest.oiHistory[0];
        const oiChange = (openInterest.oi - oldOi) / oldOi;
        if (oiChange < 0.10) return null;

        // 2. Fetch 1h RSI
        let rsi1h = 50;
        try {
            const h1Candles = await binanceClient.getKlines(symbol, '1h', 50);
            if (h1Candles) {
                rsi1h = TechnicalIndicators.rsi(h1Candles.map(c => c.close), 14);
            }
        } catch (e) {}

        // 3. Price change check (stagnation in last 2 hours = 8 candles)
        const price2hAgo = candles[candles.length - 8].close;
        const priceChange2h = Math.abs(last.close - price2hAgo) / price2hAgo;

        // SHORT: Overleaveraged Longs
        if (funding.rate > 0.0005) { // 0.05% per 8h
            // Sentiment criteria
            if (indicators.rsi > 70 && rsi1h > 65) {
                // Price stagnation or start of decline
                if (priceChange2h < 0.01 || last.close < candles[candles.length - 2].close) {
                    // Confirmation candle: Shooting star (large upper wick) or Engulfing
                    const body = Math.abs(last.close - last.open);
                    const upperWick = last.high - Math.max(last.open, last.close);
                    const isShootingStar = upperWick >= 2 * body;

                    if (isShootingStar || last.close < candles[candles.length - 2].open) {
                        return {
                            strategyName: this.name,
                            direction: SignalDirection.SHORT,
                            suggestedTarget: last.close - (indicators.atr * 5),
                            suggestedSl: last.high + (indicators.atr * 0.5),
                            confidence: 85,
                            reasons: [
                                `Extreme positive funding (${(funding.rate * 100).toFixed(4)}%)`,
                                `Surge in OI (${(oiChange * 100).toFixed(1)}%) with price exhaustion`,
                                'Overbought on 15m and 1h timeframes'
                            ],
                            expireMinutes: 120
                        };
                    }
                }
            }
        }

        // LONG: Overleaveraged Shorts
        if (funding.rate < -0.0005) { // -0.05% per 8h
            if (indicators.rsi < 30 && rsi1h < 35) {
                if (priceChange2h < 0.01 || last.close > candles[candles.length - 2].close) {
                    const body = Math.abs(last.close - last.open);
                    const lowerWick = Math.min(last.open, last.close) - last.low;
                    const isHammer = lowerWick >= 2 * body;

                    if (isHammer || last.close > candles[candles.length - 2].open) {
                        return {
                            strategyName: this.name,
                            direction: SignalDirection.LONG,
                            suggestedTarget: last.close + (indicators.atr * 5),
                            suggestedSl: last.low - (indicators.atr * 0.5),
                            confidence: 85,
                            reasons: [
                                `Extreme negative funding (${(funding.rate * 100).toFixed(4)}%)`,
                                `Surge in OI (${(oiChange * 100).toFixed(1)}%) with price exhaustion`,
                                'Oversold on 15m and 1h timeframes'
                            ],
                            expireMinutes: 120
                        };
                    }
                }
            }
        }

        return null;
    }
}
