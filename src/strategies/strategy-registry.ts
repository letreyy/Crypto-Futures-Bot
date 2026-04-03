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

// ═══════════════════════════════════════════════════════
// ACTIVE STRATEGIES — 6 proven strategies with real stats
// Last updated: 2026-04-03. Freeze for 2-3 weeks to
// accumulate clean performance data per strategy.
// ═══════════════════════════════════════════════════════
export const strategyRegistry: Strategy[] = [
    new OrderBlocksStrategy(),       // #1: Best performer — 87% WR, +770% PnL (Mar 29-30)
    new LiquiditySweepStrategy(),    // #2: 60% WR, +343% PnL (Mar 29-30)
    new FairValueGapStrategy(),      // #3: SMC core, good sample size
    new DeltaDivergenceStrategy(),   // #4: 100% WR on 4 trades, mean-reversion
    new BreakoutFailureStrategy(),   // #5: 100% WR on 3 trades, counter-trend
    new VWAPReversionStrategy(),     // #6: Core mean-reversion, session-agnostic
];

// ═══════════════════════════════════════════════════════
// DISABLED — awaiting 50+ trade sample before re-enabling
// To re-enable: move entries back to strategyRegistry above
// ═══════════════════════════════════════════════════════
export const disabledStrategyRegistry: Strategy[] = [
    // Unproven in current market conditions:
    new RangeBounceStrategy(),
    new FundingReversalStrategy(),
    new EmaRibbonScalpStrategy(),
    new OrderFlowImbalanceStrategy(),
    new BosChochStrategy(),
    new AbsorptionStrategy(),
    new TrendingPullback1hStrategy(),
    new VolatilitySqueezeStrategy(),
    new OpeningRangeScalpStrategy(),
    new RsiDivergenceStrategy(),
    new VolumeClimaxReversalStrategy(),
    new EmaCrossMomentumStrategy(),
    new BollingerBandReversalStrategy(),
    // Permanently disabled (logic issues):
    new PumpDetectorStrategy(),
    new MicroPullbackStrategy(),
    new DumpBounceStrategy(),
    new OIDivergenceStrategy(),
    new VwapBandsStrategy(),
];




