import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '../lib/env.js';
import { verifySignature } from '../lib/slack.js';
import {
  HusmorSlackChallengeSchema,
  HusmorSlackEventEnvelope,
  HusmorSlackReactionEvent,
  HusmorSlackMessageEvent,
} from './husmor-schemas.js';
import { handleHusmorMessage } from './husmor-conversation.js';

function getSupabase(): SupabaseClient {
  const env = getEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
}

// Reaction → plan status mapping
const REACTION_MAP: Record<string, string> = {
  '+1': 'approved',
  'thumbsup': 'approved',
  '-1': 'rejected',
  'thumbsdown': 'rejected',
  'repeat': 'regenerate',
};

// Dedup: in-memory Map on event_ts with 60s TTL
const recentEvents = new Map<string, number>();
const DEDUP_TTL_MS = 60_000;

function isDuplicate(eventTs: string): boolean {
  const now = Date.now();
  // Clean expired entries
  for (const [ts, expires] of recentEvents) {
    if (now > expires) recentEvents.delete(ts);
  }
  if (recentEvents.has(eventTs)) return true;
  recentEvents.set(eventTs, now + DEDUP_TTL_MS);
  return false;
}

export async function husmorRoutes(fastify: FastifyInstance): Promise<void> {
  // Encapsulated sub-plugin for custom JSON parser (raw body for signature verification)
  await fastify.register(async function husmorSlackEventsPlugin(scope) {
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (_req, body, done) => {
        try {
          const json = JSON.parse(body as string);
          (json as Record<string, unknown>).__rawBody = body;
          done(null, json);
        } catch (err) {
          done(err as Error, undefined);
        }
      },
    );

    scope.post('/slack/husmor-events', async (request: FastifyRequest, reply: FastifyReply) => {
      const env = getEnv();

      // Verify Slack signature if signing secret is configured
      if (env.SLACK_HUSMOR_SIGNING_SECRET) {
        const rawBody = (request.body as Record<string, unknown>).__rawBody as string | undefined;
        if (rawBody) {
          const valid = verifySignature(
            env.SLACK_HUSMOR_SIGNING_SECRET,
            request.headers as Record<string, string>,
            rawBody,
          );
          if (!valid) {
            return reply.status(401).send({ error: 'Invalid signature' });
          }
        }
      }

      // Loose envelope parse
      const envelopeResult = HusmorSlackEventEnvelope.safeParse(request.body);
      if (!envelopeResult.success) {
        return reply.status(400).send({ error: envelopeResult.error.message });
      }

      const envelope = envelopeResult.data;

      // Handle url_verification challenge
      if (envelope.type === 'url_verification') {
        const challenge = HusmorSlackChallengeSchema.safeParse(request.body);
        if (challenge.success) {
          return { challenge: challenge.data.challenge };
        }
        return reply.status(400).send({ error: 'Invalid challenge' });
      }

      // Must be event_callback
      if (envelope.type !== 'event_callback' || !envelope.event) {
        return reply.status(400).send({ error: 'Unsupported event type' });
      }

      const rawEvent = envelope.event as Record<string, unknown>;
      const eventType = rawEvent.type as string;

      // --- Handle reaction_added ---
      if (eventType === 'reaction_added') {
        const reactionResult = HusmorSlackReactionEvent.safeParse(rawEvent);
        if (!reactionResult.success) {
          return reply.status(400).send({ error: reactionResult.error.message });
        }

        const reaction = reactionResult.data;
        const newStatus = REACTION_MAP[reaction.reaction];
        if (!newStatus) {
          return { ok: true, ignored: true };
        }

        const supabase = getSupabase();

        const { data: plan, error: findError } = await supabase
          .from('weekly_plans')
          .select('id, status')
          .eq('slack_message_ts', reaction.item.ts)
          .eq('slack_channel', reaction.item.channel)
          .maybeSingle();

        if (findError || !plan) {
          scope.log.warn({ ts: reaction.item.ts }, 'No weekly plan found for reaction');
          return { ok: true, no_match: true };
        }

        await supabase
          .from('weekly_plans')
          .update({
            status: newStatus === 'regenerate' ? 'draft' : newStatus,
            updated_at: new Date().toISOString(),
          })
          .eq('id', plan.id);

        scope.log.info(
          { planId: plan.id, reaction: reaction.reaction, newStatus },
          'Weekly plan status updated via reaction',
        );

        return { ok: true, planId: plan.id, newStatus };
      }

      // --- Handle message ---
      if (eventType === 'message') {
        const msgResult = HusmorSlackMessageEvent.safeParse(rawEvent);
        if (!msgResult.success) {
          return { ok: true, ignored: true };
        }

        const msg = msgResult.data;

        // Filter: skip bot messages
        if (msg.bot_id) {
          return { ok: true, ignored: true, reason: 'bot_message' };
        }

        // Filter: skip messages with subtype (edits, joins, etc.)
        if (msg.subtype) {
          return { ok: true, ignored: true, reason: 'subtype' };
        }

        // Filter: skip empty messages
        if (!msg.text || !msg.user) {
          return { ok: true, ignored: true, reason: 'empty' };
        }

        // Ignore Slack retries
        const retryNum = request.headers['x-slack-retry-num'];
        if (retryNum) {
          return { ok: true, ignored: true, reason: 'retry' };
        }

        // Dedup on event_ts
        const eventTs = msg.event_ts ?? msg.ts;
        if (isDuplicate(eventTs)) {
          return { ok: true, ignored: true, reason: 'duplicate' };
        }

        // Async dispatch — return immediately for Slack's 3-second timeout
        // Use thread_ts if replying in a thread, otherwise use ts to start a new thread
        const threadTs = msg.thread_ts ?? msg.ts;
        const logger = scope.log;
        setImmediate(() => {
          handleHusmorMessage({
            text: msg.text!,
            channel: msg.channel,
            threadTs,
            userId: msg.user!,
            logger,
          }).catch((err) => {
            logger.error({ err }, 'Unhandled error in handleHusmorMessage');
          });
        });

        return { ok: true };
      }

      return { ok: true, ignored: true, reason: 'unknown_event_type' };
    });
  });
}
