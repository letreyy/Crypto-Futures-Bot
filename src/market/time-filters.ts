export type MarketSession = 'ASIA' | 'LONDON' | 'NEW_YORK';

export class TimeFilters {
    /**
     * Determines the current major market session based on UTC time.
     * Crypto is 24/7, but algo volume heavily correlates with traditional market hours.
     */
    static getCurrentSession(date: Date = new Date()): MarketSession {
        const utcHour = date.getUTCHours();
        
        // Definitions based on typical SMC Killzones:
        // Asian Session: 00:00 - 06:00 UTC (Tokyo/Sydney)
        // London Session: 07:00 - 15:00 UTC
        // New York Session: 13:00 - 21:00 UTC

        // New York takes priority during overlap (13:00 - 15:00 UTC) because of highest volume
        if (utcHour >= 13 && utcHour < 21) {
            return 'NEW_YORK';
        }
        
        if (utcHour >= 6 && utcHour < 13) {
            return 'LONDON';
        }

        // 21:00 to 06:00 UTC is considered the Asian range (slow, consolidative)
        return 'ASIA';
    }

    /**
     * Checks if a strategy is allowed to run in the current session.
     */
    static isStrategyAllowed(strategyId: string, session: MarketSession): boolean {
        // Asian Session: Only sweep and range strategies allowed. Trend/breakout usually fails here.
        if (session === 'ASIA') {
            const allowedInAsia = [
                'liquidity-sweep', 
                'range-bounce', 
                'order-blocks' // OBs can trigger overnight
            ];
            return allowedInAsia.includes(strategyId);
        }

        // London & New York: All strategies allowed
        return true;
    }
}
