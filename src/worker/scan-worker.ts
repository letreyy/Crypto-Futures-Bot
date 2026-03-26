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
import { CombinationEngine } from '../strategies/combination-engine.js';

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

        for (const symbol of topSymbols) {
            if (!this.isRunning) break;
            if (tradeExecutor.hasActiveTrade(symbol)) continue;

            try {
                // Fetch candles
                const candles = await binanceClient.getKlines(symbol, '5m', config.bot.klinesLimit);
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
                        binanceClient.getOpenInterestHist(symbol, '5m', 30)
                    ]);
                    funding = fr || undefined;
                    if (currentOI !== null && oiHistory.length > 0) {
                        openInterest = { oi: currentOI, oiHistory };
                    }
                } catch {}

                const ctx: StrategyContext = {
                    symbol, timeframe: '5m', candles, indicators, prevIndicators, regime, liquidity, funding, openInterest
                };

                await tradeExecutor.updatePaperTrades(ctx);

                // ─── GLOBAL FILTERS ───
                if (!passesGlobalFilters(ctx)) continue;

                // ─── Strategy execution ───
                const individualSignals: StrategySignalCandidate[] = [];

                for (const strategy of strategyRegistry) {
                    // Skip disabled strategies
                    if (tradeExecutor.isStrategyDisabled(strategy.name)) continue;

                    // Skip if this symbol+strategy combo just got stopped out
                    if (tradeExecutor.isOnSlCooldown(symbol, strategy.name)) continue;

                    const candidate = strategy.execute(ctx);
                    if (candidate) {
                        // HTF Direction filter
                        if (!passesDirectionFilter(ctx, candidate.direction)) continue;
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
                    
                    if (score >= config.bot.minSignalScore) {
                        if (!dedupStore.isCooldown(symbol, candidate.strategyName, candidate.direction)) {
                            const levels = RiskEngine.calculateLevels(ctx, candidate.direction);
                            const leverageSuggestion = tradeExecutor.calculateLeverage(levels.riskPercent);
                            
                            symbolSignals.push({
                                ...candidate,
                                symbol,
                                timeframe: '5m',
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

                    await telegramNotifier.sendSignal(finalSignal, ctx);
                    await tradeExecutor.processSignal(finalSignal);
                    dedupStore.recordAlert(symbol, finalSignal.strategyName, finalSignal.direction);
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
