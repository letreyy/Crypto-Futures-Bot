import { binanceClient } from '../../exchange/binance/binance-client.js';
import { config } from '../../config/index.js';
import { logger } from '../../core/utils/logger.js';
export class UniverseLoader {
    lastUpdate = 0;
    cachedSymbols = [];
    async getTopSymbols() {
        const now = Date.now();
        const updateInterval = config.bot.universeRefreshMinutes * 60 * 1000;
        if (this.cachedSymbols.length > 0 && (now - this.lastUpdate < updateInterval)) {
            return this.cachedSymbols;
        }
        try {
            logger.info('Refreshing universe (Top-N symbols by 24h volume)...');
            const ticker = await binanceClient.get24hTicker();
            const perpetuals = ticker
                .filter(t => t.symbol.endsWith('USDT'))
                .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
                .slice(0, config.bot.topN)
                .map(t => t.symbol);
            this.cachedSymbols = perpetuals;
            this.lastUpdate = now;
            logger.info(`Universe updated. Top ${perpetuals.length} symbols loaded.`);
            return perpetuals;
        }
        catch (err) {
            logger.error('Failed to refresh universe', { error: err.message });
            return this.cachedSymbols || [];
        }
    }
}
export const universeLoader = new UniverseLoader();
//# sourceMappingURL=universe-loader.js.map