import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '../lib/env.js';
import { verifySignature } from '../lib/slack.js';
import { registerRawBodyParser } from '../lib/slack-events.js';
import { getSupabase } from '../lib/supabase.js';
import type { Logger } from '../lib/types.js';
import { handleBotEvent } from './conversation.js';
import { claimEvent, cleanupClaims } from './dedup.js';
import { classifyEvent, SlackEnvelopeSchema, SlackUrlVerificationSchema } from './events.js';
import { getModule, listModules } from './modules/registry.js';
import { selectModule } from './select.js';
import type { SlackBotEvent } from './types.js';

export const SLACK_BOT_EVENTS_PATH = '/slack/fyrk-bot-events';

export interface SlackBotRouteOptions {
  /** Overridable for tests */
  getSupabase?: () => SupabaseClient;
  handleEvent?: typeof handleBotEvent;
}

/**
 * Claim the event, then answer it. Runs after Slack has already received its 200.
 * Dedup fails open: if the dedup table is unavailable we would rather answer twice than not at all.
 */
export async function processEvent(
  event: SlackBotEvent,
  supabase: SupabaseClient,
  handle: (event: SlackBotEvent) => Promise<void>,
  logger: Logger,
): Promise<void> {
  try {
    const claimed = await claimEvent(supabase, event.eventId);
    if (!claimed) {
      logger.info({ eventId: event.eventId }, 'Slack bot event already claimed, skipping');
      return;
    }
  } catch (err) {
    logger.warn({ err, eventId: event.eventId }, 'Slack bot dedup unavailable, answering anyway');
  }
  cleanupClaims(supabase).catch((err: unknown) => logger.warn({ err }, 'Slack bot dedup cleanup failed'));
  await handle(event);
}

export async function slackBotRoutes(fastify: FastifyInstance, opts: SlackBotRouteOptions = {}): Promise<void> {
  const env = getEnv();
  if (env.SLACK_FYRK_BOT_TOKEN && env.SLACK_FYRK_SIGNING_SECRET) {
    const configured = [env.SLACK_BOT_DEFAULT_MODULE, ...Object.values(env.SLACK_BOT_CHANNEL_MODULES ?? {})];
    const unknown = configured.filter((id) => !getModule(id));
    if (unknown.length > 0) {
      fastify.log.error({ unknown, available: listModules() }, 'Slack bot configured with unknown module ids');
    }
  }

  // Encapsulated sub-plugin so the raw-body JSON parser only applies to the Slack route
  await fastify.register(function slackBotEventsPlugin(scope, _opts, done) {
    registerRawBodyParser(scope);

    scope.post(SLACK_BOT_EVENTS_PATH, async (request: FastifyRequest, reply: FastifyReply) => {
      const env = getEnv();
      const signingSecret = env.SLACK_FYRK_SIGNING_SECRET;
      const botToken = env.SLACK_FYRK_BOT_TOKEN;
      if (!signingSecret || !botToken) {
        return reply.status(503).send({ error: 'Slack bot is not configured' });
      }

      const body = request.body as Record<string, unknown> | undefined;
      const rawBody = body?.__rawBody;
      if (typeof rawBody !== 'string' || !verifySignature(signingSecret, request.headers as Record<string, string>, rawBody)) {
        return reply.status(401).send({ error: 'Invalid signature' });
      }

      const challenge = SlackUrlVerificationSchema.safeParse(body);
      if (challenge.success) {
        return { challenge: challenge.data.challenge };
      }

      // Slack retries when we were slow or failed; we always ack immediately, so a retry is a duplicate.
      if (request.headers['x-slack-retry-num'] !== undefined) {
        request.log.info({ retry: request.headers['x-slack-retry-num'], reason: request.headers['x-slack-retry-reason'] }, 'Ignoring Slack retry');
        return { ok: true };
      }

      const envelope = SlackEnvelopeSchema.safeParse(body);
      if (!envelope.success) {
        return reply.status(400).send({ error: 'Invalid Slack payload' });
      }

      const result = classifyEvent(envelope.data);
      if (!result.handle) {
        request.log.debug({ reason: result.reason }, 'Ignoring Slack event');
        return { ok: true };
      }

      // Ack now (Slack wants a response within 3 s), answer in the background
      const logger = request.log;
      const supabase = (opts.getSupabase ?? getSupabase)();
      const handle = opts.handleEvent ?? handleBotEvent;
      void processEvent(result.event, supabase, (event) => handle(event, {
        botToken,
        apiKey: env.ANTHROPIC_API_KEY,
        selectModule: (e) => selectModule(e),
        logger,
      }), logger).catch((err: unknown) => logger.error({ err }, 'Slack bot event processing failed'));

      return { ok: true };
    });

    done();
  });
}
