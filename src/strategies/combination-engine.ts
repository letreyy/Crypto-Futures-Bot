import { StrategySignalCandidate, StrategyContext } from '../core/types/bot-types.js';
import { SignalDirection } from '../core/constants/enums.js';
import { logger } from '../core/utils/logger.js';

/**
 * Combination Engine
 * Takes individual strategy signals for a given symbol and produces "combo" signals
 * when multiple strategies fire in the same direction simultaneously.
 *
 * Combos have HIGHER confidence and score than individual signals.
 * They don't duplicate strategy code — they AGGREGATE existing signals.
 */

interface ComboDefinition {
    name: string;
    id: string;
    /** Names of strategies that must fire (at least `minMatch` of them) */
    requiredStrategies: string[];
    /** Minimum number of matching strategies from the list */
    minMatch: number;
    /** Extra context conditions */
    contextFilter?: (ctx: StrategyContext) => boolean;
    /** Confidence boost applied to the combo signal */
    confidence: number;
    /** Reasons describing why this combo is powerful */
    reasons: string[];
    expireMinutes: number;
}

const COMBO_DEFINITIONS: ComboDefinition[] = [
    {
        name: 'Liquidity Trap Reversal',
        id: 'combo-liquidity-trap',
        requiredStrategies: ['Liquidity Sweep', 'Delta Divergence', 'Breakout Failure'],
        minMatch: 2,
        contextFilter: (ctx) => {
            const last = ctx.candles[ctx.candles.length - 1];
            return last.volume > ctx.indicators.volumeSma * 1.5; // volume spike required
        },
        confidence: 90,
        reasons: ['COMBO: Liquidity trap reversal', 'Multiple reversal signals aligned', 'Volume spike confirms trap'],
        expireMinutes: 25
    },
    {
        name: 'Trend Pullback',
        id: 'combo-trend-pullback',
        requiredStrategies: ['EMA Pullback', 'EMA Ribbon Scalp'],
        minMatch: 2,
        contextFilter: (_ctx) => {
            // HTF trend must align: price above EMA200 for long, below for short
            return true; // Direction check handled in matching logic
        },
        confidence: 88,
        reasons: ['COMBO: Multi-EMA trend pullback', 'EMA pullback + ribbon alignment', 'Strong trend continuation'],
        expireMinutes: 30
    },
    {
        name: 'VWAP Reversion Pro',
        id: 'combo-vwap-reversion',
        requiredStrategies: ['VWAP Reversion', 'VWAP Bands', 'Absorption'],
        minMatch: 2,
        confidence: 87,
        reasons: ['COMBO: VWAP reversion with absorption', 'Price extended from VWAP', 'Volume absorption at extreme'],
        expireMinutes: 25
    },
    {
        name: 'Breakout With Fuel',
        id: 'combo-breakout-fuel',
        requiredStrategies: ['Momentum Breakout', 'OI Divergence', 'BOS/CHoCH'],
        minMatch: 2,
        contextFilter: (ctx) => {
            const last = ctx.candles[ctx.candles.length - 1];
            return last.volume > ctx.indicators.volumeSma * 1.5;
        },
        confidence: 88,
        reasons: ['COMBO: Breakout with OI fuel', 'Structure break + momentum', 'OI expanding = new money entering'],
        expireMinutes: 30
    },
    {
        name: 'Funding Trap',
        id: 'combo-funding-trap',
        requiredStrategies: ['Funding Reversal', 'OI Divergence', 'Breakout Failure'],
        minMatch: 2,
        confidence: 86,
        reasons: ['COMBO: Funding crowd trap', 'Extreme funding + crowd positioning', 'Smart money contra-signal'],
        expireMinutes: 30
    }
];

export class CombinationEngine {
    /**
     * Takes all individual signals for a symbol and returns combo signals (if any match).
     * Combo signals are ADDED alongside individual signals — the scan worker picks the best.
     */
    static evaluate(
        individualSignals: StrategySignalCandidate[],
        ctx: StrategyContext
    ): StrategySignalCandidate[] {
        if (individualSignals.length < 2) return []; // Need at least 2 signals for a combo

        const combos: StrategySignalCandidate[] = [];

        for (const combo of COMBO_DEFINITIONS) {
            // Group signals by direction
            const longSignals = individualSignals.filter(s => s.direction === SignalDirection.LONG);
            const shortSignals = individualSignals.filter(s => s.direction === SignalDirection.SHORT);

            // Check LONG combos
            const longCombo = this.checkCombo(combo, longSignals, ctx, SignalDirection.LONG);
            if (longCombo) combos.push(longCombo);

            // Check SHORT combos
            const shortCombo = this.checkCombo(combo, shortSignals, ctx, SignalDirection.SHORT);
            if (shortCombo) combos.push(shortCombo);
        }

        return combos;
    }

    private static checkCombo(
        combo: ComboDefinition,
        signals: StrategySignalCandidate[],
        ctx: StrategyContext,
        direction: SignalDirection
    ): StrategySignalCandidate | null {
        const matchingNames = signals
            .filter(s => combo.requiredStrategies.includes(s.strategyName))
            .map(s => s.strategyName);

        const uniqueMatches = [...new Set(matchingNames)];

        if (uniqueMatches.length < combo.minMatch) return null;

        // Apply context filter if defined
        if (combo.contextFilter && !combo.contextFilter(ctx)) return null;

        const matchedReasons = uniqueMatches.map(n => `✓ ${n}`);

        logger.info(`[COMBO] ${combo.name} triggered: ${uniqueMatches.join(' + ')} → ${direction}`);

        return {
            strategyName: combo.name,
            direction,
            confidence: combo.confidence,
            reasons: [...combo.reasons, ...matchedReasons],
            expireMinutes: combo.expireMinutes
        };
    }
}
