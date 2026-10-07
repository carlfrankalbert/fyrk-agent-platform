import { randomUUID } from 'node:crypto';
import type { AgentDefinition } from '../base.js';
import { getEnv } from '../../lib/env.js';
import { InputSchema, OutputSchema, type RadarInput, type RadarOutput, type StoredAssignment } from './schemas.js';
import { adapters } from './sources/index.js';
import type { SourceAdapter, Fetcher } from './sources/common.js';
import { findDuplicate, mergeObservation } from './dedup.js';
import { scoreAssignment } from './score.js';
import { SupabaseRadarStore, type RadarStore } from './store.js';
import { postSlack, SlackRejected } from './slack.js';

export interface RadarDependencies {
  store: RadarStore; adapters: SourceAdapter[]; fetcher: Fetcher;
  threshold: number; dryRun: boolean; publish: boolean;
  slackToken?: string; slackChannel?: string; now?: string;
}
export async function executeRadar(input: RadarInput, deps: RadarDependencies): Promise<RadarOutput> {
  const now = deps.now ?? new Date().toISOString(), token = randomUUID();
  const output: RadarOutput = { found: 0, new: 0, duplicates: 0, filtered: 0, posted: 0, sources: [], errors: [] };
  if (!deps.dryRun && !await deps.store.acquire(token)) throw new Error('Assignment radar is already running');
  try {
    const records = await deps.store.list();
    const selected = deps.adapters.filter(a => input.sources.some(source => source === a.source));
    const results = await Promise.allSettled(selected.map(a => a.fetch(deps.fetcher, now)));
    for (const [i, result] of results.entries()) {
      const source = selected[i].source;
      if (result.status === 'rejected') {
        // Source errors are deliberately bounded and exclude credentials and response bodies.
        const message = result.reason instanceof Error && /^Access required:/.test(result.reason.message)
          ? result.reason.message : 'Source fetch/parse failed; check access or portal format';
        output.sources.push({ source, found: 0, errors: [message] }); continue;
      }
      const { assignments, errors } = result.value;
      output.sources.push({ source, found: assignments.length, errors });
      for (const a of assignments) {
        output.found++;
        const match = findDuplicate(a, records);
        let record: StoredAssignment;
        if (match) { record = mergeObservation(match.record, a); output.duplicates++; }
        else { record = { id: randomUUID(), assignment: a, observations: [a], score: scoreAssignment(a, input.profile, now.slice(0, 10)) }; output.new++; }
        record.score = scoreAssignment(record.assignment, input.profile, now.slice(0, 10));
        const eligible = record.score.relevant && record.score.total >= (input.threshold ?? deps.threshold);
        if (!eligible) output.filtered++;
        if (!deps.dryRun) await deps.store.save(token, record, !match, eligible);
        if (match) records[records.findIndex(r => r.id === record.id)] = record;
        else records.push(record);
      }
    }
    if (deps.publish && !deps.dryRun) {
      if (!deps.slackToken || !deps.slackChannel) output.errors.push('Slack is not configured; eligible assignments remain pending.');
      else {
        for (const id of await deps.store.pending()) {
          const record = records.find(r => r.id === id);
          if (!record) throw new Error('Outbox assignment missing');
          record.score = scoreAssignment(record.assignment, input.profile, now.slice(0, 10));
          if (!record.score.relevant || record.score.total < (input.threshold ?? deps.threshold)) continue;
          if (!await deps.store.claim(token, id)) continue;
          try {
            const sent = await postSlack(record, deps.slackToken, deps.slackChannel, deps.fetcher);
            output.posted++;
            await deps.store.finish(id, 'sent', sent.channel, sent.ts);
          } catch (err) {
            // A crash after reservation leaves 'sending', also terminal until manually reconciled.
            const rejected = err instanceof SlackRejected;
            await deps.store.finish(id, rejected ? 'pending' : 'uncertain', undefined, undefined,
              rejected ? `Slack rejected message (${err.message}); verify channel/token permissions` : 'Delivery uncertain; reconcile in Slack before retry');
            output.errors.push(rejected ? `Slack rejected a message (${err.message}); delivery remains pending.` : 'Slack delivery uncertain; automatic retry disabled.');
          }
        }
      }
    }
    if (!output.sources.some(s => !s.errors.length || s.found > 0)) output.errors.push('All selected sources failed.');
    return output;
  } finally { if (!deps.dryRun) await deps.store.release(token); }
}
export const assignmentRadarAgent: AgentDefinition<RadarInput, RadarOutput> = {
  name: 'assignment-radar', version: '0.2.1', inputSchema: InputSchema, outputSchema: OutputSchema,
  async execute(input, ctx) {
    const env = getEnv();
    const result = await executeRadar(input, {
      // Dry runs read persistent observations but do not reserve, write or publish anything.
      store: new SupabaseRadarStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY),
      adapters: adapters(), fetcher: fetch,
      threshold: env.ASSIGNMENT_RADAR_THRESHOLD, dryRun: ctx.dryRun, publish: ctx.publish,
      slackToken: env.ASSIGNMENT_RADAR_SLACK_BOT_TOKEN, slackChannel: env.ASSIGNMENT_RADAR_SLACK_CHANNEL,
    });
    return { output: result, artifacts: [{ kind: 'assignment-radar-report', content: JSON.stringify(result, null, 2) }] };
  },
};
