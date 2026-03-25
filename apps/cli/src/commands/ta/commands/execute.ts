import { Command } from 'commander';
import z from 'zod';
import { getHiveClient } from '../../../shared/config/hive-client.js';
import { formatPineResult } from '../../../shared/ta/utils.js';
import { styled } from '../../shared/theme.js';
import { printZodError } from '../../shared/utils.js';
import { HiveDataProvider } from '../../../shared/ta/data-provider.js';

const schema = z.object({
  script: z.string(),
  project: z.string(),
  timeframe: z.enum(['1h', '24h']).default('1h'),
  fetchCandleCount: z.coerce.number().int().min(1).max(1500).default(100),
  returnCandleCount: z.coerce.number().int().min(1).max(100).default(10),
});

export const createTaExecuteCommand = () => {
  return new Command('execute')
    .description(
      'Execute a TradingView Pine Script against OHLC market data for a project and return indicator values',
    )
    .requiredOption('--script <script>', `Inline script source code`)
    .requiredOption('--project <project>', 'Project slug for market data i.e. bitcoin ')
    .option('--timeframe <timeframe>', 'Candle interval: 1h (hourly) or 24h (daily). Default: 1h')
    .option(
      '--fetchCandleCount <count>',
      'Number of historical candles to fetch. Indicators need lookback data, so set this higher than the indicator period (e.g. 200 for RSI 50). Default: 100',
    )
    .option(
      '--returnCandleCount <count>',
      'Number of most-recent candles to include in the response (default: 10)',
    )
    .action(async (options) => {
      const parseResult = schema.safeParse(options);
      if (!parseResult.success) {
        printZodError(parseResult);
        return;
      }

      const input = parseResult.data;

      const { PineTS } = await import('pinets');
      const pineTS = new PineTS(
        new HiveDataProvider(getHiveClient()),
        input.project,
        input.timeframe,
        input.fetchCandleCount,
      );
      try {
        const result = await pineTS.run(input.script);
        console.log(JSON.stringify(formatPineResult(result, input.returnCandleCount)));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid script';
        console.error(styled.red(`Failed to execute pine script: ${message}`));
      }
    });
};
