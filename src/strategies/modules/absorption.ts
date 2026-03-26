import { StrategyContext, StrategySignalCandidate } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { Strategy } from '../base/strategy.js';

/**
 * Absorption Strategy
 * Detects when large volume occurs with minimal price movement.
 * This indicates that one side is absorbing the other's aggression → reversal signal.
 *
 * On futures: large sell volume absorbed by limit buy wall = bottom forming.
 *             large buy volume absorbed by limit sell wall = top forming.
 */

export class AbsorptionStrategy implements Strategy {
    name = 'Absorption';
    id = 'absorption';

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { candles, indicators } = ctx;
        if (candles.length < 10) return null;

        const last = candles[candles.length - 1];

        // Body size relative to full candle range
        const bodySize = Math.abs(last.close - last.open);
        const fullRange = last.high - last.low;
        if (fullRange <= 0) return null;

        const bodyRatio = bodySize / fullRange;
        const volumeRatio = last.volume / indicators.volumeSma;

        // Absorption = high volume + tiny body (doji-like)
        // Volume must be >= 2x average, body must be < 25% of full range
        if (volumeRatio < 2.0 || bodyRatio > 0.25) return null;

        // Check surrounding candles for context (what was the prevailing direction?)
        const prev3 = candles.slice(-4, -1);
        const avgMove = prev3.reduce((sum, c) => sum + (c.close - c.open), 0) / prev3.length;

        // Bullish absorption: sellers were pushing down (avg move negative), but large volume absorbed → reversal UP
        if (avgMove < 0 && indicators.rsi < 40) {
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                confidence: 72,
                reasons: [
                    `Volume absorption: ${volumeRatio.toFixed(1)}x avg volume`,
                    `Tiny body: ${(bodyRatio * 100).toFixed(0)}% of range`,
                    'Selling pressure absorbed by limit buy wall',
                    'RSI in oversold territory → reversal setup'
                ],
                expireMinutes: 20
            };
        }

        // Bearish absorption: buyers were pushing up, but large volume absorbed → reversal DOWN
        if (avgMove > 0 && indicators.rsi > 60) {
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                confidence: 72,
                reasons: [
                    `Volume absorption: ${volumeRatio.toFixed(1)}x avg volume`,
                    `Tiny body: ${(bodyRatio * 100).toFixed(0)}% of range`,
                    'Buying pressure absorbed by limit sell wall',
                    'RSI in overbought territory → reversal setup'
                ],
                expireMinutes: 20
            };
        }

        return null;
    }
}
