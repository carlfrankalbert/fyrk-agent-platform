import type { AgentDefinition, AgentContext, AgentResult } from '../base.js';
import { callClaudeJson } from '../../lib/claude-json.js';
import { getSupabase } from '../../lib/supabase.js';
import { getEnv } from '../../lib/env.js';
import { postMessage } from '../../lib/slack.js';
import { formatLeadBlocks } from '../../routes/leads/blocks.js';
import { buildSystemPrompt, buildUserPrompt } from './prompt.js';
import { buildDedupeKey, matchTargetAccount, type TargetAccount } from './scoring.js';
import {
  LeadScannerInputSchema,
  LeadScannerOutputSchema,
  ClaudeSignalsResponseSchema,
  type LeadScannerInput,
  type LeadScannerOutput,
  type CreatedLead,
  type SkippedSignal,
  type UnmatchedSignal,
  type ClaudeSignal,
} from './schemas.js';

const DEFAULT_MAX_LEADS = 10;
const DEFAULT_SCORE_THRESHOLD = 30;

async function execute(
  rawInput: LeadScannerInput,
  ctx: AgentContext,
): Promise<AgentResult<LeadScannerOutput>> {
  const maxLeads = rawInput.maxLeadsPerRun ?? DEFAULT_MAX_LEADS;
  const scoreThreshold = rawInput.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
  const supabase = getSupabase();

  // 1. Load target accounts
  const { data: targetRows, error: targetError } = await supabase
    .from('target_accounts')
    .select('id, name, domain, industry, segment, tier');

  if (targetError) {
    throw new Error(`Failed to fetch target accounts: ${targetError.message}`);
  }

  const targets: TargetAccount[] = (targetRows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    domain: r.domain,
    industry: r.industry,
    segment: r.segment,
    tier: r.tier ?? 'B',
  }));

  // 2. Build prompts
  const systemPrompt = buildSystemPrompt(targets);
  const userPrompt = buildUserPrompt(rawInput.articles);

  // 3. Call Claude
  const { parsed: claudeResponse } = await callClaudeJson(ClaudeSignalsResponseSchema, {
    model: 'claude-sonnet-4-5-20250929',
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: 8192,
  });

  // 4. Process signals
  const leadsCreated: CreatedLead[] = [];
  const signalsSkipped: SkippedSignal[] = [];
  const unmatchedSignals: UnmatchedSignal[] = [];
  const env = getEnv();

  for (const signal of claudeResponse.signals) {
    if (leadsCreated.length >= maxLeads) break;

    const scoreTotal = signal.scores.fit + signal.scores.trigger + signal.scores.timing +
      signal.scores.authority + signal.scores.intent;
    const dedupeKey = buildDedupeKey(
      signal.person.name,
      signal.person.companyName,
      signal.trigger.type,
    );

    // Skip low confidence
    if (signal.confidence === 'low') {
      signalsSkipped.push({
        personName: signal.person.name,
        companyName: signal.person.companyName,
        reason: 'low_confidence',
      });
      continue;
    }

    // Skip below threshold
    if (scoreTotal < scoreThreshold) {
      signalsSkipped.push({
        personName: signal.person.name,
        companyName: signal.person.companyName,
        reason: 'below_threshold',
      });
      continue;
    }

    // Check dedup
    if (!ctx.dryRun) {
      const { data: existing } = await supabase
        .from('leads')
        .select('id')
        .eq('dedupe_key', dedupeKey)
        .maybeSingle();

      if (existing) {
        signalsSkipped.push({
          personName: signal.person.name,
          companyName: signal.person.companyName,
          reason: 'duplicate',
        });
        continue;
      }
    }

    // Match target account
    const matchedAccount = matchTargetAccount(
      signal.person.companyName,
      signal.person.companyDomain,
      targets,
    );

    // Build lead record
    const leadRecord = buildLeadRecord(signal, dedupeKey, matchedAccount);

    if (ctx.dryRun) {
      const dryId = `dry-lead-${leadsCreated.length + 1}`;
      const created: CreatedLead = {
        leadId: dryId,
        personName: signal.person.name,
        personRole: signal.person.role,
        companyName: signal.person.companyName,
        scoreTotal,
        tier: matchedAccount?.tier ?? null,
        slackNotified: false,
        dedupeKey,
      };
      leadsCreated.push(created);
      if (!matchedAccount) {
        unmatchedSignals.push({
          personName: signal.person.name,
          companyName: signal.person.companyName,
          scoreTotal,
          leadId: dryId,
        });
      }
      continue;
    }

    // Insert lead
    const { data: lead, error: insertError } = await supabase
      .from('leads')
      .insert(leadRecord)
      .select('id, score_total')
      .single();

    if (insertError) {
      // 23505 = unique_violation (duplicate dedupe_key race condition)
      if (insertError.code === '23505') {
        signalsSkipped.push({
          personName: signal.person.name,
          companyName: signal.person.companyName,
          reason: 'duplicate',
        });
        continue;
      }
      throw new Error(`Failed to insert lead: ${insertError.message}`);
    }

    // Send Slack notification
    let slackNotified = false;
    const slackToken = env.SLACK_BOT_TOKEN;
    const slackChannel = env.SLACK_CHANNEL_LEADS ?? '#fyrk-leads';

    if (slackToken) {
      const account = matchedAccount ? { tier: matchedAccount.tier } : null;
      const blocks = formatLeadBlocks(
        { ...leadRecord, score_total: lead.score_total },
        account,
      );
      const fallbackText = `${signal.person.companyName} — ${signal.person.role} — Score: ${lead.score_total}/100`;

      const slackResult = await postMessage(slackToken, slackChannel, blocks, fallbackText);
      slackNotified = true;

      // Store slack reference
      if (slackResult.ts) {
        await supabase
          .from('leads')
          .update({
            slack_message_ts: slackResult.ts,
            slack_channel: slackResult.channel ?? slackChannel,
          })
          .eq('id', lead.id);
      }
    }

    const created: CreatedLead = {
      leadId: lead.id,
      personName: signal.person.name,
      personRole: signal.person.role,
      companyName: signal.person.companyName,
      scoreTotal: lead.score_total,
      tier: matchedAccount?.tier ?? null,
      slackNotified,
      dedupeKey,
    };
    leadsCreated.push(created);

    if (!matchedAccount) {
      unmatchedSignals.push({
        personName: signal.person.name,
        companyName: signal.person.companyName,
        scoreTotal: lead.score_total,
        leadId: lead.id,
      });
    }
  }

  // 5. Save agent state
  await ctx.db.setAgentState('lead-scanner', 'last_scan', {
    timestamp: new Date().toISOString(),
    articlesScanned: claudeResponse.totalArticlesAnalyzed,
    signalsDetected: claudeResponse.signals.length,
    leadsCreated: leadsCreated.length,
    signalsSkipped: signalsSkipped.length,
  });

  // 6. Build output
  const output: LeadScannerOutput = {
    leadsCreated,
    signalsSkipped,
    unmatchedSignals,
    hasLeads: leadsCreated.length > 0,
    totalArticlesAnalyzed: claudeResponse.totalArticlesAnalyzed,
    totalSignalsDetected: claudeResponse.signals.length,
  };

  // 7. Build markdown artifact
  const artifact = buildMarkdownReport(output);

  return {
    output,
    artifacts: [
      {
        kind: 'lead-scan-report',
        content: artifact,
        meta: {
          totalArticles: claudeResponse.totalArticlesAnalyzed,
          signalsDetected: claudeResponse.signals.length,
          leadsCreated: leadsCreated.length,
          signalsSkipped: signalsSkipped.length,
          unmatchedSignals: unmatchedSignals.length,
          dryRun: ctx.dryRun,
        },
      },
    ],
  };
}

