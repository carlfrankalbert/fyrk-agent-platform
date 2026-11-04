import { callClaudeStream } from '../lib/claude.js';
import type { ClaudeMessage, ClaudeResponse, ClaudeSystemBlock } from '../lib/claude.js';
import { getThreadHistory, replyInThread, updateMessage } from '../lib/slack.js';
import type { ThreadMessage } from '../lib/slack.js';
import type { Logger } from '../lib/types.js';
import { stripMention } from './events.js';
import { createSlackStreamUpdater } from './stream.js';
import type { BotModule, SlackBotEvent } from './types.js';

export const PLACEHOLDER_MSG = '...';
export const ERROR_MSG = 'Beklager, noe gikk galt. Prøv igjen om litt.';
export const MAX_TOKENS = 2048;
/** Most recent thread messages to include as history */
export const MAX_HISTORY_MESSAGES = 20;

export interface HandleEventDeps {
  botToken: string;
  apiKey: string | undefined;
  selectModule: (event: SlackBotEvent) => BotModule;
  logger: Logger;
}

/** System prompt as blocks: instructions first, then the module's context with cache_control ephemeral. */
export function buildSystemBlocks(prompt: { instructions: string; context?: string }): ClaudeSystemBlock[] {
  const blocks: ClaudeSystemBlock[] = [{ type: 'text', text: prompt.instructions }];
  if (prompt.context) {
    blocks.push({ type: 'text', text: prompt.context, cache_control: { type: 'ephemeral' } });
  }
  return blocks;
}

/**
 * Turn Slack thread history + the current question into Claude messages.
 * Our own replies become assistant turns; placeholders, error messages and other bots are skipped.
 * Consecutive same-role turns are merged and the conversation always starts with a user turn.
 */
export function buildMessages(
  history: ThreadMessage[],
  current: Pick<SlackBotEvent, 'text' | 'ts' | 'botUserId'>,
): ClaudeMessage[] {
  const turns: ClaudeMessage[] = [];
  const relevant = history
    .filter((m) => m.ts !== current.ts && m.text && m.text !== PLACEHOLDER_MSG && m.text !== ERROR_MSG)
    .slice(-MAX_HISTORY_MESSAGES);

  for (const msg of relevant) {
    const isOwn = !!msg.bot_id && (!current.botUserId || msg.user === current.botUserId);
    if (msg.bot_id && !isOwn) continue;
    const text = isOwn ? msg.text!.trim() : stripMention(msg.text!, current.botUserId);
    if (!text) continue;
    pushTurn(turns, isOwn ? 'assistant' : 'user', text);
  }
  pushTurn(turns, 'user', current.text);

  while (turns.length > 0 && turns[0].role !== 'user') turns.shift();
  return turns;
}

function pushTurn(turns: ClaudeMessage[], role: ClaudeMessage['role'], text: string): void {
  const last = turns[turns.length - 1];
  if (last && last.role === role) {
    last.content = `${last.content}\n\n${text}`;
  } else {
    turns.push({ role, content: text });
  }
}

// Per-thread concurrency guard: answers in the same thread are produced one at a time, in order
const threadLocks = new Map<string, Promise<void>>();

export function handleBotEvent(event: SlackBotEvent, deps: HandleEventDeps): Promise<void> {
  const key = `${event.channel}:${event.threadTs ?? event.ts}`;
  const prev = threadLocks.get(key) ?? Promise.resolve();
  const next = prev.then(() => answer(event, deps)).finally(() => {
    if (threadLocks.get(key) === next) threadLocks.delete(key);
  });
  threadLocks.set(key, next);
  return next;
}

async function answer(event: SlackBotEvent, deps: HandleEventDeps): Promise<void> {
  const { botToken, apiKey, logger } = deps;
  const threadTs = event.threadTs ?? event.ts;
  let replyTs: string | undefined;
  let moduleId: string | undefined;

  try {
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
    const module = deps.selectModule(event);
    moduleId = module.id;

    const [prompt, history] = await Promise.all([
      module.buildSystemPrompt(),
      event.threadTs
        ? getThreadHistory(botToken, event.channel, event.threadTs).catch((err: unknown) => {
            logger.warn({ err, module: moduleId }, 'Failed to load thread history, answering without it');
            return [] as ThreadMessage[];
          })
        : Promise.resolve([] as ThreadMessage[]),
    ]);

    const placeholder = await replyInThread(botToken, event.channel, threadTs, PLACEHOLDER_MSG);
    replyTs = placeholder.ts;
    if (!replyTs) throw new Error('Slack did not return ts for placeholder message');

    const updater = createSlackStreamUpdater(botToken, event.channel, replyTs, logger);
    let accumulated = '';
    let response: ClaudeResponse | undefined;

    for await (const ev of callClaudeStream(apiKey, {
      model: module.model,
      max_tokens: MAX_TOKENS,
      system: buildSystemBlocks(prompt),
      messages: buildMessages(history, event),
    })) {
      if (ev.type === 'content_delta') {
        accumulated += ev.text;
        updater.update(accumulated);
      } else if (ev.type === 'message_complete') {
        response = ev.response;
      } else {
        throw new Error(ev.error);
      }
    }

    if (!response) throw new Error('No message_complete event received from Claude stream');
    const finalText = accumulated.trim();
    if (!finalText) throw new Error(`Empty answer from Claude (stop_reason ${response.stop_reason})`);

    await updater.flush(finalText);

    const cacheRead = response.usage.cache_read_input_tokens ?? 0;
    logger.info({
      module: module.id,
      model: module.model,
      channel: event.channel,
      threadTs,
      followUp: !!event.threadTs,
      stop_reason: response.stop_reason,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
      cache_hit: cacheRead > 0,
    }, 'Slack bot answered');
  } catch (err) {
    logger.error({ err, module: moduleId, channel: event.channel, threadTs }, 'Slack bot failed to answer');
    try {
      if (replyTs) {
        await updateMessage(botToken, event.channel, replyTs, ERROR_MSG);
      } else {
        await replyInThread(botToken, event.channel, threadTs, ERROR_MSG);
      }
    } catch (postErr) {
      logger.error({ err: postErr }, 'Slack bot failed to post error message');
    }
  }
}
