import type { ExchangeClient, InfoClient } from '@nktkas/hyperliquid';
import type { TradeDecision, ExecutionResult, AssetInfo, AccountSummary } from './types.js';

const SLIPPAGE = 0.03;

export class TradeExecutor {
  constructor(
    private exchange: ExchangeClient,
    private info: InfoClient,
    private assetMap: Map<string, AssetInfo>,
  ) {}

  async execute(decision: TradeDecision, account: AccountSummary): Promise<ExecutionResult> {
    try {
      const result = await this.executeSingle(decision, account);
      return result;
    } catch (err) {
      const result: ExecutionResult = {
        coin: decision.coin,
        action: decision.action,
        success: false,
        details: String(err),
      };
      return result;
    }
  }

  private async executeSingle(d: TradeDecision, account: AccountSummary): Promise<ExecutionResult> {
    const asset = this.assetMap.get(d.coin);
    if (!asset) {
      return { coin: d.coin, action: d.action, success: false, details: 'Unknown asset' };
    }

    if (d.action === 'CLOSE') {
      return this.executeClose(d, asset, account);
    }

    return this.executeOpen(d, asset);
  }

  private async executeClose(
    d: TradeDecision,
    asset: AssetInfo,
    account: AccountSummary,
  ): Promise<ExecutionResult> {
    const position = account.positions.find((p) => p.coin === d.coin);
    if (!position) {
      return { coin: d.coin, action: 'CLOSE', success: false, details: 'No position to close' };
    }

    const isBuy = position.side === 'short';
    const slippageMultiplier = isBuy ? 1 + SLIPPAGE : 1 - SLIPPAGE;
    const price = position.entryPrice * slippageMultiplier;
    const sz = roundSize(position.size, asset.szDecimals);

    const response = await this.exchange.order({
      orders: [
        {
          a: asset.assetId,
          b: isBuy,
          p: price.toFixed(6),
          s: sz,
          r: true,
          t: { limit: { tif: 'FrontendMarket' } },
        },
      ],
      grouping: 'na',
    });

    const status = response.response.data.statuses[0];
    if (typeof status === 'object' && status !== null && 'error' in status) {
      return { coin: d.coin, action: 'CLOSE', success: false, details: String(status.error) };
    }

    return {
      coin: d.coin,
      action: 'CLOSE',
      success: true,
      details: `Closed ${position.side} position`,
    };
  }

  private async executeOpen(d: TradeDecision, asset: AssetInfo): Promise<ExecutionResult> {
    const isBuy = d.action === 'OPEN_LONG';

    await this.exchange.updateLeverage({
      asset: asset.assetId,
      isCross: true,
      leverage: d.leverage,
    });

    const book = await this.info.l2Book({ coin: d.coin });
    if (!book) {
      return {
        coin: d.coin,
        action: d.action,
        success: false,
        details: 'Failed to fetch order book',
      };
    }
    const bids = book.levels[0];
    const asks = book.levels[1];
    if (!bids.length || !asks.length) {
      return { coin: d.coin, action: d.action, success: false, details: 'Empty order book' };
    }
    const bestBid = parseFloat(bids[0].px);
    const bestAsk = parseFloat(asks[0].px);
    const midPrice = (bestBid + bestAsk) / 2;

    const rawSize = d.sizeUsd / midPrice;
    const sz = roundSize(rawSize, asset.szDecimals);

    const slippageMultiplier = isBuy ? 1 + SLIPPAGE : 1 - SLIPPAGE;
    const price = midPrice * slippageMultiplier;

    const response = await this.exchange.order({
      orders: [
        {
          a: asset.assetId,
          b: isBuy,
          p: price.toFixed(6),
          s: sz,
          r: false,
          t: { limit: { tif: 'FrontendMarket' } },
        },
      ],
      grouping: 'na',
    });

    const status = response.response.data.statuses[0];
    if (typeof status === 'object' && status !== null && 'error' in status) {
      return { coin: d.coin, action: d.action, success: false, details: String(status.error) };
    }

    return {
      coin: d.coin,
      action: d.action,
      success: true,
      details: `Opened ${isBuy ? 'long' : 'short'} ~$${d.sizeUsd} at ${d.leverage}x`,
    };
  }
}

function roundSize(size: number, szDecimals: number): string {
  const factor = 10 ** szDecimals;
  return (Math.floor(size * factor) / factor).toFixed(szDecimals);
}
