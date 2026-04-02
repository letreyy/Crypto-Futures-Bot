import { binanceClient } from '../exchange/binance/binance-client.js';
import { universeLoader } from '../market/universe/universe-loader.js';
import { logger } from '../core/utils/logger.js';
import { TechnicalIndicators } from '../market/indicators/indicator-engine.js';
import { MarketRegimeEngine } from '../market/regime/regime-engine.js';
import { LiquidityEngine } from '../market/liquidity/liquidity-engine.js';
import { strategyRegistry } from '../strategies/strategy-registry.js';
import { ScoringEngine } from '../scoring/scoring-engine.js';
import { RiskEngine } from '../risk/risk-engine.js';
import { telegramNotifier } from '../notifications/telegram/telegram-notifier.js';
import { tradeExecutor } from '../trading/trade-executor.js';
import { dedupStore } from '../state/dedup-store.js';
import { config } from '../config/index.js';
import { FinalSignal, StrategyContext, StrategySignalCandidate } from '../core/types/bot-types.js';
import { passesGlobalFilters, passesDirectionFilter } from '../strategies/global-filters.js';
import { TimeFilters } from '../market/time-filters.js';
import { CombinationEngine } from '../strategies/combination-engine.js';
import { TelemetryLogger } from './telemetry-logger.js';

export class ScanWorker {
    private isRunning: boolean = false;

    async start() {
        this.isRunning = true;
        logger.info('Scan Worker started');
        this.runLoop();
    }

