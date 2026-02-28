import { getEnv } from '../../lib/env.js';
import { callClaudeStream, extractText } from '../../lib/claude.js';
import type { ClaudeMessage, ClaudeResponse } from '../../lib/claude.js';
import { replyInThread, updateMessage, getThreadHistory, addReaction, removeReaction } from '../../lib/slack.js';
import { getSupabase } from '../../lib/supabase.js';
import { loadDbContextCached } from './db.js';
import { executeActions } from './actions.js';
import { buildSystemPrompt, parseClaudeResponse, cleanMessageOrder } from './prompt.js';
import { extractLearnings } from './learnings/index.js';
import type { Logger } from '../../lib/types.js';

export const HUSMOR_MODEL = 'claude-sonnet-4-5-20250929';
export const THINKING_MSG = 'Husmor tenker...';
export const THINKING_EMOJI = 'thought_balloon';
export const ERROR_MSG = 'Beklager, noe gikk galt. Prov igjen om litt!';

export interface HusmorMessageParams {
  text: string;
  channel: string;
  threadTs: string;
  messageTs: string;
  userId: string;
  isThreadReply: boolean;
  logger: Logger;
}

// Per-thread concurrency guard: queue messages for the same thread
const threadLocks = new Map<string, Promise<void>>();

export async function handleHusmorMessage(params: HusmorMessageParams): Promise<void> {
  const lock = threadLocks.get(params.threadTs) ?? Promise.resolve();
  const next = lock.then(() => handleHusmorMessageInner(params)).finally(() => {
    if (threadLocks.get(params.threadTs) === next) threadLocks.delete(params.threadTs);
  });
  threadLocks.set(params.threadTs, next);
  return next;
}

// --- Streaming helpers ---

/**
 * Extract partial reply text from streaming JSON accumulator.
 * Scans for `"reply":"` marker and accumulates text handling `\"` and `\\n` escapes.
 * Returns null if marker not found yet.
 */
export function extractPartialReply(accumulated: string): string | null {
  const marker = '"reply":"';
  const idx = accumulated.indexOf(marker);
  if (idx === -1) return null;

  let result = '';
  let i = idx + marker.length;
  while (i < accumulated.length) {
    const ch = accumulated[i];
    if (ch === '\\' && i + 1 < accumulated.length) {
      const next = accumulated[i + 1];
      if (next === '"') { result += '"'; i += 2; continue; }
      if (next === 'n') { result += '\n'; i += 2; continue; }
      if (next === '\\') { result += '\\'; i += 2; continue; }
      if (next === '/') { result += '/'; i += 2; continue; }
      // Other escapes — just pass through
      result += ch + next;
      i += 2;
      continue;
    }
    if (ch === '"') break; // End of reply value
    result += ch;
    i++;
  }
  return result;
}

/**
 * Create a debounced Slack message updater for streaming.
 * - `update(text)` schedules updateMessage with 500ms min interval and 80 char min delta
 * - `flush(text)` sends final updateMessage, cancels pending timer
 */
export function createSlackStreamUpdater(
  token: string,
  channel: string,
  messageTs: string,
  logger: Logger,
) {
  let lastSentText = '';
  let lastSentAt = 0;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingText = '';
  const MIN_INTERVAL_MS = 500;
  const MIN_CHAR_DELTA = 80;

  function doUpdate(text: string) {
    const displayText = text + ' ...';
    lastSentText = text;
    lastSentAt = Date.now();
    updateMessage(token, channel, messageTs, displayText)
      .catch(err => logger.warn({ err }, 'Stream update failed'));
  }

  return {
    update(text: string) {
      pendingText = text;
      const charDelta = text.length - lastSentText.length;
      const timeSinceLast = Date.now() - lastSentAt;

      if (charDelta >= MIN_CHAR_DELTA && timeSinceLast >= MIN_INTERVAL_MS) {
        if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
        doUpdate(text);
      } else if (!pendingTimer) {
        const delay = Math.max(0, MIN_INTERVAL_MS - timeSinceLast);
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          if (pendingText.length - lastSentText.length >= MIN_CHAR_DELTA) {
            doUpdate(pendingText);
          }
        }, delay);
      }
    },
    async flush(text: string) {
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      try {
        await updateMessage(token, channel, messageTs, text);
      } catch (err) {
        logger.warn({ err }, 'Stream flush failed');
      }
    },
  };
}

