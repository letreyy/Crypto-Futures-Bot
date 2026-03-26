import { SignalDirection } from '../core/constants/enums.js';
import { StrategyContext, SignalLevels } from '../core/types/bot-types.js';

const MAX_RISK_PERCENT = 2.0; // Maximum SL distance: 2% from entry

// TP multipliers (R:R ratio for each level)
// Shifted TP1 from 1.0R → 1.5R so it covers commissions at any leverage
const TP_MULTIPLIERS = [1.5, 2.0, 2.5, 3.5];

// Weights for each TP in the ladder (25% each for weighted average R:R)
const TP_WEIGHTS = [0.25, 0.25, 0.25, 0.25];

export class RiskEngine {
    static calculateLevels(ctx: StrategyContext, direction: SignalDirection): SignalLevels {
        const last = ctx.candles[ctx.candles.length - 1];
        const atr = ctx.indicators.atr;
        const entry = last.close;
        
        // ─── Step 1: Calculate initial SL from structure + ATR ───
        let sl: number;
        if (direction === SignalDirection.LONG) {
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

        // ─── Step 3: Calculate TP levels using shifted multipliers ───
        const tp = TP_MULTIPLIERS.map(mult =>
            direction === SignalDirection.LONG
                ? entry + risk * mult
                : entry - risk * mult
        );

        const riskPercent = (risk / entry) * 100;

        // ─── Step 4: Dynamic R:R = weighted average of TP multipliers ───
        const weightedRR = TP_MULTIPLIERS.reduce((sum, mult, i) => sum + mult * TP_WEIGHTS[i], 0);

        return {
            entry,
            sl,
            tp,
            riskPercent,
            rrRatio: parseFloat(weightedRR.toFixed(2))
        };
    }
}

