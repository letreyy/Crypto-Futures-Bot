import { SignalDirection } from '../core/constants/enums.js';
export class RiskEngine {
    static calculateLevels(ctx, direction) {
        const last = ctx.candles[ctx.candles.length - 1];
        const atr = ctx.indicators.atr;
        const entry = last.close;
        let sl;
        if (direction === SignalDirection.LONG) {
            sl = Math.min(ctx.liquidity.localRangeLow || (entry - 2 * atr), entry - 1.5 * atr);
        }
        else {
            sl = Math.max(ctx.liquidity.localRangeHigh || (entry + 2 * atr), entry + 1.5 * atr);
        }
        const risk = Math.abs(entry - sl);
        const tp = [
            entry + (direction === SignalDirection.LONG ? risk * 1.0 : -risk * 1.0),
            entry + (direction === SignalDirection.LONG ? risk * 1.5 : -risk * 1.5),
            entry + (direction === SignalDirection.LONG ? risk * 2.0 : -risk * 2.0),
            entry + (direction === SignalDirection.LONG ? risk * 3.0 : -risk * 3.0)
        ];
        const riskPercent = (risk / entry) * 100;
        return {
            entry,
            sl,
            tp,
            riskPercent,
            rrRatio: 3.0
        };
    }
}
//# sourceMappingURL=risk-engine.js.map