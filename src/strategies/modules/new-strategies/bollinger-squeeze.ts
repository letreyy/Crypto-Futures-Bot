import { StrategyContext, StrategySignalCandidate } from '../../../core/types/bot-types.js';
import { SignalDirection } from '../../../core/constants/enums.js';
import { Strategy } from '../../base/strategy.js';

/**
 * 2. Bollinger Squeeze Breakout
 * Type: Volatility Breakout, Long/Short
 * Regime: SQUEEZE (TTM Squeeze definition)
 */
export class BollingerSqueezeStrategy implements Strategy {
    name = 'OP Bollinger Squeeze Breakout';
    id = 'bb-squeeze-breakout';

    // ─── Per-symbol cache for rolling BB width history ───
    // Key: symbol → { lastClosedIdx, widths }
    private static widthCache = new Map<string, { lastTs: number; widths: number[] }>();

    execute(ctx: StrategyContext): StrategySignalCandidate | null {
        const { indicators, candles, symbol } = ctx;
        if (candles.length < 40) return null;

        const last = candles[candles.length - 1];
        const closes = candles.map(c => c.close);

        // ─── Cheap rolling BB-width: compute for last 30 closed candles only ───
        const WINDOW = 30;
        const PERIOD = 20;
        const cached = BollingerSqueezeStrategy.widthCache.get(symbol);
        const currentTs = candles[candles.length - 2].timestamp; // last CLOSED candle

        let widths: number[];
        if (cached && cached.lastTs === currentTs && cached.widths.length === WINDOW) {
            widths = cached.widths;
        } else {
            widths = [];
            for (let i = candles.length - WINDOW - 1; i < candles.length - 1; i++) {
                if (i - PERIOD < 0) continue;
                const slice = closes.slice(i - PERIOD, i);
                const mid = slice.reduce((a, b) => a + b, 0) / PERIOD;
                const sd = Math.sqrt(slice.reduce((a, b) => a + (b - mid) ** 2, 0) / PERIOD);
                widths.push((4 * sd) / mid * 100); // (upper - lower) / mid in %
            }
            BollingerSqueezeStrategy.widthCache.set(symbol, { lastTs: currentTs, widths });
        }

        const bbWidth = (indicators.bbUpper - indicators.bbLower) / indicators.bbMid * 100;
        const sortedWidths = [...widths].sort((a, b) => a - b);
        const p20 = sortedWidths[Math.floor(sortedWidths.length * 0.2)] ?? bbWidth;

        // 1. Recent squeeze requirement: prior closed candle's width should be in bottom 20%
        const prevWidth = widths[widths.length - 1] ?? bbWidth;
        const wasSqueezed = prevWidth <= p20;

        // 2. TTM Squeeze alignment
        const kcUpper = indicators.bbMid + (1.5 * indicators.atr);
        const kcLower = indicators.bbMid - (1.5 * indicators.atr);
        const wasTTMSqueezed = indicators.bbUpper < kcUpper * 1.02 && indicators.bbLower > kcLower * 0.98;

        if (!wasSqueezed && !wasTTMSqueezed) return null;

        // 3. Breakout must be FRESH: current width EXPANDING vs previous
        if (bbWidth <= prevWidth * 1.05) return null;

        const momentum = last.close - indicators.bbMid;

        // ─── LONG BREAKOUT ───
        if (last.close > indicators.bbUpper && momentum > 0 && last.volume >= indicators.volumeSma * 1.5) {
            return {
                strategyName: this.name,
                direction: SignalDirection.LONG,
                suggestedTarget: last.close + (indicators.atr * 4),
                suggestedSl: indicators.bbMid - (indicators.atr * 0.2),
                confidence: 75,
                reasons: [
                    'TTM/width Squeeze just released',
                    'BB Width expanding (fresh breakout)',
                    'Bullish momentum + 1.5x volume'
                ],
                expireMinutes: 60
            };
        }

        // ─── SHORT BREAKOUT ───
        if (last.close < indicators.bbLower && momentum < 0 && last.volume >= indicators.volumeSma * 1.5) {
            return {
                strategyName: this.name,
                direction: SignalDirection.SHORT,
                suggestedTarget: last.close - (indicators.atr * 4),
                suggestedSl: indicators.bbMid + (indicators.atr * 0.2),
                confidence: 75,
                reasons: [
                    'TTM/width Squeeze just released',
                    'BB Width expanding (fresh breakout)',
                    'Bearish momentum + 1.5x volume'
                ],
                expireMinutes: 60
            };
        }

        return null;
    }
}
