export enum MarketRegimeType {
  TREND = 'TREND',
  RANGE = 'RANGE',
  VOLATILITY_EXPANSION = 'VOLATILITY_EXPANSION',
  PANIC = 'PANIC',
  REVERSAL_STOP_HUNT = 'REVERSAL_STOP_HUNT',
  UNKNOWN = 'UNKNOWN'
}

export enum SignalDirection {
  LONG = 'LONG',
  SHORT = 'SHORT',
  NEUTRAL = 'NEUTRAL'
}

export enum Timeframe {
  TF_1M = '1m',
  TF_5M = '5m',
  TF_15M = '15m'
}

export enum ConfidenceLabel {
  A_PLUS = 'A+',
  A = 'A',
  B = 'B',
  C = 'C',
  IGNORE = 'IGNORE'
}
