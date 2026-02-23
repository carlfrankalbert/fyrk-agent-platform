import type { SlackBlock } from '../lib/slack.js';

export function formatLeadBlocks(lead: Record<string, unknown>, account: Record<string, unknown> | null): SlackBlock[] {
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

export const REACTION_MAP: Record<string, { status: string; log: boolean }> = {
  'white_check_mark': { status: 'contacted', log: false },
  'clock3': { status: 'planned', log: false },
  'x': { status: 'not_relevant', log: true },
  'star': { status: 'warm', log: true },
  'ice_cube': { status: 'cold_good_account', log: true },
};