async function handleHusmorMessageInner(params: HusmorMessageParams): Promise<void> {
  const { text, channel, threadTs, messageTs, userId, isThreadReply, logger } = params;
  logger.info({ userId, channel, threadTs, textLen: text.length }, 'handleHusmorMessage started');
  const env = getEnv();

  const botToken = env.SLACK_HUSMOR_BOT_TOKEN;
  const apiKey = env.ANTHROPIC_API_KEY;

  if (!botToken || !apiKey) {
    logger.error({ hasBotToken: !!botToken, hasApiKey: !!apiKey }, 'Missing SLACK_HUSMOR_BOT_TOKEN or ANTHROPIC_API_KEY');
    return;
  }

  const supabase = getSupabase();

  // Add thinking reaction to the user's message
  try {
    await addReaction(botToken, channel, messageTs, THINKING_EMOJI);
  } catch (err) {
    logger.warn({ err }, 'Failed to add thinking reaction');
  }

  let replyTs: string | undefined;

  try {
    // 1. Load DB context + thread history in parallel
    const [dbContext, threadMessages] = await Promise.all([
      loadDbContextCached(supabase),
      isThreadReply
        ? getThreadHistory(botToken, channel, threadTs).catch(() => [])
        : Promise.resolve([]),
    ]);

    // 2. Build system prompt
    const systemPrompt = buildSystemPrompt(dbContext);

    // 3. Build conversation messages from thread history
    const messages = buildMessages(threadMessages, text);

    // 4. Send placeholder and remove thinking reaction
    const placeholderResult = await replyInThread(botToken, channel, threadTs, '...');
    replyTs = placeholderResult.ts;

    // Remove thinking reaction immediately (fire-and-forget)
    removeReaction(botToken, channel, messageTs, THINKING_EMOJI)
      .catch(err => logger.warn({ err }, 'Failed to remove thinking reaction'));

    // 5. Stream Claude response
    const updater = createSlackStreamUpdater(botToken, channel, replyTs!, logger);
    let accumulated = '';
    let response: ClaudeResponse | undefined;

    for await (const event of callClaudeStream(apiKey, {
      model: HUSMOR_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      cache_control: { type: 'ephemeral' },
    })) {
      if (event.type === 'content_delta') {
        accumulated += event.text;
        const partial = extractPartialReply(accumulated);
        if (partial) {
          updater.update(partial);
        }
      } else if (event.type === 'message_complete') {
        response = event.response;
      } else if (event.type === 'error') {
        throw new Error(event.error);
      }
    }

    if (!response) {
      throw new Error('No message_complete event received from Claude stream');
    }

    logger.info({
      input_tokens: response.usage.input_tokens,
      cache_read: response.usage.cache_read_input_tokens ?? 0,
      cache_write: response.usage.cache_creation_input_tokens ?? 0,
      output_tokens: response.usage.output_tokens,
    }, 'Claude API usage');

    // 6. Parse and send final message
    const parsed = parseClaudeResponse(extractText(response));
    await updater.flush(parsed.reply);

    // 7. Execute actions
    if (parsed.actions && parsed.actions.length > 0) {
      await executeActions(supabase, parsed.actions, logger, botToken, { channel, threadTs });
    }

    // 8. Fire-and-forget: extract learnings from conversation
    extractLearnings(supabase, apiKey, threadTs, messages, dbContext.learnings, logger)
      .catch(err => logger.error({ err }, 'Learning extraction failed (non-fatal)'));

    logger.info({ userId, actionsCount: parsed.actions?.length ?? 0 }, 'Husmor message handled');
  } catch (err) {
    logger.error({ err, userId }, 'Failed to handle Husmor message');
    if (replyTs) {
      // Update the placeholder with error message
      updateMessage(botToken, channel, replyTs, ERROR_MSG)
        .catch(updateErr => logger.warn({ updateErr }, 'Failed to update placeholder with error'));
    } else {
      removeReaction(botToken, channel, messageTs, THINKING_EMOJI)
        .catch(reactErr => logger.warn({ reactErr }, 'Failed to remove thinking reaction on error'));
      try {
        await replyInThread(botToken, channel, threadTs, ERROR_MSG);
      } catch (replyErr) {
        logger.error({ replyErr }, 'Failed to send error reply');
      }
    }
  }
}

/** Build Claude messages from Slack thread history + current user text. */
function buildMessages(
  threadMessages: Array<{ user?: string; bot_id?: string; text?: string; ts: string }>,
  currentText: string,
): ClaudeMessage[] {
  const messages: ClaudeMessage[] = [];

  for (const msg of threadMessages) {
    if (!msg.text) continue;
    if (msg.text === THINKING_MSG) continue;
    if (msg.text === ERROR_MSG) continue;
    // Skip placeholder messages from streaming
    if (msg.text === '...') continue;

    if (msg.bot_id) {
      const wrapped = JSON.stringify({ reply: msg.text, actions: [] });
      messages.push({ role: 'assistant', content: wrapped });
    } else if (msg.user) {
      messages.push({ role: 'user', content: msg.text });
    }
  }

  // Ensure the current message is included
  const lastUserMsg = messages.filter((m) => m.role === 'user').pop();
  if (!lastUserMsg || lastUserMsg.content !== currentText) {
    messages.push({ role: 'user', content: currentText });
  }

  // Limit to last 20 messages
  const recent = messages.length > 20 ? messages.slice(-20) : messages;
  return cleanMessageOrder(recent);
}
