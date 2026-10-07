import { z } from 'zod';
import type { StoredAssignment } from './schemas.js';
import type { Fetcher } from './sources/common.js';

export class SlackRejected extends Error {
  constructor(code: string) {
    // Report only bounded Slack error codes, never arbitrary response content.
    super(/^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : 'unknown_error');
  }
}
const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function slackText(record: StoredAssignment): string {
  const a = record.assignment, s = record.score;
  const field = (v: string | null): string => escape(v || 'Ikke oppgitt');
  return [`*${field(a.title)}* — match ${s.total}/100`, `Kunde: ${field(a.customer)}`,
    `Funnet hos: ${[...new Set(record.observations.map(o => o.source))].join(', ')}`,
    `Oppstart: ${field(a.start_date)} | Omfang: ${field(a.extent)} | Frist: ${field(a.deadline)}`,
    `Vurdering: ${escape(s.reasons.join(' ') || 'Ingen tydelig profilmatch.')}`,
    `Viktigste gap: ${escape(s.gaps.slice(0, 4).join(' ') || 'Ingen identifisert; kontroller originalkravene.')}`,
    `Anbefalt handling: ${escape(s.action)}`,
    ...record.observations.map(o => `<${o.url}|${o.source}>`)].join('\n');
}
export async function postSlack(record: StoredAssignment, token: string, channel: string, fetcher: Fetcher): Promise<{ channel: string; ts: string }> {
  const r = await fetcher('https://slack.com/api/chat.postMessage', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(20000), body: JSON.stringify({ channel, text: slackText(record),
      client_msg_id: record.id, unfurl_links: false, unfurl_media: false }),
  });
  // Only a parsed ok:false is definitely unsent. HTTP/network ambiguity is never automatically retried.
  const body = z.object({ ok: z.boolean(), error: z.string().optional(), channel: z.string().optional(), ts: z.string().optional() }).parse(await r.json());
  if (!body.ok) throw new SlackRejected(body.error || 'Slack rejected message');
  if (!r.ok || !body.channel || !body.ts) throw new Error('Ambiguous Slack response');
  return { channel: body.channel, ts: body.ts };
}
