import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getEnv } from '../../lib/env.js';
import { getSupabase } from '../../lib/supabase.js';
import { callClaudeStream } from '../../lib/claude.js';
import type { ClaudeMessage } from '../../lib/claude.js';
import { loadDbContextCached } from './db.js';
import { buildSystemPrompt, parseClaudeResponse, cleanMessageOrder } from './prompt.js';
import { executeActions } from './actions.js';
import { extractLearnings } from './learnings/index.js';
import { HUSMOR_WEB_HTML } from './web-ui.js';

const WEB_MODEL = 'claude-sonnet-4-5-20250929';

function checkAuth(request: FastifyRequest, reply: FastifyReply): boolean {
  const env = getEnv();
  const token = env.HUSMOR_WEB_TOKEN;
  if (!token) {
    reply.status(503).send({ error: 'Web chat not configured' });
    return false;
  }
  const auth = request.headers.authorization;
  if (!auth || auth !== `Bearer ${token}`) {
    reply.status(401).send({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

export async function husmorWebRoutes(fastify: FastifyInstance): Promise<void> {
  // Serve the chat HTML page (no auth — token entered in UI)
  fastify.get('/husmor/web', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.type('text/html').send(HUSMOR_WEB_HTML);
  });

  // List recent conversations
  fastify.get('/husmor/web/conversations', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkAuth(request, reply)) return;
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('husmor_web_conversations')
      .select('id, title, updated_at')
      .order('updated_at', { ascending: false })
      .limit(20);

    if (error) {
      return reply.status(500).send({ error: error.message });
    }
    return { conversations: data ?? [] };
  });

  // Load messages for a conversation
  fastify.get('/husmor/web/conversations/:id/messages', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('husmor_web_messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });

    if (error) {
      return reply.status(500).send({ error: error.message });
    }
    return { messages: data ?? [] };
  });

  // SSE streaming chat endpoint
  fastify.post('/husmor/web/chat', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkAuth(request, reply)) return;

    const env = getEnv();
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return reply.status(503).send({ error: 'Missing ANTHROPIC_API_KEY' });
    }

    const body = request.body as { conversationId?: string; message?: string };
    const message = body?.message?.trim();
    if (!message) {
      return reply.status(400).send({ error: 'message is required' });
    }

    const supabase = getSupabase();
    let conversationId = body.conversationId;

    // Create or load conversation
    if (!conversationId) {
      const { data, error } = await supabase
        .from('husmor_web_conversations')
        .insert({ title: message.slice(0, 80) })
        .select('id')
        .single();
      if (error || !data) {
        return reply.status(500).send({ error: 'Failed to create conversation' });
      }
      conversationId = data.id;
    } else {
      // Touch updated_at
      await supabase
        .from('husmor_web_conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId);
    }

    // Insert user message
    await supabase.from('husmor_web_messages').insert({
      conversation_id: conversationId,
      role: 'user',
      content: message,
    });

    // Load last 20 messages for context
    const { data: history } = await supabase
      .from('husmor_web_messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(20);

    // Build Claude messages — wrap assistant messages in JSON format like Slack path
    const rawMessages: ClaudeMessage[] = (history ?? []).map((m) => {
      if (m.role === 'assistant') {
        return { role: 'assistant' as const, content: JSON.stringify({ reply: m.content, actions: [] }) };
      }
      return { role: m.role as 'user' | 'assistant', content: m.content };
    });
    const messages = cleanMessageOrder(rawMessages);

    // Load DB context + build system prompt
    const dbContext = await loadDbContextCached(supabase);
    const systemPrompt = buildSystemPrompt(dbContext);

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let fullText = '';

    try {
      for await (const event of callClaudeStream(apiKey, {
        model: WEB_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        cache_control: { type: 'ephemeral' },
      })) {
        if (event.type === 'content_delta') {
          fullText += event.text;
          reply.raw.write(`data: ${JSON.stringify({ text: event.text })}\n\n`);
        } else if (event.type === 'message_complete') {
          const parsed = parseClaudeResponse(fullText);

          // Store assistant reply
          await supabase.from('husmor_web_messages').insert({
            conversation_id: conversationId,
            role: 'assistant',
            content: parsed.reply,
          });

          reply.raw.write(`data: ${JSON.stringify({ done: true, conversationId })}\n\n`);

          // Fire-and-forget: execute actions + extract learnings
          if (parsed.actions && parsed.actions.length > 0) {
            executeActions(supabase, parsed.actions, fastify.log).catch((err) =>
              fastify.log.error({ err }, 'Web chat: action execution failed'),
            );
          }
          extractLearnings(supabase, apiKey, conversationId!, messages, dbContext.learnings, fastify.log).catch(
            (err) => fastify.log.error({ err }, 'Web chat: learning extraction failed'),
          );

          fastify.log.info(
            {
              conversationId,
              input_tokens: event.response.usage.input_tokens,
              output_tokens: event.response.usage.output_tokens,
            },
            'Web chat response complete',
          );
        } else if (event.type === 'error') {
          reply.raw.write(`data: ${JSON.stringify({ error: event.error })}\n\n`);
          fastify.log.error({ error: event.error }, 'Web chat: Claude stream error');
        }
      }
    } catch (err) {
      fastify.log.error({ err }, 'Web chat: stream failed');
      reply.raw.write(`data: ${JSON.stringify({ error: 'Stream failed' })}\n\n`);
    }

    reply.raw.end();
  });
}
