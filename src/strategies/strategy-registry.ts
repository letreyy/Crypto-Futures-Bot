import { VWAPReversionStrategy, LiquiditySweepStrategy } from './modules/core-strategies.js';
import { PumpDetectorStrategy, MicroPullbackStrategy, DumpBounceStrategy, RangeBounceStrategy, BreakoutFailureStrategy } from './modules/extra-strategies.js';
import { FundingReversalStrategy } from './modules/funding-reversal.js';
import { OIDivergenceStrategy } from './modules/oi-divergence.js';
import { EmaRibbonScalpStrategy } from './modules/ema-ribbon-scalp.js';
import { OrderFlowImbalanceStrategy } from './modules/order-flow-imbalance.js';
import { BosChochStrategy } from './modules/bos-choch.js';
import { FairValueGapStrategy } from './modules/fair-value-gap.js';
import { OrderBlocksStrategy } from './modules/order-blocks.js';
import { DeltaDivergenceStrategy } from './modules/delta-divergence.js';
import { AbsorptionStrategy } from './modules/absorption.js';
import { VwapBandsStrategy } from './modules/vwap-bands.js';
import { TrendingPullback1hStrategy } from './modules/trending-pullback-1h.js';
import { VolatilitySqueezeStrategy } from './modules/volatility-squeeze.js';
import { OpeningRangeScalpStrategy } from './modules/opening-range-scalp.js';
import { RsiDivergenceStrategy } from './modules/rsi-divergence.js';
import { VolumeClimaxReversalStrategy } from './modules/volume-climax-reversal.js';
import { EmaCrossMomentumStrategy } from './modules/ema-cross-momentum.js';
import { BollingerBandReversalStrategy } from './modules/bb-reversal.js';
import { Strategy } from './base/strategy.js';

export const strategyRegistry: Strategy[] = [
    // ─── Core ───
    new VWAPReversionStrategy(),
    new LiquiditySweepStrategy(),
    // ─── Extra (active) ───
    new RangeBounceStrategy(),
    new BreakoutFailureStrategy(),
    // ─── Specialized ───
    new FundingReversalStrategy(),
    new EmaRibbonScalpStrategy(),
    new OrderFlowImbalanceStrategy(),
    // ─── SMC ───
    new BosChochStrategy(),
    new FairValueGapStrategy(),
    new OrderBlocksStrategy(),
    // ─── New ───
    new DeltaDivergenceStrategy(),
    new AbsorptionStrategy(),
    new TrendingPullback1hStrategy(),
    new VolatilitySqueezeStrategy(),
    new OpeningRangeScalpStrategy(),
    // ─── Reversal / Mean-Reversion ───
    new RsiDivergenceStrategy(),
    new VolumeClimaxReversalStrategy(),
    new EmaCrossMomentumStrategy(),
    new BollingerBandReversalStrategy(),

    // ─── Disabled (execute returns null or temporarily removed) ───
    new PumpDetectorStrategy(),
    new MicroPullbackStrategy(),
    new DumpBounceStrategy(),
    new OIDivergenceStrategy(),
    new VwapBandsStrategy(),
];


