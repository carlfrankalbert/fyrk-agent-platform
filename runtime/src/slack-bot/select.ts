import { getEnv } from '../lib/env.js';
import { getModule } from './modules/registry.js';
import type { BotModule, SlackBotEvent } from './types.js';

export interface ModuleSelectionConfig {
  defaultModule: string;
  channelModules?: Record<string, string>;
}

export function selectionConfigFromEnv(): ModuleSelectionConfig {
  const env = getEnv();
  return { defaultModule: env.SLACK_BOT_DEFAULT_MODULE, channelModules: env.SLACK_BOT_CHANNEL_MODULES };
}

/**
 * Pick the module that answers an event. v1: per-channel override from SLACK_BOT_CHANNEL_MODULES,
 * otherwise SLACK_BOT_DEFAULT_MODULE. Throws if the configured module id is not registered.
 */
export function selectModule(
  event: Pick<SlackBotEvent, 'channel'>,
  config: ModuleSelectionConfig = selectionConfigFromEnv(),
): BotModule {
  const id = config.channelModules?.[event.channel] ?? config.defaultModule;
  const module = getModule(id);
  if (!module) throw new Error(`Slack bot module "${id}" is not registered`);
  return module;
}
