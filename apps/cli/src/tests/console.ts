import { vi } from 'vitest';

export type MockedConsole = {
  output: string[];
  err: string[];
  mockRestore: () => void;
};

export const createMockedConsole = (): MockedConsole => {
  const output: string[] = [];
  const err: string[] = [];

  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    output.push(args.join(' '));
  });
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    err.push(args.join(' '));
  });

  return {
    output,
    err,
    mockRestore() {
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    },
  };
};
