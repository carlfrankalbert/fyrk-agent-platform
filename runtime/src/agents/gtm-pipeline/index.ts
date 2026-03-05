import type { AgentDefinition, AgentContext, AgentResult } from '../base.js';
import { getSupabase } from '../../lib/supabase.js';
import { getEnv } from '../../lib/env.js';
import { postMessage } from '../../lib/slack.js';
import { getISOWeekNumber } from '../../lib/date.js';
import { evaluatePivotTriggers } from './triggers.js';
import { buildDashboardBlocks } from './slack.js';
import {
  GtmPipelineInputSchema,
  GtmPipelineOutputSchema,
  type GtmPipelineInput,
  type GtmPipelineOutput,
  type GtmLead,
} from './schemas.js';

async function execute(
  rawInput: GtmPipelineInput,
  ctx: AgentContext,
): Promise<AgentResult<GtmPipelineOutput>> {
  const supabase = getSupabase();

  // 1. Determine week
  const { week: currentWeek, year: currentYear } = getISOWeekNumber();
  const weekNumber = rawInput.weekOverride ?? currentWeek;

  // 2. Fetch GTM leads
  const { data: leads, error: leadsError } = await supabase
    .from('leads')
    .select('status, created_at, score, company_name, company_size')
    .eq('gtm_context', 'carl-gtm');

  if (leadsError) {
    throw new Error(`Failed to fetch leads: ${leadsError.message}`);
  }

  const gtmLeads: GtmLead[] = leads ?? [];

  // 3. Fetch manual metrics from gtm_pipeline_log
  const { data: logRow } = await supabase
    .from('gtm_pipeline_log')
    .select('paid_days, folq_inbound, icp_comments')
    .eq('week_number', weekNumber)
    .eq('year', currentYear)
    .maybeSingle();

  const metrics = {
    activeCalls: gtmLeads.filter((l) => l.status === 'active').length,
    offersSent: gtmLeads.filter((l) => l.status === 'offer_sent').length,
    paidDays: logRow?.paid_days != null ? Number(logRow.paid_days) : null,
    folqInbound: logRow?.folq_inbound ?? null,
    icpComments: logRow?.icp_comments ?? null,
  };

  // 4. Evaluate pivot triggers
  const pivotTriggers = evaluatePivotTriggers(metrics, weekNumber, gtmLeads);

  // 5. Upsert to gtm_pipeline_log (preserves manual fields)
  await supabase.from('gtm_pipeline_log').upsert(
    {
      week_number: weekNumber,
      year: currentYear,
      active_calls: metrics.activeCalls,
      offers_sent: metrics.offersSent,
      pivot_triggers: pivotTriggers,
    },
    { onConflict: 'week_number,year', ignoreDuplicates: false },
  );

  // 6. Post to Slack (only if not dryRun)
  let slackPosted = false;
  if (!ctx.dryRun) {
    const env = getEnv();
    const token = env.SLACK_BOT_TOKEN;
    const channel = env.SLACK_CHANNEL_GTM;

    if (token && channel) {
      const blocks = buildDashboardBlocks(metrics, pivotTriggers, weekNumber);
      await postMessage(token, channel, blocks, `GTM Dashboard — Uke ${weekNumber}`);
      slackPosted = true;
    }
  }

  const output: GtmPipelineOutput = {
    weekNumber,
    metrics,
    pivotTriggers,
    slackPosted,
  };

  // Build markdown artifact
  const lines = [
    `# GTM Dashboard — Uke ${weekNumber}`,
    '',
    `- **Aktive samtaler:** ${metrics.activeCalls}`,
    `- **Tilbud sendt:** ${metrics.offersSent}`,
    `- **Betalte dager:** ${metrics.paidDays ?? 'ikke logget'}`,
    `- **Folq inbound:** ${metrics.folqInbound ?? 'ikke logget'}`,
    `- **ICP-kommentarer:** ${metrics.icpComments ?? 'ikke logget'}`,
    '',
  ];

  if (pivotTriggers.length > 0) {
    lines.push('## Pivot-triggere');
    for (const t of pivotTriggers) {
      lines.push(`- [${t.severity}] ${t.message}`);
    }
  } else {
    lines.push('Ingen pivot-triggere aktive.');
  }

  return {
    output,
    artifacts: [
      {
        kind: 'gtm-dashboard',
        content: lines.join('\n'),
        meta: {
          weekNumber,
          pivotTriggersCount: pivotTriggers.length,
          slackPosted,
        },
      },
    ],
  };
}

export const gtmPipelineAgent: AgentDefinition<GtmPipelineInput, GtmPipelineOutput> = {
  name: 'gtm-pipeline',
  version: '0.1',
  inputSchema: GtmPipelineInputSchema,
  outputSchema: GtmPipelineOutputSchema,
  execute,
};
