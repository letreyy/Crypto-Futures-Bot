import { MarketRegimeType, SignalDirection } from '../core/constants/enums.js';
import { StrategyContext, SignalLevels, StrategySignalCandidate } from '../core/types/bot-types.js';

// ATR-scaled risk corridor — derived per-signal from volatility (see deriveRiskCorridor).
// Absolute caps guard against pathological ATR readings.
const ABS_MIN_RISK_PERCENT = 0.3;
const ABS_MAX_RISK_PERCENT = 3.5;

// Regime-adaptive TP ladder weights. Keys must match MarketRegimeType values.
const TP_WEIGHTS_BY_REGIME: Record<string, number[]> = {
    TREND: [0.40, 0.25, 0.20, 0.15],              // let runners run
    RANGE: [0.50, 0.35, 0.10, 0.05],              // lock profit early
    VOLATILITY_EXPANSION: [0.30, 0.30, 0.25, 0.15], // balanced
    PANIC: [0.50, 0.30, 0.15, 0.05],              // PANIC = exit fast
};
const DEFAULT_TP_WEIGHTS = [0.40, 0.40, 0.10, 0.10];

export function getTpWeights(regimeType: MarketRegimeType): number[] {
    return TP_WEIGHTS_BY_REGIME[regimeType] || DEFAULT_TP_WEIGHTS;
}

function deriveRiskCorridor(atrPct: number): { min: number; max: number } {
    // atrPct is ATR as % of price. On BTC 15m ≈ 0.2-0.4%, on alts up to 1.5%+.
    const min = Math.min(0.6, Math.max(ABS_MIN_RISK_PERCENT, 0.2 + atrPct * 0.5));
    const max = Math.min(ABS_MAX_RISK_PERCENT, Math.max(1.5, 1.8 + atrPct));
    return { min, max };
}

export class RiskEngine {
    static calculateLevels(ctx: StrategyContext, candidate: StrategySignalCandidate): SignalLevels | null {
        const { direction, suggestedEntry, suggestedTarget, suggestedSl } = candidate;
        const last = ctx.candles[ctx.candles.length - 1];
        const atr = ctx.indicators.atr;
        const entry = suggestedEntry || last.close;
        
        // ─── Step 1: Calculate initial SL from structure + ATR ───
        let sl: number;
        if (suggestedSl) {
            sl = suggestedSl;
        } else if (direction === SignalDirection.LONG) {
            sl = Math.min(ctx.liquidity.localRangeLow || (entry - 2 * atr), entry - 1.5 * atr);
        } else {
            sl = Math.max(ctx.liquidity.localRangeHigh || (entry + 2 * atr), entry + 1.5 * atr);
        }

        // ─── Step 2: Enforce ATR-scaled Risk Corridor ───
        const atrPct = (atr / entry) * 100;
        const { min: minRiskPct, max: maxRiskPct } = deriveRiskCorridor(atrPct);
        let risk = Math.abs(entry - sl);
        let currentRiskPct = (risk / entry) * 100;

        if (currentRiskPct > maxRiskPct) {
            risk = entry * (maxRiskPct / 100);
            sl = direction === SignalDirection.LONG ? entry - risk : entry + risk;
        } else if (currentRiskPct < minRiskPct) {
            risk = entry * (minRiskPct / 100);
            sl = direction === SignalDirection.LONG ? entry - risk : entry + risk;
        }

        // ─── Step 3: Calculate TP levels (Structural Targets) ───
        let primaryTarget = suggestedTarget;

        // If strategy didn't provide a target, aim for the opposite side of the local range
        if (!primaryTarget) {
            primaryTarget = direction === SignalDirection.LONG 
                ? (ctx.liquidity.localRangeHigh || entry + risk * 3.0)
                : (ctx.liquidity.localRangeLow || entry - risk * 3.0);
        }

        // ─── CRITICAL: Validate target is on the CORRECT side of entry ───
        // A strategy may suggest VWAP as target, but if VWAP is below entry for LONG, it's invalid.
        if (direction === SignalDirection.LONG && primaryTarget <= entry) {
            // Target is below or at entry — use structural or ATR-based target
            primaryTarget = ctx.liquidity.localRangeHigh && ctx.liquidity.localRangeHigh > entry
                ? ctx.liquidity.localRangeHigh
                : entry + risk * 3.0; // Minimum 3R target
        }
        if (direction === SignalDirection.SHORT && primaryTarget >= entry) {
            // Target is above or at entry — use structural or ATR-based target
            primaryTarget = ctx.liquidity.localRangeLow && ctx.liquidity.localRangeLow < entry
                ? ctx.liquidity.localRangeLow
                : entry - risk * 3.0;
        }

        // ─── Enforce minimum R:R of 1.5 on primary target ───
        const targetDistance = Math.abs(primaryTarget - entry);
        if (targetDistance < risk * 1.5) {
            primaryTarget = direction === SignalDirection.LONG
                ? entry + risk * 2.0
                : entry - risk * 2.0;
        }

        // Build the 4-step TP ladder around the primary target
        const tp: number[] = [];
        if (direction === SignalDirection.LONG) {
            // TP1: Scale out halfway to structural target (safeguard)
            tp[0] = entry + (primaryTarget - entry) * 0.5;
            // TP2: Exact primary structural target (e.g., liquidity sweep zone)
            tp[1] = primaryTarget;
            // TP3: Structural target + 1 ATR extension (trending push)
            tp[2] = Math.max(primaryTarget + atr, entry + risk * 2.5);
            // TP4: Ultimate Runner (Target + 2 ATR or baseline 3.5R)
            tp[3] = Math.max(primaryTarget + 2 * atr, entry + risk * 3.5);
        } else {
            // TP1: Halfway
            tp[0] = entry - (entry - primaryTarget) * 0.5;
            // TP2: Target
            tp[1] = primaryTarget;
            // TP3: Target - 1 ATR extension
            tp[2] = Math.min(primaryTarget - atr, entry - risk * 2.5);
            // TP4: Target - 2 ATR extension
            tp[3] = Math.min(primaryTarget - 2 * atr, entry - risk * 3.5);
        }

        // ─── INVARIANT: every TP must lie on the correct side of entry AND be strictly monotonic ───
        // If we can't build a valid ladder from structure, reject the signal rather than fabricating
        // targets detached from the market — caller will skip it.
        const isLong = direction === SignalDirection.LONG;
        for (let i = 0; i < tp.length; i++) {
            if (isLong && tp[i] <= entry) return null;
            if (!isLong && tp[i] >= entry) return null;
            if (i > 0) {
                if (isLong && tp[i] <= tp[i - 1]) return null;
                if (!isLong && tp[i] >= tp[i - 1]) return null;
            }
        }

        // Just map standard R:R values for telemetry purposes (Risk factor equivalent)
        const rrLadder = tp.map(t => Math.abs(t - entry) / risk);

        const riskPercent = (risk / entry) * 100;

        // ─── Step 4: Regime-adaptive weighted R:R ───
        const weights = getTpWeights(ctx.regime.type);
        const weightedRR = rrLadder.reduce((sum, current_rr, i) => sum + current_rr * weights[i], 0);

        return {
            entry,
            sl,
            tp,
            riskPercent,
            rrRatio: parseFloat(weightedRR.toFixed(2))
        };
    }
}

