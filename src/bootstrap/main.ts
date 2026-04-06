import { logger } from '../core/utils/logger.js';
import { scanWorker } from '../worker/scan-worker.js';

import { tradeExecutor } from '../trading/trade-executor.js';
import { strategyRegistry } from '../strategies/strategy-registry.js';
import { telegramNotifier } from '../notifications/telegram/telegram-notifier.js';

async function bootstrap() {
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    logger.info('Starting Binance Signals Bot MVP...');
    
    try {
        await tradeExecutor.init(strategyRegistry);
        await scanWorker.start();
        
        telegramNotifier.sendTextMessage('🚀 <b>Trading Bot Online!</b>\nService has been successfully started and is now scanning the markets.');
    } catch (err: any) {
        logger.error('Fatal crash on startup', { error: err.message });
        process.exit(1);
    }
}

async function shutdown() {
    logger.info('Shutting down...');
    scanWorker.stop();
    await telegramNotifier.stop();
    
    logger.info('Exiting process.');
    process.exit(0);
}

bootstrap();
