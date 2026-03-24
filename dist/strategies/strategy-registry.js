import { EMAPullbackStrategy, SqueezeBreakoutStrategy, VWAPReversionStrategy, LiquiditySweepStrategy } from './modules/core-strategies.js';
import { MomentumBreakoutStrategy, PumpDetectorStrategy, MicroPullbackStrategy, DumpBounceStrategy, RangeBounceStrategy, BreakoutFailureStrategy } from './modules/extra-strategies.js';
import { FundingReversalStrategy } from './modules/funding-reversal.js';
import { OIDivergenceStrategy } from './modules/oi-divergence.js';
import { EmaRibbonScalpStrategy } from './modules/ema-ribbon-scalp.js';
import { OrderFlowImbalanceStrategy } from './modules/order-flow-imbalance.js';
export const strategyRegistry = [
    new EMAPullbackStrategy(),
    new SqueezeBreakoutStrategy(),
    new VWAPReversionStrategy(),
    new LiquiditySweepStrategy(),
    new MomentumBreakoutStrategy(),
    new PumpDetectorStrategy(),
    new MicroPullbackStrategy(),
    new DumpBounceStrategy(),
    new RangeBounceStrategy(),
    new BreakoutFailureStrategy(),
    new FundingReversalStrategy(),
    new OIDivergenceStrategy(),
    new EmaRibbonScalpStrategy(),
    new OrderFlowImbalanceStrategy()
];
//# sourceMappingURL=strategy-registry.js.map