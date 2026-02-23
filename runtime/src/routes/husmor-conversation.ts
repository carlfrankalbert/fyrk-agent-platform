import { getEnv } from '../lib/env.js';
import { callClaude, extractText } from '../lib/claude.js';
import { replyInThread, updateMessage, getThreadHistory } from '../lib/slack.js';
import type { ClaudeMessage } from '../lib/claude.js';
import { getSupabase } from '../lib/supabase.js';
const HUSMOR_MODEL = 'claude-sonnet-4-5-20250929';

// Re-export split modules for backwards-compatible imports
export { loadDbContext, executeActions, getOrCreateCurrentWeekPlan } from './husmor-db.js';
export type { WeekPlanContext, DbContext } from './husmor-db.js';
export { buildSystemPrompt, parseClaudeResponse, cleanMessageOrder } from './husmor-prompt.js';

// Import for local use
import { loadDbContext, executeActions } from './husmor-db.js';
import { buildSystemPrompt, parseClaudeResponse, cleanMessageOrder } from './husmor-prompt.js';

export interface HusmorMessageParams {
  text: string;
  channel: string;
  threadTs: string;
  userId: string;
  isThreadReply: boolean;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

export async function handleHusmorMessage(params: HusmorMessageParams): Promise<void> {
  const { text, channel, threadTs, userId, isThreadReply, logger } = params;
  const env = getEnv();

  const botToken = env.SLACK_HUSMOR_BOT_TOKEN;
  const apiKey = env.ANTHROPIC_API_KEY;

  if (!botToken || !apiKey) {
    logger.error('Missing SLACK_HUSMOR_BOT_TOKEN or ANTHROPIC_API_KEY');
    return;
  }

  const supabase = getSupabase();

  // Post a "thinking" indicator immediately
  let thinkingTs: string | undefined;
  try {
    const thinking = await replyInThread(botToken, channel, threadTs, 'Husmor tenker...');
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

    // 2. Build prompt
    const systemPrompt = buildSystemPrompt(dbContext);

    // 3. Build conversation messages from thread history
    const messages: ClaudeMessage[] = [];
    if (threadMessages.length > 0) {
      // Skip the thinking message (last bot message) and the current user message (last)
      for (const msg of threadMessages) {
        if (!msg.text) continue;
        // Skip "Husmor tenker..." placeholders
        if (msg.text === 'Husmor tenker...') continue;
        // Skip error messages
        if (msg.text === 'Beklager, noe gikk galt. Prov igjen om litt!') continue;
        if (msg.bot_id) {
          // Bot message → wrap in JSON format so Claude sees the pattern it should follow
          const wrapped = JSON.stringify({ reply: msg.text, actions: [] });
          messages.push({ role: 'assistant', content: wrapped });
        } else if (msg.user) {
          messages.push({ role: 'user', content: msg.text });
        }
      }
    }

    // If no history or last message isn't the current one, add it
    const lastUserMsg = messages.filter((m) => m.role === 'user').pop();
    if (!lastUserMsg || lastUserMsg.content !== text) {
      messages.push({ role: 'user', content: text });
    }

    // Limit to last 20 messages to avoid token overflow
    const recentMessages = messages.length > 20 ? messages.slice(-20) : messages;

    // Ensure messages alternate and start with user
    const cleanedMessages = cleanMessageOrder(recentMessages);

    // 4. Call Claude
    const response = await callClaude(apiKey, {
      model: HUSMOR_MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages: cleanedMessages,
    });

    const rawText = extractText(response);

    // 4. Parse response
    const parsed = parseClaudeResponse(rawText);

    // 5. Update thinking message with real reply, or post new if update fails
    if (thinkingTs) {
      try {
        await updateMessage(botToken, channel, thinkingTs, parsed.reply);
      } catch {
        await replyInThread(botToken, channel, threadTs, parsed.reply);
      }
    } else {
      await replyInThread(botToken, channel, threadTs, parsed.reply);
    }

    // 6. Execute actions
    if (parsed.actions && parsed.actions.length > 0) {
      await executeActions(supabase, parsed.actions, logger);
    }

    logger.info({ userId, actionsCount: parsed.actions?.length ?? 0 }, 'Husmor message handled');
  } catch (err) {
    logger.error({ err, userId }, 'Failed to handle Husmor message');
    try {
      const errorMsg = 'Beklager, noe gikk galt. Prov igjen om litt!';
      if (thinkingTs) {
        try {
          await updateMessage(botToken, channel, thinkingTs, errorMsg);
        } catch {
          await replyInThread(botToken, channel, threadTs, errorMsg);
        }
      } else {
        await replyInThread(botToken, channel, threadTs, errorMsg);
      }
    } catch (replyErr) {
      logger.error({ replyErr }, 'Failed to send error reply');
    }
  }
}
