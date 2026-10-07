import { z } from 'zod';
import { normalize } from '../normalize.js';
import type { Assignment } from '../schemas.js';
import { getText, type SourceAdapter, type SourceResult } from './common.js';

const Job = z.object({ uuid: z.string().min(1), title: z.string().min(1),
  company: z.object({ name: z.string() }), description: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(), deadline: z.union([z.string(), z.object({ tag: z.enum(['ASAP','DeadlineWithDate','ContinuousDeadline']), contents: z.string().optional() })]).nullable().optional(),
  placeDescription: z.string().nullable().optional(), region: z.object({ name: z.string() }).nullable().optional(),
  allowRemoteWork: z.boolean().nullable().optional(), percent: z.number().nullable().optional(), isActive: z.boolean(),
});
export function parseFolq(body: string, now: string): Assignment[] {
  return z.array(Job).parse(JSON.parse(body)).filter(j => j.isActive).map(j => normalize('folq', {
    external_id: j.uuid, url: `https://app.folq.com/assignments/${j.uuid}`, title: j.title,
    customer: j.company.name, location: [j.placeDescription || j.region?.name, j.allowRemoteWork ? 'Remote' : null].filter(Boolean).join(' / ') || null,
    deadline: typeof j.deadline === 'string' ? j.deadline : j.deadline?.tag === 'DeadlineWithDate' ? j.deadline.contents : j.deadline?.tag === 'ASAP' ? 'ASAP' : null, start_date: j.startDate,
    extent: j.percent ? `${j.percent}%` : null, description: j.description,
  }, now));
}
export function folqAdapter(cookie?: string): SourceAdapter {
  return { source: 'folq', async fetch(fetcher, now): Promise<SourceResult> {
    // The verified marketplace endpoint requires a Folq session cookie. Do not scrape the marketing site.
    if (!cookie) throw new Error('Access required: configure ASSIGNMENT_RADAR_FOLQ_COOKIE');
    return { assignments: parseFolq(await getText(fetcher, 'https://marketplace-api.prod.folq.com/assignments', { Cookie: cookie }), now), errors: [] };
  } };
}
