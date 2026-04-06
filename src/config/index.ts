import dotenv from 'dotenv';
dotenv.config();

export const config = {
  mexc: {
    apiKey: process.env.MEXC_API_KEY || '',
    apiSecret: process.env.MEXC_API_SECRET || '',
    isLiveMode: process.env.IS_LIVE_MODE === 'true'
  },
  binance: {
    apiKey: process.env.BINANCE_API_KEY || '',
    apiSecret: process.env.BINANCE_API_SECRET || '',
    isLiveMode: process.env.IS_LIVE_MODE === 'true',
    baseUrl: process.env.BINANCE_BASE_URL || 'https://fapi.binance.com'
  },
  exchangeId: (process.env.EXCHANGE_ID || 'mexc') as 'binance' | 'mexc',
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    baseUrl: process.env.TELEGRAM_BASE_URL || 'https://api.telegram.org',
    proxy: process.env.TELEGRAM_PROXY || ''
  },
  bot: {
    logLevel: process.env.LOG_LEVEL || 'info',
    scanIntervalSeconds: parseInt(process.env.SCAN_INTERVAL_SECONDS || '30'),
    universeRefreshMinutes: parseInt(process.env.UNIVERSE_REFRESH_MINUTES || '60'),
    topN: parseInt(process.env.TOP_N_SYMBOLS || '50'),
    minSignalScore: parseInt(process.env.MIN_SIGNAL_SCORE || '80'),
    minProfitLeveraged: parseFloat(process.env.MIN_PROFIT_LEVERAGED || '1.5'), // minimum R:R ratio
    minTpDistancePct: parseFloat(process.env.MIN_TP_DISTANCE_PCT || '0.5'),
    targetRiskPercent: parseFloat(process.env.TARGET_RISK_PERCENT || '1.0'),
    maxConcurrentTrades: parseInt(process.env.MAX_CONCURRENT_TRADES || '10'),
    klinesLimit: 600
  },
  indicators: {
    emaFast: 20,
    emaMid: 50,
    emaSlow: 200,
    rsi: 14,
    atr: 14,
    adx: 14,
    bbLength: 20,
    bbMult: 2,
    volSma: 20,
    vwapStdLen: 100
  },
  cooldown: {
    minutes: parseInt(process.env.COOLDOWN_MINUTES || '15'),
    maxPerDayPerSymbol: parseInt(process.env.MAX_ALERTS_PER_SYMBOL_PER_DAY || '6'),
    maxPerDayGlobal: parseInt(process.env.MAX_ALERTS_GLOBAL_PER_DAY || '300')
  },
  weights: {
    trendAlignment: 15,
    volumeSpike: 15,
    atrExpansion: 10,
    candleQuality: 10,
    liquidityContext: 20,
    regimeAlignment: 15,
    riskReward: 15
  }
};
