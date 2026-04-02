import * as ai from 'ai';
import { z } from 'zod';
import { PineTS } from 'pinets';
import { TradeDecision, AccountSummary, Timeframe, AssetContext } from './types.js';
import { wrapAISDK } from 'langsmith/experimental/vercel';
import { MarketService } from './market.js';
import { AgentRuntime } from '../agent/runtime.js';
import { formatPineResult, PineResult } from '../ta/utils.js';
import { formatToolError } from '../agent/utils.js';

const { Output, tool, ToolLoopAgent } = wrapAISDK(ai);

const TradeDecisionSchema = z.object({
  coin: z.string(),
  action: z.enum(['OPEN_LONG', 'OPEN_SHORT', 'CLOSE', 'HOLD']),
  sizeUsd: z.number(),
  leverage: z.number(),
  reasoning: z.string(),
});

const TradeDecisionArraySchema = z.object({
  decisions: z.array(TradeDecisionSchema),
});

export class AssetEvaluator {
  constructor(
    private marketService: MarketService,
    private runtime: AgentRuntime,
  ) {}

  async evaluate(coins: string[], account: AccountSummary): Promise<TradeDecision[]> {
    // Gather asset contexts, filtering out coins with no data
    const assetEntries: Array<{
      coin: string;
      ctx: AssetContext;
      position?: AccountSummary['positions'][number];
    }> = [];

    for (const coin of coins) {
      const ctx = await this.marketService.getAssetContext(coin);
      if (!ctx) {
        continue;
      }
      assetEntries.push({
        coin,
        ctx,
        position: account.positions.find((p) => p.coin === coin),
      });
    }

    // If no coins have asset context, return HOLD for all
    if (assetEntries.length === 0) {
      return coins.map((c) => holdDecision(c, 'No asset context available'));
    }

    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(assetEntries, account);

    try {
      const agent = new ToolLoopAgent({
        model: this.runtime.model,
        instructions: systemPrompt,
        tools: {
          runIndicator: this.createRunIndicatorTool(),
        },
        output: Output.object({ schema: TradeDecisionArraySchema }),
      });
      const { output } = await agent.generate({ prompt: userPrompt });

      // Build a map of returned decisions
      const decisionMap = new Map<string, TradeDecision>();
      for (const d of output.decisions) {
        decisionMap.set(d.coin, d);
      }

      // Return decisions for all requested coins, defaulting to HOLD if missing
      return coins.map(
        (coin) =>
          decisionMap.get(coin) ??
          holdDecision(coin, 'No decision returned by LLM — defaulting to HOLD'),
      );
    } catch (err) {
      return coins.map((c) => holdDecision(c, 'Analysis failed — defaulting to HOLD'));
    }
  }

  private createRunIndicatorTool() {
    const marketData = this.marketService;

    return tool({
      description:
        'Execute a TradingView Pine Script v5/v6 against OHLC market data for an asset and return indicator values',
      inputSchema: z.object({
        asset: z.string().describe('The asset symbol to analyze, e.g. BTC, ETH'),
        script: z.string().describe('Inline Pine Script v5 source code'),
        timeframe: z.enum(Timeframe).describe('Candle interval'),
        fetchCandleCount: z
          .number()
          .int()
          .min(1)
          .max(1500)
          .default(100)
          .describe(
            'Number of historical candles to fetch. Indicators need lookback data, so set this higher than the indicator period (e.g. 200 for RSI 50). Default: 100',
          ),
        returnBars: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe('Number of most-recent bars to return (default: 20)'),
      }),
      execute: async ({ asset, script, timeframe, fetchCandleCount, returnBars }) => {
        const endTime = Date.now();
        const startTime = endTime - fetchCandleCount * this.timeframeToMs(timeframe);
        const candles = await marketData.fetchCandles(asset, timeframe, startTime, endTime);
        if (candles.length === 0) {
          return {
            error: 'No candle data available for the requested range',
          };
        }

        const klines = candles.map((c) => ({
          openTime: c.openTime,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          closeTime: c.openTime,
        }));

        const pineTS = new PineTS(klines);
        try {
          const result = (await pineTS.run(script)) as PineResult;
          return formatPineResult(result, returnBars);
        } catch (e) {
          return formatToolError(e, 'Executing pine script');
        }
      },
    });
  }

  private timeframeToMs(tf: Timeframe): number {
    const match = tf.match(/^(\d+)(m|h|d|w|M)$/);
    if (!match) throw new Error(`Invalid timeframe: ${tf}`);

    const [, value, unit] = match;
    const n = parseInt(value, 10);

    switch (unit) {
      case 'm':
        return n * 60_000;
      case 'h':
        return n * 3_600_000;
      case 'd':
        return n * 86_400_000;
      case 'w':
        return n * 7 * 86_400_000;
      case 'M':
        return n * 30 * 86_400_000; // approximate
      default:
        throw new Error(`Unknown unit: ${unit}`);
    }
  }

  private buildSystemPrompt(): string {
    return `You are a portfolio analyst for Hyperliquid perpetual markets.

You will be given:
    - assets: current asset that are in user's watch list
    - positions: current user position

You task is to perform analysis on current user position and asset in user's watch list then provide a trading decision for EACH asset: OPEN_LONG, OPEN_SHORT, CLOSE, or HOLD.

Trading Strategy:
${this.runtime.config.strategyContent}

Consider cross-asset correlations and portfolio-level risk when making decisions.
Be conservative: prefer HOLD when signals are ambiguous.`;
  }

  private buildUserPrompt(
    assetEntries: Array<{
      coin: string;
      ctx: AssetContext;
      position?: {
        side: string;
        size: number;
        entryPrice: number;
        pnl: number;
        leverage: number;
      };
    }>,
    account: AccountSummary,
  ): string {
    const lines: string[] = [];

    lines.push(
      `Analyze the following ${assetEntries.length} assets and provide a trading decision for each.`,
    );
    lines.push('');

    lines.push(
      `Account: value=$${account.accountValue.toFixed(2)}, marginUsed=$${account.marginUsed.toFixed(2)}`,
    );
    const availableUsdc = account.spotBalances.find((b) => b.coin === 'USDC')?.total ?? '0';
    lines.push(`Available Trading Balance: value=${availableUsdc}`);
    lines.push('');

    for (const { coin, ctx, position } of assetEntries) {
      lines.push(`--- ${coin} ---`);
      lines.push(`  Mark price: $${ctx.markPx}`);
      lines.push(`  Mid price: ${ctx.midPx ? `$${ctx.midPx}` : 'N/A'}`);
      lines.push(`  Funding rate: ${ctx.funding}`);
      lines.push(`  Open interest: $${ctx.openInterest.toLocaleString()}`);
      lines.push(`  Prev day price: $${ctx.prevDayPx}`);
      lines.push(`  24h volume: $${ctx.dayNtlVlm.toLocaleString()}`);

      if (position) {
        lines.push(
          `  Position: ${position.side} size=${position.size} entry=$${position.entryPrice} pnl=$${position.pnl.toFixed(2)} lev=${position.leverage}x`,
        );
      } else {
        lines.push('  No current position.');
      }
      lines.push('');
    }

    lines.push(`Current Time: ${new Date().toDateString()}`);

    return lines.join('\n');
  }
}

function holdDecision(coin: string, reasoning: string): TradeDecision {
  return { coin, action: 'HOLD', sizeUsd: 0, leverage: 1, reasoning };
}
