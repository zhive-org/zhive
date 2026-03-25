import type { Kline } from 'pinets';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockedConsole, MockedConsole } from '../../../tests/console.js';
import { createTaExecuteCommand } from './execute.js';

const mockGetOHLC = vi.fn();

vi.mock('../../../shared/config/hive-client.js', () => ({
  getHiveClient: () => ({
    market: { getOHLC: mockGetOHLC },
  }),
}));

vi.mock('../../../shared/ta/data-provider.js', async () => {
  return {
    HiveDataProvider: vi.fn().mockImplementation(() => {
      // Return a provider whose getMarketData returns controlled data
      return {
        getMarketData: vi.fn().mockImplementation(async (): Promise<Kline[]> => {
          return generateKlines(200);
        }),
        getSymbolInfo: vi.fn().mockResolvedValue({ tickerid: 'bitcoin', ticker: 'bitcoin' }),
        configure: vi.fn(),
      };
    }),
  };
});

function generateKlines(count: number): Kline[] {
  const baseTime = new Date('2026-01-01T00:00:00Z').getTime();
  return Array.from({ length: count }, (_, i) => ({
    openTime: baseTime + i * 3_600_000,
    open: 100 + Math.sin(i / 5) * 10,
    high: 110 + Math.sin(i / 5) * 10,
    low: 90 + Math.sin(i / 5) * 10,
    close: 105 + Math.sin(i / 5) * 10,
    volume: 1000,
    closeTime: baseTime + (i + 1) * 3_600_000,
    quoteAssetVolume: 0,
    numberOfTrades: 0,
    takerBuyBaseAssetVolume: 0,
    takerBuyQuoteAssetVolume: 0,
    ignore: 0,
  }));
}

describe('ta execute command', () => {
  let mockedConsole: MockedConsole;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedConsole = createMockedConsole();
  });

  describe('PineTS integration', () => {
    it('runs a real Pine Script against mock data and returns plot data', async () => {
      const rsiScript = `//@version=5
indicator("RSI")
rsiVal = ta.rsi(close, 14)
plot(rsiVal)`;

      const command = createTaExecuteCommand();
      command.exitOverride();
      await command.parseAsync(
        [
          '--script',
          rsiScript,
          '--project',
          'bitcoin',
          '--fetchCandleCount',
          '200',
          '--returnCandleCount',
          '5',
        ],
        {
          from: 'user',
        },
      );

      const { output } = mockedConsole;

      const parsed = JSON.parse(output.join('')) as { [key: string]: any[] };
      const plotKeys = Object.keys(output);
      expect(plotKeys.length).toBeGreaterThanOrEqual(1);
      // Each plot should have exactly 5 values (returnCandleCount)
      for (const values of Object.values(parsed)) {
        expect(values).toHaveLength(5);
        // RSI values should be numbers between 0 and 100
        for (const val of values) {
          if (val !== null) {
            expect(typeof val).toBe('number');
            expect(val).toBeGreaterThanOrEqual(0);
            expect(val).toBeLessThanOrEqual(100);
          }
        }
      }
    });

    it('catches PineTS execution error and logs message', async () => {
      const command = createTaExecuteCommand();
      command.exitOverride();
      await command.parseAsync(
        ['--script', 'this is not valid pine script at all', '--project', 'bitcoin'],
        {
          from: 'user',
        },
      );

      const { err } = mockedConsole;

      expect(err.join('\n')).toContain('Failed to execute pine script');
    });
  });
});
