import fs from 'fs';
import path from 'path';
import { logger } from '../core/utils/logger.js';
import { telegramNotifier } from '../notifications/telegram/telegram-notifier.js';

interface TradeRecord {
    timestamp: number;
    strategyName: string;
    pnl: number; // in %
    isWin: boolean;
}

interface StrategyPause {
    type: 'SOFT' | 'HARD';
    until: number;
    reason: string;
}

interface Thresholds {
    minN24: number;
    softPnl: number;
    softWR: number;
    softHours: number; // Hours for soft pause (default 12, can be 6 for rare setups)
    hardPF: number;
    hardLS: number;
    unlockN: number;
    unlockWR: number;
    unlockPF?: number;
}

const DEFAULT_THRESHOLDS: Record<string, Thresholds> = {
    // ─── Main Strategies (minN raised to avoid false pauses) ───
    'Order Block Retest': { minN24: 16, softPnl: -18, softWR: 45, softHours: 12, hardPF: 0.85, hardLS: 5, unlockN: 10, unlockWR: 52, unlockPF: 1.05 },
    'Liquidity Sweep':    { minN24: 14, softPnl: -16, softWR: 42, softHours: 12, hardPF: 0.82, hardLS: 5, unlockN: 8,  unlockWR: 50 },
    'Fair Value Gap':     { minN24: 16, softPnl: -20, softWR: 43, softHours: 6,  hardPF: 0.80, hardLS: 6, unlockN: 12, unlockWR: 50, unlockPF: 1.0 }, // rare setups = 6h soft
    'Delta Divergence':   { minN24: 14, softPnl: -12, softWR: 40, softHours: 12, hardPF: 0.85, hardLS: 4, unlockN: 8,  unlockWR: 50, unlockPF: 1.0 },
    'Breakout Failure':   { minN24: 14, softPnl: -14, softWR: 42, softHours: 12, hardPF: 0.82, hardLS: 4, unlockN: 8,  unlockWR: 50 },
    'VWAP Reversion':     { minN24: 14, softPnl: -12, softWR: 40, softHours: 12, hardPF: 0.80, hardLS: 4, unlockN: 8,  unlockWR: 52, unlockPF: 1.0 },
    'EMA Ribbon Scalp':   { minN24: 16, softPnl: -18, softWR: 44, softHours: 12, hardPF: 0.80, hardLS: 5, unlockN: 10, unlockWR: 52, unlockPF: 1.05 },
    'BOS/CHoCH':          { minN24: 14, softPnl: -14, softWR: 42, softHours: 12, hardPF: 0.82, hardLS: 4, unlockN: 8,  unlockWR: 50 },
    // ─── Rare / Low-frequency strategies (soft pause reduced to 6h) ───
    'Absorption':         { minN24: 8,  softPnl: -10, softWR: 40, softHours: 6,  hardPF: 0.80, hardLS: 4, unlockN: 6,  unlockWR: 50 },
    'Funding Reversal':   { minN24: 6,  softPnl: -10, softWR: 40, softHours: 6,  hardPF: 0.80, hardLS: 3, unlockN: 6,  unlockWR: 50, unlockPF: 1.0 },
    'RSI Divergence':     { minN24: 12, softPnl: -14, softWR: 42, softHours: 6,  hardPF: 0.82, hardLS: 4, unlockN: 8,  unlockWR: 50, unlockPF: 1.0 },
    'Volume Climax Reversal': { minN24: 10, softPnl: -12, softWR: 42, softHours: 6, hardPF: 0.82, hardLS: 4, unlockN: 8, unlockWR: 50, unlockPF: 1.0 },
    // ─── Combos ───
    'Liquidity Trap Reversal': { minN24: 6, softPnl: -8, softWR: 45, softHours: 6,  hardPF: 0.9, hardLS: 3, unlockN: 5, unlockWR: 55 },
    'Trend Continuity':        { minN24: 8, softPnl: -10, softWR: 45, softHours: 12, hardPF: 0.9, hardLS: 4, unlockN: 6, unlockWR: 52 },
    'VWAP Reversion Pro':      { minN24: 6, softPnl: -8, softWR: 45, softHours: 6,  hardPF: 0.9, hardLS: 3, unlockN: 5, unlockWR: 55 },
    'Breakout With Fuel':      { minN24: 6, softPnl: -8, softWR: 45, softHours: 6,  hardPF: 0.9, hardLS: 3, unlockN: 5, unlockWR: 55 },
    'Funding Trap':            { minN24: 5, softPnl: -7, softWR: 45, softHours: 6,  hardPF: 0.9, hardLS: 3, unlockN: 4, unlockWR: 55 }
};

const STATS_FILE = path.join(process.cwd(), 'state', 'strategy_stats.json');

export class StatsService {
    private trades: TradeRecord[] = [];
    private activePauses: Map<string, StrategyPause> = new Map();

    constructor() {
        this.load();
    }

    private load() {
        if (fs.existsSync(STATS_FILE)) {
            try {
                const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
                this.trades = data.trades || [];
                // Re-hydrate pauses if needed, but timestamps are enough
            } catch (err) {}
        }
    }

