import { config } from '../config/index.js';
import { ConfidenceLabel, MarketRegimeType } from '../core/constants/enums.js';
export class ScoringEngine {
    static calculate(ctx, candidate) {
        let score = candidate.confidence;
        // Weight adjustments
        if (ctx.regime.type === MarketRegimeType.TREND)
            score += config.weights.regimeAlignment;
        if (ctx.indicators.volumeSma > 0 && ctx.candles[ctx.candles.length - 1].volume > ctx.indicators.volumeSma * 1.5)
            score += config.weights.volumeSpike;
        if (ctx.liquidity.isWickSweep)
            score += config.weights.liquidityContext;
        if (ctx.funding) {
            // High funding means people are paying to long, slightly favors shorts if signal is short
            if (ctx.funding.rate > 0.0001 && candidate.direction === 'SHORT')
                score += 5;
            if (ctx.funding.rate < -0.0001 && candidate.direction === 'LONG')
                score += 5;
        }
        if (ctx.openInterest && ctx.openInterest.oiHistory.length > 0) {
            const currentOi = ctx.openInterest.oi;
            const pastOi = ctx.openInterest.oiHistory[0];
            const oiIncreasing = currentOi > pastOi;
            // Increasing OI confirms the direction
            if (oiIncreasing)
                score += 5;
        }
        score = Math.min(100, Math.max(0, score));
        let label = ConfidenceLabel.IGNORE;
        if (score >= 90)
            label = ConfidenceLabel.A_PLUS;
        else if (score >= 80)
            label = ConfidenceLabel.A;
        else if (score >= 70)
            label = ConfidenceLabel.B;
        else if (score >= 60)
            label = ConfidenceLabel.C;
        return { score, label };
    }
}
//# sourceMappingURL=scoring-engine.js.map