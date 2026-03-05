import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getEnv } from '../../lib/env.js';
import { postMessage, verifySignature } from '../../lib/slack.js';
import { getSupabase } from '../../lib/supabase.js';
import { registerRawBodyParser } from '../../lib/slack-events.js';
import { getISOWeekNumber } from '../../lib/date.js';

const GtmSlackEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('url_verification'),
    challenge: z.string(),
  }),
  z.object({
    type: z.literal('event_callback'),
    event: z.object({
      type: z.string(),
      text: z.string().optional(),
      channel: z.string(),
      ts: z.string(),
      user: z.string().optional(),
      bot_id: z.string().optional(),
    }),
  }),
]);

interface ParsedGtmLog {
  folq?: number;
  icp?: number;
  paid?: number;
}

function parseGtmLogMessage(text: string): ParsedGtmLog {
  const result: ParsedGtmLog = {};

  const folqMatch = text.match(/folq:(\d+(?:\.\d+)?)/);
  if (folqMatch) result.folq = Number(folqMatch[1]);

  const icpMatch = text.match(/icp:(\d+(?:\.\d+)?)/);
  if (icpMatch) result.icp = Number(icpMatch[1]);

  const paidMatch = text.match(/paid:(\d+(?:\.\d+)?)/);
  if (paidMatch) result.paid = Number(paidMatch[1]);

  return result;
}

export async function gtmRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(async function gtmEventsPlugin(scope) {
    registerRawBodyParser(scope);

    scope.post('/slack/gtm-events', async (request: FastifyRequest, reply: FastifyReply) => {
      const env = getEnv();

      // Verify Slack signature
      if (env.SLACK_GTM_SIGNING_SECRET) {
        const rawBody = (request.body as Record<string, unknown>).__rawBody as string | undefined;
        if (rawBody) {
          const valid = verifySignature(
            env.SLACK_GTM_SIGNING_SECRET,
            request.headers as Record<string, string>,
            rawBody,
          );
          if (!valid) {
            return reply.status(401).send({ error: 'Invalid signature' });
          }
        }
      }

      const parseResult = GtmSlackEventSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ error: parseResult.error.message });
      }

      const payload = parseResult.data;

      if (payload.type === 'url_verification') {
        return { challenge: payload.challenge };
      }

      const event = payload.event;

      // Ignore bot messages
      if (event.bot_id) {
        return { ok: true, ignored: true };
      }

      // Only handle message events starting with 'gtm-log'
      if (event.type !== 'message' || !event.text?.startsWith('gtm-log')) {
        return { ok: true, ignored: true };
      }

      const parsed = parseGtmLogMessage(event.text);

      // At least one field must be provided
      if (parsed.folq === undefined && parsed.icp === undefined && parsed.paid === undefined) {
        return { ok: true, ignored: true };
      }

      const { week, year } = getISOWeekNumber();
      const supabase = getSupabase();

      // Build upsert payload — only update specified fields
      const upsertData: Record<string, unknown> = {
        week_number: week,
        year,
      };
      if (parsed.folq !== undefined) upsertData.folq_inbound = parsed.folq;
      if (parsed.icp !== undefined) upsertData.icp_comments = parsed.icp;
      if (parsed.paid !== undefined) upsertData.paid_days = parsed.paid;

      await supabase.from('gtm_pipeline_log').upsert(upsertData, {
        onConflict: 'week_number,year',
        ignoreDuplicates: false,
      });

      const token = env.SLACK_BOT_TOKEN;
      if (token) {
        await postMessage(token, event.channel, [], `✅ GTM-metrikker logget for uke ${week}`);
      }

      return { ok: true, week };
    });
  });
}
