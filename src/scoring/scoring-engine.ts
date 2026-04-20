import { config } from '../config/index.js';
import { ConfidenceLabel, MarketRegimeType, SignalDirection } from '../core/constants/enums.js';
import { StrategyContext, StrategySignalCandidate } from '../core/types/bot-types.js';

// Strategies that inherently trade AGAINST momentum (fade/reversion).
// Must be scored opposite to trend-following strategies.
const MEAN_REVERSION_STRATEGIES = new Set([
    'VWAP Reversion',
    'VWAP Reversion Pro',
    'Delta Divergence',
    'Absorption',
    'Funding Reversal',
    'Range Bounce',
    'RSI Divergence',
    'Volume Climax Reversal',
    'Bollinger Band Reversal',
    'OP Range Mean-Reversion',
    'OP Funding + OI Divergence',
    'OP Enhanced Liquidity Sweep',
    'Liquidity Sweep',
    'Liquidity Trap Reversal',
]);

const TREND_FOLLOWING_STRATEGIES = new Set([
    'EMA Cross Momentum',
    'EMA Ribbon Scalp',
    'OP EMA Ribbon + VWAP Pullback',
    'OP Bollinger Squeeze Breakout',
    'Trending Pullback 1h',
    'Order Block Retest',
    'BOS/CHoCH',
    'Trend Continuity',
    'Breakout With Fuel',
]);

export class ScoringEngine {
    static calculate(ctx: StrategyContext, candidate: StrategySignalCandidate): { score: number, label: string } {
        let score = candidate.confidence;

        const isMeanReversion = MEAN_REVERSION_STRATEGIES.has(candidate.strategyName);
        const isTrendFollowing = TREND_FOLLOWING_STRATEGIES.has(candidate.strategyName);

        // ─── Regime alignment (direction-sensitive) ───
        // Trend strategies: bonus in TREND, penalty in RANGE.
        // Mean-reversion: bonus in RANGE/PANIC (extremes), penalty in TREND.
        if (ctx.regime.type === MarketRegimeType.TREND) {
            if (isTrendFollowing) score += config.weights.regimeAlignment;
            if (isMeanReversion) score -= 10; // fade against the trend = poor edge
        } else if (ctx.regime.type === MarketRegimeType.RANGE) {
            if (isMeanReversion) score += config.weights.regimeAlignment;
            if (isTrendFollowing) score -= 8; // breakouts fake out in chop
        } else if (ctx.regime.type === MarketRegimeType.PANIC) {
            if (isMeanReversion) score += 10; // extreme RSI = textbook fade zone
        } else if (ctx.regime.type === MarketRegimeType.VOLATILITY_EXPANSION) {
            if (isTrendFollowing) score += 5;
        }

        // ─── Volume spike ───
        if (ctx.indicators.volumeSma > 0 && ctx.candles[ctx.candles.length - 1].volume > ctx.indicators.volumeSma * 1.5) {
            score += config.weights.volumeSpike;
        }

        // ─── Liquidity sweep context ───
        if (ctx.liquidity.isWickSweep) score += config.weights.liquidityContext;

        // ─── Funding: direction-aware, meaningful threshold ───
        // 0.05% / 8h = ~0.000625 -- that's the actual "extreme" level.
        if (ctx.funding) {
            const fr = ctx.funding.rate;
            if (fr > 0.0005 && candidate.direction === SignalDirection.SHORT) score += 8; // crowded longs
            else if (fr < -0.0005 && candidate.direction === SignalDirection.LONG) score += 8; // crowded shorts
            // WRONG-way funding alignment = slight penalty (we're chasing crowd)
            else if (fr > 0.0005 && candidate.direction === SignalDirection.LONG) score -= 5;
            else if (fr < -0.0005 && candidate.direction === SignalDirection.SHORT) score -= 5;
        }

        // ─── OI direction alignment ───
        if (ctx.openInterest && ctx.openInterest.oiHistory.length > 0) {
            const currentOi = ctx.openInterest.oi;
            const pastOi = ctx.openInterest.oiHistory[0];
            const oiDelta = (currentOi - pastOi) / pastOi;

            // Determine if price moved same direction as OI — that's healthy confirmation.
            const firstPrice = ctx.candles[Math.max(0, ctx.candles.length - ctx.openInterest.oiHistory.length)].close;
            const lastPrice = ctx.candles[ctx.candles.length - 1].close;
            const priceUp = lastPrice > firstPrice;

            // Trend-following: want OI expanding WITH price in signal direction.
            if (isTrendFollowing) {
                if (oiDelta > 0.02 && candidate.direction === SignalDirection.LONG && priceUp) score += 6;
                else if (oiDelta > 0.02 && candidate.direction === SignalDirection.SHORT && !priceUp) score += 6;
            }
            // Mean-reversion: high OI + stagnant price = crowded positioning = fade edge.
            if (isMeanReversion && Math.abs(oiDelta) > 0.05) score += 4;
        }

        // ─── BTC alignment (penalty when fighting BTC) ───
        if (ctx.btcContext && !isMeanReversion) {
            if (candidate.direction === SignalDirection.LONG && ctx.btcContext.trend === 'BEARISH') score -= 6;
            if (candidate.direction === SignalDirection.SHORT && ctx.btcContext.trend === 'BULLISH') score -= 6;
        }

        // ─── Candle quality: small body rejection ───
        const last = ctx.candles[ctx.candles.length - 1];
        const range = last.high - last.low;
        if (range > 0) {
            const bodyRatio = Math.abs(last.close - last.open) / range;
            if (bodyRatio > 0.6) score += 4; // decisive candle
        }

        score = Math.min(100, Math.max(0, score));

        let label = ConfidenceLabel.IGNORE;
        if (score >= 90) label = ConfidenceLabel.A_PLUS;
        else if (score >= 80) label = ConfidenceLabel.A;
        else if (score >= 70) label = ConfidenceLabel.B;
        else if (score >= 60) label = ConfidenceLabel.C;

        return { score, label };
    }
}
