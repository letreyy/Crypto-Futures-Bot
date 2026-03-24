import { logger } from '../core/utils/logger.js';
import { scanWorker } from '../worker/scan-worker.js';
import { tradeExecutor } from '../trading/trade-executor.js';
async function bootstrap() {
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    logger.info('Starting Binance Signals Bot MVP...');
    try {
        await tradeExecutor.init();
        await scanWorker.start();
    }
    catch (err) {
        logger.error('Fatal crash on startup', { error: err.message });
        process.exit(1);
    }
}
function shutdown() {
    logger.info('Shutting down...');
    scanWorker.stop();
    setTimeout(() => {
        logger.info('Exiting process.');
        process.exit(0);
    }, 1000);
}
bootstrap();
//# sourceMappingURL=main.js.map