    private async runLoop() {
        while (this.isRunning) {
            try {
                const startTime = Date.now();
                await this.scan();
                const elapsed = Date.now() - startTime;
                const waitTime = Math.max(0, config.bot.scanIntervalSeconds * 1000 - elapsed);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            } catch (err: any) {
                logger.error('Error in scan loop', { error: err.message });
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    private async scan() {
        const topSymbols = await universeLoader.getTopSymbols();

        let btcContext: { trend: 'BULLISH' | 'BEARISH'; price: number; ema200: number } | undefined;
        try {
            // Fetch 1-hour candles for BTC for higher-timeframe global trend context
            const btcCandles = await binanceClient.getKlines('BTCUSDT', '1h', 250);
            if (btcCandles && btcCandles.length > 200) {
                const btcInds = TechnicalIndicators.calculateSnapshot(btcCandles);
                const btcPrice = btcCandles[btcCandles.length - 1].close;
                btcContext = {
                    trend: btcPrice > btcInds.ema200 ? 'BULLISH' : 'BEARISH',
                    price: btcPrice,
                    ema200: btcInds.ema200
                };
            }
        } catch (err: any) {
            logger.warn('Failed to fetch BTC context, skipping global BTC filter', { error: err.message });
        }

        for (const symbol of topSymbols) {
            if (!this.isRunning) break;

            try {
                // Fetch candles
                const candles = await binanceClient.getKlines(symbol, '15m', config.bot.klinesLimit);
                if (!candles || candles.length < 200) continue;

                // Indicator snapshots
                const indicators = TechnicalIndicators.calculateSnapshot(candles);
                const prevCandles = candles.slice(0, -1);
                const prevIndicators = TechnicalIndicators.calculateSnapshot(prevCandles);
                const regime = MarketRegimeEngine.classify(candles, indicators);
                const liquidity = LiquidityEngine.getContext(candles);

                let funding;
                let openInterest;
                try {
                    const [fr, currentOI, oiHistory] = await Promise.all([
                        binanceClient.getFundingRate(symbol),
                        binanceClient.getOpenInterest(symbol),
                        binanceClient.getOpenInterestHist(symbol, '15m', 30)
                    ]);
                    funding = fr || undefined;
                    if (currentOI !== null && oiHistory.length > 0) {
                        openInterest = { oi: currentOI, oiHistory };
                    }
                } catch {}

                const ctx: StrategyContext = {
                    symbol, timeframe: '15m', candles, indicators, prevIndicators, regime, liquidity, funding, openInterest, btcContext
                };

                await tradeExecutor.updatePaperTrades(ctx);

                // If symbol has an active trade, only proceed if we can potentially apply Smart DCA
                const activeTrade = tradeExecutor.getActiveTrade(symbol);
                if (activeTrade) {
                    // Skip scanning if the trade is pending limit, or already DCA'd
                    if (activeTrade.status !== 'ACTIVE' || activeTrade.dcaCount > 0) continue;
                }

                // ─── GLOBAL FILTERS ───
                if (!passesGlobalFilters(ctx)) continue;

                // ─── Strategy execution ───
                const individualSignals: StrategySignalCandidate[] = [];
                const currentSession = TimeFilters.getCurrentSession();

                for (const strategy of strategyRegistry) {
                    // Skip disabled strategies
                    if (tradeExecutor.isStrategyDisabled(strategy.name)) continue;

                    // Skip if strategy is blocked in the current trading session (e.g. Asian Session)
                    if (!TimeFilters.isStrategyAllowed(strategy.id, currentSession)) continue;

                    // Skip if this symbol+strategy combo just got stopped out
                    if (tradeExecutor.isOnSlCooldown(symbol, strategy.name)) continue;

                    const candidate = strategy.execute(ctx);
                    if (candidate) {
                        // HTF Direction filter — pass strategyName so mean-reversion strategies skip BTC filter
                        if (!passesDirectionFilter(ctx, candidate.direction, candidate.strategyName)) continue;
                        individualSignals.push(candidate);
                    }
                }

                // ─── Combination Engine: produce combo signals from matching individuals ───
                const comboSignals = CombinationEngine.evaluate(individualSignals, ctx);
                const allCandidates = [...individualSignals, ...comboSignals];

                // ─── Build scored final signals ───
                const symbolSignals: FinalSignal[] = [];

                for (const candidate of allCandidates) {
                    const { score, label } = ScoringEngine.calculate(ctx, candidate);
                    const levels = RiskEngine.calculateLevels(ctx, candidate);
                    
                    // NEW: Log ALL candidates to telemetry BEFORE any filters
                    TelemetryLogger.log(symbol, candidate, levels, score);
                    
                    if (score >= config.bot.minSignalScore) {
                        if (!dedupStore.isCooldown(symbol, candidate.strategyName, candidate.direction)) {
                            const leverageSuggestion = tradeExecutor.calculateLeverage(levels.riskPercent);
                            
                            // ─── Filter: REJECT signals with low weighted profit potential ───
                            // Weighted Profit = Weighted R:R * Account Risk %
                            // e.g. RR 1.5 * Risk 1% = 1.5% total expected account gain
                            const weightedProfit = levels.rrRatio * (tradeExecutor as any).targetRiskPercent;

                            if (weightedProfit < config.bot.minProfitLeveraged) {
                                logger.info(`[REJECTED LOW PROFIT] ${symbol} ${candidate.strategyName}: Weighted profit ${weightedProfit.toFixed(2)}% < ${config.bot.minProfitLeveraged}%`);
                                continue;
                            }
                            
                            symbolSignals.push({
                                ...candidate,
                                symbol,
                                timeframe: '15m',
                                levels,
                                regime,
                                score,
                                confidenceLabel: label,
                                timestamp: Date.now(),
                                leverageSuggestion
                            });
                        }
                    }
                }

                if (symbolSignals.length > 0) {
                    // Pick the best signal to prevent overlaps and spam
                    symbolSignals.sort((a, b) => b.score - a.score);
                    const finalSignal = symbolSignals[0];

                    // Pass the current live price to calculate drawdown purely for DCA evaluation
                    const currentPrice = candles[candles.length - 1].close;
                    await tradeExecutor.processSignal(finalSignal, currentPrice);
                    
                    // Do not log to telegram or deduplicate if it's just a duplicate signal that got rejected
                    // The tradeExecutor will handle telegram notifications for DCA success itself.
                    if (!activeTrade) {
                        await telegramNotifier.sendSignal(finalSignal, ctx);
                        dedupStore.recordAlert(symbol, finalSignal.strategyName, finalSignal.direction);
                    }
                }

            } catch (err: any) {
                logger.error(`Error scanning ${symbol}`, { error: err.message });
            }
        }
        logger.info('Scan complete.');
    }

    stop() {
        this.isRunning = false;
        logger.info('Scan Worker stopping...');
    }
}

export const scanWorker = new ScanWorker();
