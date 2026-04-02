import TelegramBot from 'node-telegram-bot-api';
import { config } from '../../config/index.js';
import { logger } from '../../core/utils/logger.js';
import { FinalSignal, StrategyContext } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { ChartGenerator } from './chart-generator.js';

// Mute the node-telegram-bot-api deprecation warning
process.env.NTBA_FIX_350 = '1';

const MAIN_KEYBOARD = {
    keyboard: [
        [{ text: '📊 Статистика' }, { text: '⚙️ Стратегии' }, { text: '🧩 Комбо' }],
        [{ text: '🛡️ Риск' }, { text: '📐 Плечо' }, { text: '🚫 Монеты' }],
        [{ text: '🔄 Режим' }, { text: '🚨 ПАНИКА' }]
    ],
    resize_keyboard: true,
    is_persistent: true
};

export class TelegramNotifier {
    private bot: TelegramBot | null = null;
    private isPolling: boolean = false;

    constructor() {
        if (config.telegram.token) {
            // Create bot WITHOUT polling — we start it explicitly via startPolling()
            const options: any = { 
                polling: false,
                baseApiUrl: config.telegram.baseUrl
            };
            if (config.telegram.proxy) {
                options.request = { proxy: config.telegram.proxy };
            }
            this.bot = new TelegramBot(config.telegram.token, options);

            // Clear the default side-menu, user requested to only use keyboard buttons
            this.bot.setMyCommands([]).catch(err => logger.error('Failed to clear Telegram bot commands', { error: err.message }));

            // Auto-start polling
            this.startPolling().catch(err => logger.error('Failed to auto-start Telegram polling', { error: err.message }));
        }
    }

    /**
     * Safely starts polling by first clearing any stale connections.
     * Fixes the 409 Conflict error when a previous instance didn't shut down cleanly.
     */
    async startPolling(): Promise<void> {
        if (!this.bot || this.isPolling) return;

        try {
            // 1. Delete any webhook (switches Telegram to getUpdates mode)
            await this.bot.deleteWebHook();
            
            // 2. Small delay to let Telegram release the old long-poll connection
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 3. Start polling
            await this.bot.startPolling({ restart: true });
            this.isPolling = true;
            logger.info('Telegram bot polling started successfully.');

            // 4. Handle polling errors (auto-restart on 409 conflict)
            this.bot.on('polling_error', (err: any) => {
                const errMsg = err?.message || '';
                if (errMsg.includes('409 Conflict')) {
                    logger.warn('Telegram 409 Conflict detected — restarting polling in 5s...');
                    this.restartPolling();
                } else {
                    logger.error('Telegram polling error', { error: errMsg });
                }
            });

        } catch (err: any) {
            logger.error('Failed to start Telegram polling', { error: err.message });
        }
    }

