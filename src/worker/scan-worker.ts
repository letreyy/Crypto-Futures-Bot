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
import { FinalSignal, StrategyContext } from '../core/types/bot-types.js';

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
        const symbols = await universeLoader.getTopSymbols();
        logger.info(`Scanning ${symbols.length} symbols...`);

        for (const symbol of symbols) {
            try {
                // Fetch 5m and 15m candles alongside funding and OI
                const [c5m, c15m, funding, currentOI, oiHistory] = await Promise.all([
                    binanceClient.getKlines(symbol, '5m', 200),
                    binanceClient.getKlines(symbol, '15m', 200),
                    binanceClient.getFundingRate(symbol),
                    binanceClient.getOpenInterest(symbol),
                    binanceClient.getOpenInterestHist(symbol, '5m', 30)
                ]);

                if (!c5m.length || !c15m.length) continue;

                // Indicator snapshots
                const ind5m = TechnicalIndicators.calculateSnapshot(c5m);
                const prevInd5m = TechnicalIndicators.calculateSnapshot(c5m.slice(0, -1));
                const regime = MarketRegimeEngine.classify(c5m, ind5m);
                const liquidity = LiquidityEngine.getContext(c5m);

                const ctx: StrategyContext = {
                    symbol,
                    timeframe: '5m',
                    candles: c5m,
                    candles15m: c15m,
                    indicators: ind5m,
                    prevIndicators: prevInd5m,
                    regime,
                    liquidity,
                    funding: funding || undefined,
                    openInterest: currentOI !== null && oiHistory.length > 0 ? { oi: currentOI, oiHistory } : undefined
                };

                await tradeExecutor.updatePaperTrades(ctx);

                if (tradeExecutor.hasActiveTrade(symbol)) {
                    continue; // Skip symbol completely until the existing trade is closed
                }

                // Strategy execution - Collect all candidates for this symbol
                const symbolSignals: FinalSignal[] = [];

                for (const strategy of strategyRegistry) {
                    // Skip disabled strategies
                    if (tradeExecutor.isStrategyDisabled(strategy.name)) continue;

                    // Skip if this symbol+strategy combo just got stopped out
                    if (tradeExecutor.isOnSlCooldown(symbol, strategy.name)) continue;

                    const candidate = strategy.execute(ctx);
                    if (candidate) {
                        const { score, label } = ScoringEngine.calculate(ctx, candidate);
                        
                        if (score >= config.bot.minSignalScore) {
                            if (!dedupStore.isCooldown(symbol, strategy.id, candidate.direction)) {
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
