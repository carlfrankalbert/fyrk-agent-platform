import type { BotModule } from '../types.js';
import { handbookModule } from './handbook/index.js';

// Bot module registry - add new modules here. The core never needs to change for a new module.
const modules: Map<string, BotModule> = new Map();

// Register built-in modules
modules.set(handbookModule.id, handbookModule);

export function getModule(id: string): BotModule | undefined {
  return modules.get(id);
}

export function listModules(): string[] {
  return Array.from(modules.keys());
}
