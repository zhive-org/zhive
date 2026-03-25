import { Command } from 'commander';
import { createTaExecuteCommand } from './execute.js';

export const createTACommand = () => {
  return new Command('ta').addCommand(createTaExecuteCommand());
};
