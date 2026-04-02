export enum Timeframe {
  '1m' = '1m',
  '3m' = '3m',
  '5m' = '5m',
  '15m' = '15m',
  '30m' = '30m',
  '1h' = '1h',
  '2h' = '2h',
  '4h' = '4h',
  '8h' = '8h',
  '12h' = '12h',
  '1d' = '1d',
  '3d' = '3d',
  '1w' = '1w',
  '1M' = '1M',
}

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StrategyConfig {
  name: string;
  description: string;
}

export interface AssetContext {
  coin: string;
  markPx: string;
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  midPx: string | null;
}

export interface PositionInfo {
  coin: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  pnl: number;
  leverage: number;
  liquidationPx: number | null;
}

export interface SpotBalance {
  coin: string;
  token: number;
  total: string;
  hold: string;
  entryNtl: string;
}

export interface AccountSummary {
  spotBalances: SpotBalance[];
  accountValue: number;
  marginUsed: number;
  withdrawable: number;
  positions: PositionInfo[];
}

export interface TradeDecision {
  coin: string;
  action: 'OPEN_LONG' | 'OPEN_SHORT' | 'CLOSE' | 'HOLD';
  sizeUsd: number;
  leverage: number;
  reasoning: string;
}

export interface AssetInfo {
  name: string;
  assetId: number;
  szDecimals: number;
  maxLeverage: number;
}

export interface ExecutionResult {
  coin: string;
  action: string;
  success: boolean;
  details: string;
}
