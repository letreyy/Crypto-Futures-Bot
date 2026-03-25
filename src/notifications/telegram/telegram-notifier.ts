import TelegramBot from 'node-telegram-bot-api';
import { config } from '../../config/index.js';
import { logger } from '../../core/utils/logger.js';
import { FinalSignal, StrategyContext } from '../../core/types/bot-types.js';
import { SignalDirection } from '../../core/constants/enums.js';
import { ChartGenerator } from './chart-generator.js';

// Mute the node-telegram-bot-api deprecation warning
process.env.NTBA_FIX_350 = '1';

export class TelegramNotifier {
    private bot: TelegramBot | null = null;

    constructor() {
        if (config.telegram.token) {
            const options: any = { 
                polling: true,
                baseApiUrl: config.telegram.baseUrl
            };
            if (config.telegram.proxy) {
                options.request = { proxy: config.telegram.proxy };
            }
            this.bot = new TelegramBot(config.telegram.token, options);

            // Clear the default side-menu, user requested to only use keyboard buttons
            this.bot.setMyCommands([]).catch(err => logger.error('Failed to clear Telegram bot commands', { error: err.message }));
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
                parse_mode: 'HTML'
            }, {
                filename: 'chart.png',
                contentType: 'image/png'
            });
            logger.info(`Signal sent for ${signal.symbol} via ${signal.strategyName}`);
        } catch (err: any) {
            logger.error('Failed to send Telegram message', { error: err.message });
        }
    }

    async sendTradeResult(symbol: string, direction: string, pnlPercent: number, totalPnlToday: number): Promise<void> {
        if (!this.bot || !config.telegram.chatId) return;

        const emoji = pnlPercent > 0 ? '🏆 WON' : '💀 LOST';
        const sign = pnlPercent > 0 ? '+' : '';
        const totalSign = totalPnlToday > 0 ? '+' : '';
        const message = `<b>[PAPER TRADE] ${emoji}</b> | ${symbol} ${direction}

💰 <b>Result:</b> ${sign}${pnlPercent.toFixed(2)}%
📊 <b>Total Today:</b> ${totalSign}${totalPnlToday.toFixed(2)}%`;

        try {
            await this.bot.sendMessage(config.telegram.chatId, message, { parse_mode: 'HTML' });
        } catch (err: any) {
            logger.error('Failed to send Telegram message (Trade Result)', { error: err.message });
        }
    }

    async sendTextMessage(message: string): Promise<void> {
        if (!this.bot || !config.telegram.chatId) return;
        try {
            await this.bot.sendMessage(config.telegram.chatId, message, { 
                parse_mode: 'HTML',
                reply_markup: {
                    keyboard: [
                        [{ text: '/stats' }, { text: '/strategies' }],
                        [{ text: '/leverage' }]
                    ],
                    resize_keyboard: true,
                    is_persistent: true
                }
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
        }

        return `${emoji} | <b>${s.symbol}</b> | ${timeframe}

📊 <b>Strategy:</b> ${s.strategyName}
⭐ <b>Score:</b> ${s.score}/100 (${s.confidenceLabel})
📈 <b>Regime:</b> ${s.regime.type} (${s.regime.description})${contextStats}

📍 <b>Entry:</b> <code>${s.levels.entry.toFixed(4)}</code>
🛑 <b>Stop Loss:</b> <code>${s.levels.sl.toFixed(4)}</code> (-${s.levels.riskPercent.toFixed(2)}%)
✅ <b>TP1:</b> <code>${s.levels.tp[0].toFixed(4)}</code> (+${(s.levels.riskPercent * 1.0).toFixed(2)}%)
✅ <b>TP2:</b> <code>${s.levels.tp[1].toFixed(4)}</code> (+${(s.levels.riskPercent * 1.5).toFixed(2)}%)
✅ <b>TP3:</b> <code>${s.levels.tp[2].toFixed(4)}</code> (+${(s.levels.riskPercent * 2.0).toFixed(2)}%)
✅ <b>TP4:</b> <code>${s.levels.tp[3].toFixed(4)}</code> (+${(s.levels.riskPercent * 3.0).toFixed(2)}%)

📐 <b>Leverage:</b> x${s.leverageSuggestion}
💰 <b>Risk/Reward:</b> 1:${s.levels.rrRatio}

📋 <b>Reasons:</b>
${s.reasons.map(r => `• ${r}`).join('\n')}

⏰ <i>${new Date(s.timestamp).toLocaleTimeString()} | Valid for: ${s.expireMinutes}m</i>`;
    }
}

export const telegramNotifier = new TelegramNotifier();
