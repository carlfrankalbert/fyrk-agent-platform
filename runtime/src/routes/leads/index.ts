import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getEnv } from '../../lib/env.js';
import { postMessage, verifySignature } from '../../lib/slack.js';
import { getSupabase } from '../../lib/supabase.js';
import { registerRawBodyParser } from '../../lib/slack-events.js';
import { CreateLeadSchema, SlackEventSchema } from './schemas.js';
import { formatLeadBlocks, REACTION_MAP } from './blocks.js';

export async function leadRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /leads — create a new lead
  fastify.post('/leads', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = CreateLeadSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: parseResult.error.message });
    }

    const data = parseResult.data;
    const supabase = getSupabase();

    // Auto-link to target_account by domain
    let accountId = data.account_id;
    if (!accountId && data.company_domain) {
      const { data: account } = await supabase
        .from('target_accounts')
        .select('id')
        .eq('domain', data.company_domain)
        .maybeSingle();
      if (account) accountId = account.id;
    }

    const { data: lead, error } = await supabase
      .from('leads')
      .insert({ ...data, account_id: accountId })
      .select()
      .single();

    if (error) {
      fastify.log.error({ error }, 'Failed to create lead');
      return reply.status(500).send({ error: error.message });
    }

    return reply.status(201).send(lead);
  });

  // POST /leads/:id/notify — send Slack notification for a lead
  fastify.post<{ Params: { id: string } }>('/leads/:id/notify', async (request, reply) => {
    const env = getEnv();
    if (!env.SLACK_BOT_TOKEN) {
      return reply.status(503).send({ error: 'SLACK_BOT_TOKEN not configured' });
    }

    const supabase = getSupabase();

    // Fetch lead
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('*')
      .eq('id', request.params.id)
      .single();

    if (leadError || !lead) {
      return reply.status(404).send({ error: 'Lead not found' });
    }

    // Fetch linked account (if any)
    let account = null;
    if (lead.account_id) {
      const { data: acc } = await supabase
        .from('target_accounts')
        .select('*')
        .eq('id', lead.account_id)
        .single();
      account = acc;
    }

    // Format and send
    const channel = env.SLACK_CHANNEL_LEADS ?? '#fyrk-leads';
    const blocks = formatLeadBlocks(lead, account);
    const fallbackText = `${lead.company_name} — ${lead.person_role} — Score: ${lead.score_total}/100`;

    const slackResult = await postMessage(env.SLACK_BOT_TOKEN, channel, blocks, fallbackText);

    // Save message reference back on lead
    if (slackResult.ts) {
      await supabase
        .from('leads')
        .update({
          slack_message_ts: slackResult.ts,
          slack_channel: slackResult.channel ?? channel,
        })
        .eq('id', lead.id);
    }

    return { ok: true, ts: slackResult.ts };
  });

  // Register Slack events in an encapsulated sub-plugin
  // so the custom JSON parser (for raw body access) doesn't affect other routes
  await fastify.register(async function slackEventsPlugin(scope) {
    registerRawBodyParser(scope);

    scope.post('/slack/events', async (request: FastifyRequest, reply: FastifyReply) => {
      const env = getEnv();

      // Verify Slack signature if signing secret is configured
      if (env.SLACK_SIGNING_SECRET) {
        const rawBody = (request.body as Record<string, unknown>).__rawBody as string | undefined;
        if (rawBody) {
          const valid = verifySignature(
            env.SLACK_SIGNING_SECRET,
            request.headers as Record<string, string>,
            rawBody,
          );
          if (!valid) {
            return reply.status(401).send({ error: 'Invalid signature' });
          }
        }
      }

      const parseResult = SlackEventSchema.safeParse(request.body);
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
      const mapping = REACTION_MAP[reaction.reaction];
      if (!mapping) {
        return { ok: true, ignored: true };
      }

      const supabase = getSupabase();

      // Find lead by slack_message_ts
      const { data: lead, error: findError } = await supabase
        .from('leads')
        .select('id, status')
        .eq('slack_message_ts', reaction.item.ts)
        .eq('slack_channel', reaction.item.channel)
        .maybeSingle();

      if (findError || !lead) {
        scope.log.warn({ ts: reaction.item.ts }, 'No lead found for reaction');
        return { ok: true, no_match: true };
      }

      const previousStatus = lead.status;

      // Update lead status
      const updates: Record<string, unknown> = {
        status: mapping.status,
        updated_at: new Date().toISOString(),
      };
      if (mapping.status === 'contacted') {
        updates.contacted_at = new Date().toISOString();
      }

      await supabase.from('leads').update(updates).eq('id', lead.id);

      // Log to calibration_log if appropriate
      if (mapping.log) {
        await supabase.from('calibration_log').insert({
          lead_id: lead.id,
          action: `marked_${mapping.status}`,
          previous_status: previousStatus,
          new_status: mapping.status,
        });
      }

      // For cold_good_account, upsert company to target_accounts
      if (mapping.status === 'cold_good_account') {
        const { data: fullLead } = await supabase
          .from('leads')
          .select('company_name, company_domain')
          .eq('id', lead.id)
          .single();

        if (fullLead?.company_domain) {
          await supabase
            .from('target_accounts')
            .upsert(
              { name: fullLead.company_name, domain: fullLead.company_domain },
              { onConflict: 'domain' },
            );
        }
      }

      scope.log.info({ leadId: lead.id, reaction: reaction.reaction, newStatus: mapping.status }, 'Lead status updated via reaction');

      return { ok: true, leadId: lead.id, newStatus: mapping.status };
    });
  });

  await Promise.resolve();
}
