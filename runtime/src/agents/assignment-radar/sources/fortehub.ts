import { z } from 'zod';
import { normalize } from '../normalize.js';
import type { Assignment } from '../schemas.js';
import { getText, type SourceAdapter } from './common.js';

const Job = z.object({ id: z.string().min(1), shortId: z.number(), slug: z.string(), title: z.string().min(1),
  client: z.string().nullable(), location: z.string().nullable(), deadline: z.string().nullable(),
  period: z.object({ startDate: z.string().nullable(), endDate: z.string().nullable() }),
  workload: z.number().nullable(), requirements: z.string().nullable(), description: z.string().nullable(),
  originalDescription: z.string().nullable().optional(), isArchived: z.boolean().optional(), asap: z.boolean().optional(),
});
export function parseForte(body: string, now: string): Assignment[] {
  return z.array(Job).parse(JSON.parse(body)).filter(j => !j.isArchived).map(j => normalize('fortehub', {
    external_id: j.id, url: `https://platform.fortehub.no/no/assignments/${j.shortId}/${j.slug}`,
    title: j.title, customer: j.client, location: j.location, deadline: j.deadline,
    start_date: j.asap ? 'ASAP' : j.period.startDate,
    extent: j.workload === null ? null : `${j.workload}%`,
    description: [j.description, j.originalDescription, j.requirements].filter(Boolean).join('\n'),
  }, now));
}
export const forteAdapter: SourceAdapter = { source: 'fortehub', async fetch(fetcher, now) {
  return { assignments: parseForte(await getText(fetcher, 'https://backend.fortehub.no/api/assignments'), now), errors: [] };
} };
