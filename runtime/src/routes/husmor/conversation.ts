import { getEnv } from '../../lib/env.js';
import { callClaude, extractText } from '../../lib/claude.js';
import { replyInThread, updateMessage, getThreadHistory } from '../../lib/slack.js';
import type { ClaudeMessage } from '../../lib/claude.js';
import { getSupabase } from '../../lib/supabase.js';
import { loadDbContext } from './db.js';
import { executeActions } from './actions.js';
import { buildSystemPrompt, parseClaudeResponse, cleanMessageOrder } from './prompt.js';
import { extractLearnings } from './learnings/index.js';
import type { Logger } from '../../lib/types.js';

export const HUSMOR_MODEL = 'claude-opus-4-6';
export const THINKING_MSG = 'Husmor tenker...';
export const ERROR_MSG = 'Beklager, noe gikk galt. Prov igjen om litt!';

export interface HusmorMessageParams {
  text: string;
  channel: string;
  threadTs: string;
  userId: string;
  isThreadReply: boolean;
  logger: Logger;
}

/** Update the thinking placeholder with a reply, or post a new message if update fails. */
async function sendReply(
  botToken: string,
  channel: string,
  threadTs: string,
  thinkingTs: string | undefined,
  text: string,
): Promise<void> {
  if (thinkingTs) {
    try {
      await updateMessage(botToken, channel, thinkingTs, text);
      return;
    } catch {
      // Fall through to replyInThread
    }
  }
  await replyInThread(botToken, channel, threadTs, text);
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

async function handleHusmorMessageInner(params: HusmorMessageParams): Promise<void> {
  const { text, channel, threadTs, userId, isThreadReply, logger } = params;
  logger.info({ userId, channel, threadTs, textLen: text.length }, 'handleHusmorMessage started');
  const env = getEnv();

  const botToken = env.SLACK_HUSMOR_BOT_TOKEN;
  const apiKey = env.ANTHROPIC_API_KEY;

  if (!botToken || !apiKey) {
    logger.error({ hasBotToken: !!botToken, hasApiKey: !!apiKey }, 'Missing SLACK_HUSMOR_BOT_TOKEN or ANTHROPIC_API_KEY');
    return;
  }

  const supabase = getSupabase();

  // Post a "thinking" indicator immediately
  let thinkingTs: string | undefined;
  try {
    const thinking = await replyInThread(botToken, channel, threadTs, THINKING_MSG);
    thinkingTs = thinking.ts;
  } catch (err) {
    logger.warn({ err }, 'Failed to post thinking indicator');
  }

  try {
    // 1. Load DB context + thread history in parallel
    const [dbContext, threadMessages] = await Promise.all([
      loadDbContext(supabase),
      isThreadReply
        ? getThreadHistory(botToken, channel, threadTs).catch(() => [])
        : Promise.resolve([]),
    ]);

    // 2. Build system prompt
    const systemPrompt = buildSystemPrompt(dbContext);

    // 3. Build conversation messages from thread history
    const messages = buildMessages(threadMessages, text);

    // 4. Call Claude
    const response = await callClaude(apiKey, {
      model: HUSMOR_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      cache_control: { type: 'ephemeral' },
    });

    logger.info({
      input_tokens: response.usage.input_tokens,
      cache_read: response.usage.cache_read_input_tokens ?? 0,
      cache_write: response.usage.cache_creation_input_tokens ?? 0,
      output_tokens: response.usage.output_tokens,
    }, 'Claude API usage');

    const parsed = parseClaudeResponse(extractText(response));

    // 5. Send reply
    await sendReply(botToken, channel, threadTs, thinkingTs, parsed.reply);

    // 6. Execute actions
    if (parsed.actions && parsed.actions.length > 0) {
      await executeActions(supabase, parsed.actions, logger, botToken, { channel, threadTs });
    }

    // 7. Fire-and-forget: extract learnings from conversation
    extractLearnings(supabase, apiKey, threadTs, messages, dbContext.learnings, logger)
      .catch(err => logger.error({ err }, 'Learning extraction failed (non-fatal)'));

    logger.info({ userId, actionsCount: parsed.actions?.length ?? 0 }, 'Husmor message handled');
  } catch (err) {
    logger.error({ err, userId }, 'Failed to handle Husmor message');
    try {
      await sendReply(botToken, channel, threadTs, thinkingTs, ERROR_MSG);
    } catch (replyErr) {
      logger.error({ replyErr }, 'Failed to send error reply');
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