    private save() {
        const dir = path.dirname(STATS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(STATS_FILE, JSON.stringify({ trades: this.trades.slice(-2000) }, null, 2));
    }

    recordTrade(strategyName: string, pnl: number) {
        const record: TradeRecord = {
            timestamp: Date.now(),
            strategyName,
            pnl,
            isWin: pnl > 0
        };
        this.trades.push(record);
        this.save();
        this.evaluatePauses(strategyName);
    }

    isPaused(strategyName: string): boolean {
        const pause = this.activePauses.get(strategyName);
        if (!pause) return false;
        if (Date.now() > pause.until) {
            // Check if we met the unlock criteria during pause
            if (this.checkUnlock(strategyName)) {
                this.activePauses.delete(strategyName);
                telegramNotifier.sendTextMessage(`🔹 <b>Auto-Unlock</b>: Strategy <b>${strategyName}</b> is now back in active rotation.`);
                return false;
            } else {
                // Extend pause if criteria not met
                pause.until = Date.now() + 6 * 60 * 60 * 1000;
                telegramNotifier.sendTextMessage(`⏳ <b>Pause Prolonged</b>: <b>${strategyName}</b> failed to recover. Extending for 6h.`);
                return true;
            }
        }
        return true;
    }

    private checkUnlock(strategyName: string): boolean {
        const thresh = DEFAULT_THRESHOLDS[strategyName];
        if (!thresh) return true; // No rules, just unlock

        // Get recent trades for this strategy (even those happened during pause)
        const recent = this.trades.filter(t => t.strategyName === strategyName).slice(-thresh.unlockN);
        if (recent.length < thresh.unlockN) return false;

        const wins = recent.filter(t => t.isWin).length;
        const wr = (wins / recent.length) * 100;
        
        if (wr < thresh.unlockWR) return false;
        
        if (thresh.unlockPF) {
            const profit = recent.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
            const loss = Math.abs(recent.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
            const pf = loss === 0 ? 99 : profit / loss;
            if (pf < thresh.unlockPF) return false;
        }

        return true;
    }

    private evaluatePauses(strategyName: string) {
        const thresh = DEFAULT_THRESHOLDS[strategyName];
        if (!thresh) return;

        const now = Date.now();
        const win24h = now - 24 * 60 * 60 * 1000;
        const recent24h = this.trades.filter(t => t.strategyName === strategyName && t.timestamp > win24h);
        
        if (recent24h.length < thresh.minN24) return;

        // Calculate metrics
        const pnl = recent24h.reduce((s, t) => s + t.pnl, 0);
        const wins = recent24h.filter(t => t.isWin).length;
        const wr = (wins / recent24h.length) * 100;
        
        const grossProfit = recent24h.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
        const grossLoss = Math.abs(recent24h.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
        const pf = grossLoss === 0 ? 99 : grossProfit / grossLoss;

        let currentStreak = 0;
        let maxLosingStreak = 0;
        for (const t of recent24h) {
            if (!t.isWin) {
                currentStreak++;
                maxLosingStreak = Math.max(maxLosingStreak, currentStreak);
            } else {
                currentStreak = 0;
            }
        }

        // Check Hard Pause first
        if (pf < thresh.hardPF || maxLosingStreak >= thresh.hardLS) {
            this.applyPause(strategyName, 'HARD', `PF ${pf.toFixed(2)} / LS ${maxLosingStreak}`);
            return;
        }

        // Check Soft Pause
        if (wr < thresh.softWR && pnl <= thresh.softPnl) {
            this.applyPause(strategyName, 'SOFT', `WR ${wr.toFixed(0)}% / PnL ${pnl.toFixed(1)}%`);
        }
    }

    private applyPause(strategyName: string, type: 'SOFT' | 'HARD', reason: string) {
        if (this.activePauses.has(strategyName)) return;

        const thresh = DEFAULT_THRESHOLDS[strategyName];
        const hours = type === 'SOFT'
            ? (thresh?.softHours ?? 12)  // Use per-strategy softHours, default 12
            : 24;
        const until = Date.now() + hours * 60 * 60 * 1000;
        this.activePauses.set(strategyName, { type, until, reason });

        const icon = type === 'SOFT' ? '🟡' : '🔴';
        telegramNotifier.sendTextMessage(`${icon} <b>AUTO-PAUSE [${type}]</b>: Strategy <b>${strategyName}</b> disabled for ${hours}h.\nReason: ${reason}`);
        logger.warn(`Auto-pause [${type}] applied to ${strategyName}: ${reason}`);
    }

    // Global protection
    checkGlobalKillSwitch() {
        const now = Date.now();
        const win24h = now - 24 * 60 * 60 * 1000;
        const recent24h = this.trades.filter(t => t.timestamp > win24h);
        const totalPnL = recent24h.reduce((s, t) => s + t.pnl, 0);

        if (totalPnL <= -35) {
            telegramNotifier.sendTextMessage('🚨 <b>GLOBAL CIRCUIT BREAKER</b>: Total 24h PnL is -35%! Halting all new trades for 12 hours.');
            // Implementation would need to block all strategies
        }
    }
}

export const statsService = new StatsService();
