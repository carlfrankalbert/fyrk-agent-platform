import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '../lib/env.js';
import { postMessage, verifySignature, type SlackBlock } from '../lib/slack.js';
import { CreateLeadSchema, SlackEventSchema } from './leads-schemas.js';

function getSupabase(): SupabaseClient {
  const env = getEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
}

// --- Block Kit formatting ---

function formatLeadBlocks(lead: Record<string, unknown>, account: Record<string, unknown> | null): SlackBlock[] {
  const total = lead.score_total ?? 0;
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `\uD83C\uDFAF ${lead.company_name} — ${lead.person_role} — Score: ${total}/100` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Hvem:*\n${lead.person_name}` },
        { type: 'mrkdwn', text: `*Rolle:*\n${lead.person_role}` },
        { type: 'mrkdwn', text: `*Trigger:*\n${lead.trigger_type}` },
        { type: 'mrkdwn', text: `*Selskap:*\n${lead.company_name}${account ? ` (Tier ${account.tier})` : ''}` },
      ],
    },
  ];

  if (lead.trigger_description) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Trigger-detaljer:*\n${lead.trigger_description}` },
    });
  }

  if (lead.why_now) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Hvorfor nå:*\n${lead.why_now}` },
    });
  }

  if (lead.recommended_action) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Anbefalt handling:*\n${lead.recommended_action}` },
    });
  }

  if (lead.angle) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Vinkling:*\n${lead.angle}` },
    });
  }

  // Scoring breakdown
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Scoring:*  Fit: ${lead.score_fit}/30 | Trigger: ${lead.score_trigger}/25 | Timing: ${lead.score_timing}/20 | Authority: ${lead.score_authority}/15 | Intent: ${lead.score_intent}/10`,
    },
  });

  // Links
  const links: string[] = [];
  if (lead.person_linkedin) links.push(`<${lead.person_linkedin}|LinkedIn>`);
  if (lead.source_url) links.push(`<${lead.source_url}|Kilde>`);
  if (links.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Lenker:* ${links.join(' | ')}` },
    });
  }

  blocks.push({ type: 'divider' });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: '\u2705 Kontaktet | \uD83D\uDD52 Planlagt | \u274C Ikke relevant | \u2B50 Varm | \uD83E\uDDCA Kald, bra selskap',
      },
    ],
  });

  return blocks;
}

// --- Reaction → status mapping ---

const REACTION_MAP: Record<string, { status: string; log: boolean }> = {
  'white_check_mark': { status: 'contacted', log: false },
  'clock3': { status: 'planned', log: false },
  'x': { status: 'not_relevant', log: true },
  'star': { status: 'warm', log: true },
  'ice_cube': { status: 'cold_good_account', log: true },
};

// --- Routes ---

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
    // Custom parser that preserves raw body for signature verification
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