    private async restartPolling(): Promise<void> {
        try {
            if (this.bot && this.isPolling) {
                await this.bot.stopPolling();
                this.isPolling = false;
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
            await this.startPolling();
        } catch (err: any) {
            logger.error('Failed to restart Telegram polling', { error: err.message });
        }
    }

    async stop(): Promise<void> {
        if (this.bot && this.isPolling) {
            logger.info('Stopping Telegram bot polling...');
            await this.bot.stopPolling();
            this.isPolling = false;
        }
    }

    async sendSignal(signal: FinalSignal, ctx: StrategyContext): Promise<void> {
        if (!this.bot || !config.telegram.chatId) {
            logger.warn('Telegram token or chat ID not provided. Printing to console instead.');
            return;
        }

        const message = this.formatSignal(signal, ctx);
        try {
            const chartBuffer = await ChartGenerator.generateChart(ctx, signal);
            
            await this.bot.sendPhoto(config.telegram.chatId, chartBuffer, { 
                caption: message,
                parse_mode: 'HTML',
                reply_markup: MAIN_KEYBOARD
            }, {
                filename: 'chart.png',
                contentType: 'image/png'
            });
            logger.info(`Signal sent for ${signal.symbol} via ${signal.strategyName}`);
        } catch (err: any) {
            logger.error('Failed to send Telegram message', { error: err.message });
        }
    }

    async sendTradeResult(symbol: string, direction: string, pnlPercent: number, totalPnlToday: number, history: string[] = []): Promise<void> {
        if (!this.bot || !config.telegram.chatId) return;

        const emoji = pnlPercent > 0 ? '🏆 WON' : '📉 LOSS';
        const sign = pnlPercent > 0 ? '+' : '';
        const totalSign = totalPnlToday > 0 ? '+' : '';
        
        let message = `<b>[PAPER TRADE] ${emoji}</b> | ${symbol} ${direction}\n\n`;
        
        if (history.length > 0) {
            message += `📋 <b>Trade Log:</b>\n${history.map((step, idx) => `  ${idx + 1}. ${step}`).join('\n')}\n\n`;
        }

        message += `💰 <b>Result:</b> ${sign}${pnlPercent.toFixed(2)}%
📊 <b>Total Today:</b> ${totalSign}${totalPnlToday.toFixed(2)}%`;

        try {
            await this.bot.sendMessage(config.telegram.chatId, message, { parse_mode: 'HTML', reply_markup: MAIN_KEYBOARD });
        } catch (err: any) {
            logger.error('Failed to send Telegram message (Trade Result)', { error: err.message });
        }
    }

    async sendTextMessage(message: string): Promise<void> {
        if (!this.bot || !config.telegram.chatId) return;
        try {
            await this.bot.sendMessage(config.telegram.chatId, message, { 
                parse_mode: 'HTML',
                reply_markup: MAIN_KEYBOARD
            });
        } catch (err: any) {
            logger.error('Failed to send Telegram message (Text)', { error: err.message });
        }
    }

    onCommand(command: RegExp, handler: (msg: any, match?: RegExpExecArray | null) => void): void {
        if (!this.bot) return;
        this.bot.onText(command, handler);
        logger.info(`Registered Telegram command for format: ${command.source}`);
    }

    private formatSignal(s: FinalSignal, ctx?: StrategyContext): string {
        const emoji = s.direction === SignalDirection.LONG ? '🟢 LONG' : '🔴 SHORT';
        const timeframe = s.timeframe;
        
        let contextStats = '';
        if (ctx) {
            if (ctx.funding) {
                const frColor = ctx.funding.rate > 0 ? '🔴' : '🟢';
                contextStats += `\n⏱ <b>Funding:</b> ${frColor} ${(ctx.funding.rate * 100).toFixed(4)}%`;
            }
            if (ctx.openInterest && ctx.openInterest.oiHistory.length > 0) {
                const oiChange = ((ctx.openInterest.oi - ctx.openInterest.oiHistory[0]) / ctx.openInterest.oiHistory[0]) * 100;
                const oiDir = oiChange > 0 ? '↗️' : '↘️';
                contextStats += `\n🧲 <b>OI Change:</b> ${oiDir} ${oiChange.toFixed(2)}%`;
            }
            if (ctx.btcContext) {
                const btcEmoji = ctx.btcContext.trend === 'BULLISH' ? '🟢' : '🔴';
                contextStats += `\n🌍 <b>BTC 1H Trend:</b> ${btcEmoji} ${ctx.btcContext.trend} (${ctx.btcContext.price.toFixed(0)})`;
            }
        }

        return `${emoji} | <b>${s.symbol}</b> | ${timeframe}

📊 <b>Strategy:</b> ${s.strategyName}
⭐ <b>Score:</b> ${s.score}/100 (${s.confidenceLabel})
📈 <b>Regime:</b> ${s.regime.type} (${s.regime.description})${contextStats}

📍 <b>${s.orderType || 'MARKET'} Entry:</b> <code>${s.levels.entry.toFixed(4)}</code>
🛑 <b>Stop Loss:</b> <code>${s.levels.sl.toFixed(4)}</code> (-${(s.levels.riskPercent * s.leverageSuggestion).toFixed(1)}%)
✅ <b>TP1:</b> <code>${s.levels.tp[0].toFixed(4)}</code> (Safe) (+${((Math.abs(s.levels.tp[0] - s.levels.entry) / s.levels.entry) * 100 * s.leverageSuggestion).toFixed(1)}%)
✅ <b>TP2:</b> <code>${s.levels.tp[1].toFixed(4)}</code> (Target) (+${((Math.abs(s.levels.tp[1] - s.levels.entry) / s.levels.entry) * 100 * s.leverageSuggestion).toFixed(1)}%)
✅ <b>TP3:</b> <code>${s.levels.tp[2].toFixed(4)}</code> (Ext) (+${((Math.abs(s.levels.tp[2] - s.levels.entry) / s.levels.entry) * 100 * s.leverageSuggestion).toFixed(1)}%)
✅ <b>TP4:</b> <code>${s.levels.tp[3].toFixed(4)}</code> (Ext+) (+${((Math.abs(s.levels.tp[3] - s.levels.entry) / s.levels.entry) * 100 * s.leverageSuggestion).toFixed(1)}%)

📐 <b>Leverage:</b> x${s.leverageSuggestion}
💰 <b>Risk/Reward:</b> 1:${s.levels.rrRatio}

📋 <b>Reasons:</b>
${s.reasons.map(r => `• ${r}`).join('\n')}

⏰ <i>${new Date(s.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Europe/Moscow' })} | Valid for: ${s.expireMinutes}m</i>`;
    }
}

export const telegramNotifier = new TelegramNotifier();
