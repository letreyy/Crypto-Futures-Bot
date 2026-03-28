import { SignalDirection } from '../core/constants/enums.js';
import { StrategyContext, SignalLevels, StrategySignalCandidate } from '../core/types/bot-types.js';

const MAX_RISK_PERCENT = 2.0; // Maximum SL distance: 2% from entry

// (TP multipliers removed in favor of dynamic structural levels)

// Weights for each TP in the ladder (25% each for weighted average R:R)
const TP_WEIGHTS = [0.25, 0.25, 0.25, 0.25];

export class RiskEngine {
    static calculateLevels(ctx: StrategyContext, candidate: StrategySignalCandidate): SignalLevels {
        const { direction, suggestedEntry, suggestedTarget, suggestedSl } = candidate;
        const last = ctx.candles[ctx.candles.length - 1];
        const atr = ctx.indicators.atr;
        const entry = suggestedEntry || last.close;
        
        // ─── Step 1: Calculate initial SL from structure + ATR ───
        let sl: number;
        if (suggestedSl) {
            // Strategy provided an exact structural invalidation level
            sl = suggestedSl;
        } else if (direction === SignalDirection.LONG) {
            sl = Math.min(ctx.liquidity.localRangeLow || (entry - 2 * atr), entry - 1.5 * atr);
        } else {
            sl = Math.max(ctx.liquidity.localRangeHigh || (entry + 2 * atr), entry + 1.5 * atr);
        }

        // ─── Step 2: Cap SL distance to MAX_RISK_PERCENT ───
        let risk = Math.abs(entry - sl);
        const maxRisk = entry * (MAX_RISK_PERCENT / 100);

        if (risk > maxRisk) {
            risk = maxRisk;
            sl = direction === SignalDirection.LONG
                ? entry - risk
                : entry + risk;
        }

        // ─── Step 3: Calculate TP levels (Structural Targets) ───
        // If strategy didn't provide a target, aim for the opposite side of the local range
        let primaryTarget = suggestedTarget;
        if (!primaryTarget) {
            primaryTarget = direction === SignalDirection.LONG 
                ? (ctx.liquidity.localRangeHigh || entry + risk * 2.0)
                : (ctx.liquidity.localRangeLow || entry - risk * 2.0);
        }

        // Build the 4-step TP ladder around the primary target
        let tp: number[] = [];
        if (direction === SignalDirection.LONG) {
            // TP1: Scale out halfway to structural target (safeguard)
            tp[0] = entry + (primaryTarget - entry) * 0.5;
            // TP2: Exact primary structural target (e.g., liquidity sweep zone)
            tp[1] = primaryTarget;
            // TP3: Structural target broken + 1 ATR extension (trending push)
            tp[2] = Math.max(primaryTarget + atr, entry + risk * 2.5); // Ensure it's not worse than 2.5R
            // TP4: Ultimate Runner (Target + 2 ATR or baseline 3.5R if ATR is tight)
            tp[3] = Math.max(primaryTarget + 2 * atr, entry + risk * 3.5);
        } else {
            tp[0] = entry - (entry - primaryTarget) * 0.5;
            tp[1] = primaryTarget;
            tp[2] = Math.min(primaryTarget - atr, entry - risk * 2.5);
            tp[3] = Math.min(primaryTarget - 2 * atr, entry - risk * 3.5);
        }

        // Just map standard R:R values for telemetry purposes (Risk factor equivalent)
        const rrLadder = tp.map(t => Math.abs(t - entry) / risk);

        const riskPercent = (risk / entry) * 100;

        // ─── Step 4: Dynamic R:R = weighted average of actual structural TPs ───
        const weightedRR = rrLadder.reduce((sum, current_rr, i) => sum + current_rr * TP_WEIGHTS[i], 0);

        return {
            entry,
            sl,
            tp,
            riskPercent,
            rrRatio: parseFloat(weightedRR.toFixed(2))
        };
    }
}

