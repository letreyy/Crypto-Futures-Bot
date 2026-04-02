import { StrategyContext } from '../core/types/bot-types.js';
import { SignalDirection } from '../core/constants/enums.js';

/**
 * Global signal filters applied BEFORE strategy execution.
 * Filters that return false → skip the entire symbol for this scan cycle.
 * Direction filters return false → skip signals in that specific direction.
 */

export interface FilterConfig {
    htfTrendEnabled: boolean;
    volatilityMinAtrPct: number;
    volatilityMaxAtrPct: number;
    sessionEnabled: boolean;
    deadHoursUTC: number[]; // hours to skip, e.g. [0, 1, 2, 3] for 00:00-03:59 UTC
    btcFilterEnabled: boolean; // only trade in the direction of BTC 1H trend
}

const DEFAULT_FILTER_CONFIG: FilterConfig = {
    htfTrendEnabled: true,
    volatilityMinAtrPct: 0.08,   // Below 0.08% ATR = too flat, don't trade
    volatilityMaxAtrPct: 5.0,    // Above 5% ATR = too volatile / likely manipulated
    sessionEnabled: true,
    deadHoursUTC: [1, 2],        // 01:00-02:59 UTC = truly dead zone (compressed from 4h to 2h)
    btcFilterEnabled: true,      // Reject altcoin signals that fight the BTC trend
};

export const filterConfig: FilterConfig = { ...DEFAULT_FILTER_CONFIG };

/**
 * Pre-execution filter: should we even look at this symbol right now?
 * Returns false = skip entirely, true = proceed with strategy execution.
 */
export function passesGlobalFilters(ctx: StrategyContext): boolean {
    // ─── Session Filter ───
    if (filterConfig.sessionEnabled) {
        const currentHourUTC = new Date().getUTCHours();
        if (filterConfig.deadHoursUTC.includes(currentHourUTC)) {
            return false;
        }
    }

    // ─── Volatility Filter ───
    const last = ctx.candles[ctx.candles.length - 1];
    const atrPct = (ctx.indicators.atr / last.close) * 100;

    if (atrPct < filterConfig.volatilityMinAtrPct) {
        return false; // Too flat — no opportunity
    }
    if (atrPct > filterConfig.volatilityMaxAtrPct) {
        return false; // Too volatile — dangerous
    }

    return true;
}

// Mean-reversion strategies trade pullbacks against the momentum —
// binding them to BTC trend filters kills their edge.
const MEAN_REVERSION_STRATEGIES = new Set([
    'VWAP Reversion',
    'Delta Divergence',
    'Absorption',
    'Order Flow Imbalance',
    'VWAP Reversion Pro',
    'Funding Reversal',
    'Range Bounce',
    'RSI Divergence',
    'Volume Climax Reversal',
]);

/**
 * Post-execution filter: is this signal direction allowed by HTF trend?
 * Returns true = signal is allowed, false = signal is rejected.
 */
export function passesDirectionFilter(ctx: StrategyContext, direction: SignalDirection, strategyName?: string): boolean {
    if (!filterConfig.htfTrendEnabled) return true;

    const isMeanReversion = strategyName ? MEAN_REVERSION_STRATEGIES.has(strategyName) : false;

    const price = ctx.candles[ctx.candles.length - 1].close;
    const ema200 = ctx.indicators.ema200;

    // ─── Local HTF Trend Filter (skip for mean-reversion) ───
    if (filterConfig.htfTrendEnabled && !isMeanReversion) {
        if (direction === SignalDirection.LONG && price < ema200) return false;
        if (direction === SignalDirection.SHORT && price > ema200) return false;
    }

    // ─── Global BTC Market Filter (skip for mean-reversion) ───
    if (filterConfig.btcFilterEnabled && ctx.btcContext && !isMeanReversion) {
        if (direction === SignalDirection.LONG && ctx.btcContext.trend === 'BEARISH') return false;
        if (direction === SignalDirection.SHORT && ctx.btcContext.trend === 'BULLISH') return false;
    }

    return true;
}
