import { FinalSignal, StrategyContext } from '../../core/types/bot-types.js';
export declare class TelegramNotifier {
    private bot;
    constructor();
    sendSignal(signal: FinalSignal, ctx: StrategyContext): Promise<void>;
    sendTradeResult(symbol: string, direction: string, pnlPercent: number, totalPnlToday: number): Promise<void>;
    sendTextMessage(message: string): Promise<void>;
    onCommand(command: RegExp, handler: (msg: any) => void): void;
    private formatSignal;
}
export declare const telegramNotifier: TelegramNotifier;
