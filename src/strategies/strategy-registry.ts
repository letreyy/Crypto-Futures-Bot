import { EMAPullbackStrategy, SqueezeBreakoutStrategy, VWAPReversionStrategy, LiquiditySweepStrategy } from './modules/core-strategies.js';
import { MomentumBreakoutStrategy, PumpDetectorStrategy, MicroPullbackStrategy, DumpBounceStrategy, RangeBounceStrategy, BreakoutFailureStrategy } from './modules/extra-strategies.js';
import { FundingReversalStrategy } from './modules/funding-reversal.js';
import { OIDivergenceStrategy } from './modules/oi-divergence.js';
import { EmaRibbonScalpStrategy } from './modules/ema-ribbon-scalp.js';
import { OrderFlowImbalanceStrategy } from './modules/order-flow-imbalance.js';
import { BosChochStrategy } from './modules/bos-choch.js';
import { FairValueGapStrategy } from './modules/fair-value-gap.js';
import { DeltaDivergenceStrategy } from './modules/delta-divergence.js';
import { AbsorptionStrategy } from './modules/absorption.js';
import { VwapBandsStrategy } from './modules/vwap-bands.js';
import { VolumeProfileStrategy } from './modules/volume-profile.js';
import { Strategy } from './base/strategy.js';

export const strategyRegistry: Strategy[] = [
    // ─── Core ───
    new EMAPullbackStrategy(),
    new SqueezeBreakoutStrategy(),
    new VWAPReversionStrategy(),
    new LiquiditySweepStrategy(),
    // ─── Extra (active) ───
    new MomentumBreakoutStrategy(),
    new RangeBounceStrategy(),
    new BreakoutFailureStrategy(),
    // ─── Disabled (execute returns null, kept for backward compat) ───
    new PumpDetectorStrategy(),
    new MicroPullbackStrategy(),
    new DumpBounceStrategy(),
    // ─── Specialized ───
    new FundingReversalStrategy(),
    new OIDivergenceStrategy(),
    new EmaRibbonScalpStrategy(),
    new OrderFlowImbalanceStrategy(),
    // ─── SMC ───
    new BosChochStrategy(),
    new FairValueGapStrategy(),
    // ─── New ───
    new DeltaDivergenceStrategy(),
    new AbsorptionStrategy(),
    new VwapBandsStrategy(),
    new VolumeProfileStrategy(),
];