function buildLeadRecord(
  signal: ClaudeSignal,
  dedupeKey: string,
  matchedAccount: TargetAccount | null,
): Record<string, unknown> {
  return {
    person_name: signal.person.name,
    person_role: signal.person.role,
    company_name: signal.person.companyName,
    company_domain: signal.person.companyDomain ?? null,
    trigger_type: signal.trigger.type,
    trigger_description: signal.trigger.description,
    source_url: signal.articleUrl,
    score_fit: signal.scores.fit,
    score_trigger: signal.scores.trigger,
    score_timing: signal.scores.timing,
    score_authority: signal.scores.authority,
    score_intent: signal.scores.intent,
    why_now: signal.outreach.whyNow,
    recommended_action: signal.outreach.recommendedAction,
    angle: signal.outreach.angle ?? null,
    dedupe_key: dedupeKey,
    account_id: matchedAccount?.id ?? null,
  };
}

function buildMarkdownReport(output: LeadScannerOutput): string {
  const lines: string[] = [];

  lines.push(`# Lead Scanner Report — ${new Date().toISOString()}\n`);
  lines.push(`- **Articles scanned:** ${output.totalArticlesAnalyzed}`);
  lines.push(`- **Signals detected:** ${output.totalSignalsDetected}`);
  lines.push(`- **Leads created:** ${output.leadsCreated.length}`);
  lines.push(`- **Signals skipped:** ${output.signalsSkipped.length}`);
  lines.push(`- **Unmatched signals:** ${output.unmatchedSignals.length}\n`);

  if (output.leadsCreated.length > 0) {
    lines.push('## Leads Created\n');
    for (const lead of output.leadsCreated) {
      const tierTag = lead.tier ? ` [Tier ${lead.tier}]` : ' [No match]';
      lines.push(`- **${lead.personName}** — ${lead.personRole} @ ${lead.companyName} — Score: ${lead.scoreTotal}/100${tierTag}`);
    }
    lines.push('');
  }

  if (output.signalsSkipped.length > 0) {
    lines.push('## Skipped Signals\n');
    for (const skipped of output.signalsSkipped) {
      lines.push(`- ${skipped.personName} @ ${skipped.companyName} — ${skipped.reason}`);
    }
    lines.push('');
  }

  if (output.unmatchedSignals.length > 0) {
    lines.push('## Unmatched Signals (not in target list)\n');
    for (const unmatched of output.unmatchedSignals) {
      lines.push(`- ${unmatched.personName} @ ${unmatched.companyName} — Score: ${unmatched.scoreTotal}/100`);
    }
  }

  return lines.join('\n');
}

export const leadScannerAgent: AgentDefinition<LeadScannerInput, LeadScannerOutput> = {
  name: 'lead-scanner',
  version: '0.1',
  inputSchema: LeadScannerInputSchema,
  outputSchema: LeadScannerOutputSchema,
  execute,
};
