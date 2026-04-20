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

export const COMBO_DEFINITIONS: ComboDefinition[] = [
    // ─── SMC Institutional Entry ───
    // OB retest + equal-level sweep = classic smart-money setup
    {
        name: 'Institutional Entry',
        id: 'combo-institutional-entry',
        requiredStrategies: ['Order Block Retest', 'Liquidity Sweep', 'OP Enhanced Liquidity Sweep'],
        minMatch: 2,
        confidence: 90,
        reasons: ['COMBO: Institutional entry', 'Order block + liquidity sweep aligned', 'High-probability SMC setup'],
        expireMinutes: 45
    },
    // ─── Squeeze + Trend Pullback ───
    // Bollinger breakout in direction of EMA/VWAP pullback trend
    {
        name: 'Squeeze Trend Push',
        id: 'combo-squeeze-trend-push',
        requiredStrategies: ['OP Bollinger Squeeze Breakout', 'OP EMA Ribbon + VWAP Pullback', 'EMA Cross Momentum'],
        minMatch: 2,
        contextFilter: (ctx) => {
            const last = ctx.candles[ctx.candles.length - 1];
            return last.volume > ctx.indicators.volumeSma * 1.3;
        },
        confidence: 88,
        reasons: ['COMBO: Squeeze release into trend', 'Volatility expansion + trend alignment', 'Multi-strategy momentum confirmation'],
        expireMinutes: 45
    },
    // ─── Funding Extreme Reversal ───
    {
        name: 'Funding Extreme Reversal',
        id: 'combo-funding-extreme',
        requiredStrategies: ['OP Funding + OI Divergence', 'OP Range Mean-Reversion', 'OP Enhanced Liquidity Sweep'],
        minMatch: 2,
        confidence: 87,
        reasons: ['COMBO: Funding extreme reversal', 'Sentiment + technical confluence', 'Crowd-trap contrarian signal'],
        expireMinutes: 90
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
