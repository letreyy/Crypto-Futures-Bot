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
// ACTIVE STRATEGIES (Updated 2026-04-05)
// ═══════════════════════════════════════════════════════
export const strategyRegistry: Strategy[] = [
    // ─── The Winners (Consistent Profit) ───
    new OrderBlocksStrategy(),       // #1: Best performer — 64% WR, +18.59% PnL (as of Apr 5)
    new LiquiditySweepStrategy(),    // #2: Good R:R survivor — 44% WR, +9.71% PnL (as of Apr 5)
    
    // ─── New Tests (Strict Filters) ───
    new EmaCrossMomentumStrategy(),    // Trend-following (avoid catching falling knives)
    new VolumeClimaxReversalStrategy() // Strict mean-reversion (extreme volume & wick rejection)
];

// ═══════════════════════════════════════════════════════
// DISABLED — awaiting 50+ trade sample before re-enabling
// To re-enable: move entries back to strategyRegistry above
// ═══════════════════════════════════════════════════════
export const disabledStrategyRegistry: Strategy[] = [
    // ─── Failed live tests (bleeding PnL as of Apr 5) ───
    new FairValueGapStrategy(),      // 17% WR, -24.12% PnL (Noise on 15m)
    new VWAPReversionStrategy(),     // 25% WR, -14.26% PnL (Gets crushed in trends)
    new DeltaDivergenceStrategy(),   // 33% WR, -13.69% PnL (Poor performance)
    new BreakoutFailureStrategy(),   // 17% WR, -7.87% PnL (Poor performance)

    // ─── Unproven in current market conditions ───
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
    new BollingerBandReversalStrategy(),

    // ─── Permanently disabled (logic issues) ───
    new PumpDetectorStrategy(),
    new MicroPullbackStrategy(),
    new DumpBounceStrategy(),
    new OIDivergenceStrategy(),
    new VwapBandsStrategy(),
];




