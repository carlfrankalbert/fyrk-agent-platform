import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '../lib/env.js';
import { verifySignature } from '../lib/slack.js';
import { MatSlackEventSchema } from './mat-schemas.js';

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

export async function matRoutes(fastify: FastifyInstance): Promise<void> {
  // Encapsulated sub-plugin for custom JSON parser (raw body for signature verification)
  await fastify.register(async function matSlackEventsPlugin(scope) {
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

    scope.post('/slack/mat-events', async (request: FastifyRequest, reply: FastifyReply) => {
      const env = getEnv();

      // Verify Slack signature if signing secret is configured
      if (env.SLACK_MAT_SIGNING_SECRET) {
        const rawBody = (request.body as Record<string, unknown>).__rawBody as string | undefined;
        if (rawBody) {
          const valid = verifySignature(
            env.SLACK_MAT_SIGNING_SECRET,
            request.headers as Record<string, string>,
            rawBody,
          );
          if (!valid) {
            return reply.status(401).send({ error: 'Invalid signature' });
          }
        }
      }

      const parseResult = MatSlackEventSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ error: parseResult.error.message });
      }

      const event = parseResult.data;

      // Handle url_verification challenge
      if (event.type === 'url_verification') {
        return { challenge: event.challenge };
      }

      // Handle reaction_added
      const reaction = event.event;
      const newStatus = REACTION_MAP[reaction.reaction];
      if (!newStatus) {
        return { ok: true, ignored: true };
      }

      const supabase = getSupabase();

      // Find weekly plan by slack_message_ts
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

      // Update plan status
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
    });
  });
}
