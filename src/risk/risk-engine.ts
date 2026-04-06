import { SignalDirection } from '../core/constants/enums.js';
import { StrategyContext, SignalLevels, StrategySignalCandidate } from '../core/types/bot-types.js';

const MIN_RISK_PERCENT = 0.35; // Minimum SL distance: 0.35% (Noise floor)
const MAX_RISK_PERCENT = 1.8;  // Maximum SL distance: 1.8% (Risk cap)

// Weights for each TP in the ladder (40%, 40%, 10%, 10%)
const TP_WEIGHTS = [0.40, 0.40, 0.10, 0.10];

export class RiskEngine {
    static calculateLevels(ctx: StrategyContext, candidate: StrategySignalCandidate): SignalLevels {
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

        // ─── Step 2: Enforce Risk Corridor (0.35% - 1.8%) ───
        let risk = Math.abs(entry - sl);
        let currentRiskPct = (risk / entry) * 100;

        if (currentRiskPct > MAX_RISK_PERCENT) {
            risk = entry * (MAX_RISK_PERCENT / 100);
            sl = direction === SignalDirection.LONG ? entry - risk : entry + risk;
        } else if (currentRiskPct < MIN_RISK_PERCENT) {
            risk = entry * (MIN_RISK_PERCENT / 100);
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
        let tp: number[] = [];
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

        // ─── SANITY CHECK: All TPs must be on the correct side of entry ───
        if (direction === SignalDirection.LONG) {
            tp = tp.map((t, i) => t > entry ? t : entry + risk * (1.5 + i * 0.5));
        } else {
            tp = tp.map((t, i) => t < entry ? t : entry - risk * (1.5 + i * 0.5));
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

