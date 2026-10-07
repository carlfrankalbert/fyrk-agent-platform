import { z } from 'zod';
import type { Assignment } from '../schemas.js';
import { cleanText, normalize } from '../normalize.js';
import { fetchDetails, type SourceAdapter } from './common.js';
import { checkPage, getJson, metadata } from './public-data.js';

const api = 'https://portal-api.emagine.org/api/JobAds';
const identity = z.object({ id: z.number().int().positive(), title: z.string().min(1) });
const listing = z.object({ totalCount: z.number().int().nonnegative(), items: z.array(identity) });
const detail = identity.extend({
  description: z.string().min(1), status: z.string(), startDate: z.string().nullable(), seniority: z.string().nullable(),
  jobAdWorkLocation: z.object({ city: z.string().nullable(), country: z.string(), workLocationType: z.string() }),
});
export function parseEmagine(body: string, now: string): Assignment | null {
  const job = detail.parse(JSON.parse(body));
  if (job.status !== 'Open' || /dekket stilling|position filled/i.test(job.title)) return null;
  if (!/^(Norway|Norge)$/i.test(job.jobAdWorkLocation.country)) return null;
  const description = cleanText(job.description), fields = metadata(description);
  const slug = job.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return normalize('emagine', {
    ...fields, external_id: String(job.id), title: job.title,
    url: `https://portal.emagine.org/jobs/${job.id}/${slug || 'assignment'}`,
    location: [job.jobAdWorkLocation.city, job.jobAdWorkLocation.country, job.jobAdWorkLocation.workLocationType].filter(Boolean).join(' / '),
    start_date: fields.start_date ?? job.startDate,
    extent: fields.extent?.match(/(?:inntil\s*)?\d+\s*%|(?:ca\.?\s*)?\d+\s*timer/i)?.[0] ?? fields.extent,
    description: [description, job.seniority ? `Senioritet: ${job.seniority}` : ''].filter(Boolean).join('\n'),
  }, now);
}
export const emagineAdapter: SourceAdapter = {
  source: 'emagine', async fetch(fetcher, now) {
    const urls: string[] = [], seen = new Set<string>();
    for (let page = 0; ; page++) {
      if (page >= 100) throw new Error('Listing pagination exceeded safety limit');
      const data = listing.parse(await getJson(fetcher, `${api}/Search`, {
        skipCount: page * 100, maxResultCount: 100, sorting: 'CreationTime desc', supportedLanguageId: 'NO',
        filter: { isPartTime: null, textFilters: [], industriesIds: [], workLocations: [{ countryId: 'NO', city: '', region: '' }],
          workLocationTypes: [], recordIdsToExclude: [], professionalRolesIds: [], consultantSeniorities: [], languageProficiencies: [] },
      }));
      checkPage(data.items.map(job => String(job.id)), seen);
      urls.push(...data.items.map(job => `${api}/details/${job.id}/NO`));
      if (seen.size >= data.totalCount) break;
      if (!data.items.length) throw new Error('Empty page before listing was complete');
    }
    return fetchDetails(urls, fetcher, (body, url) => {
      const assignment = parseEmagine(body, now);
      if (assignment && assignment.external_id !== new URL(url).pathname.match(/\/details\/(\d+)\//)?.[1]) throw new Error('Job identity mismatch');
      return assignment;
    });
  },
};
