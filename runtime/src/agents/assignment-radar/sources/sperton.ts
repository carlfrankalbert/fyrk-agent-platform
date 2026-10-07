import { load } from 'cheerio';
import { z } from 'zod';
import type { Assignment } from '../schemas.js';
import { cleanText, normalize } from '../normalize.js';
import { fetchDetails, getText, type SourceAdapter } from './common.js';
import { checkPage, metadata, textField } from './public-data.js';

const origin = 'https://career.sperton.com';
const listingUrl = `${origin}/jobs?department=Consultant%20jobs&country=Norway`;
const jobSchema = z.object({
  '@type': z.literal('JobPosting'), title: z.string().min(1), description: z.string().min(1),
  identifier: z.object({ value: z.string().regex(/^\d+$/) }), employmentType: z.string(),
  validThrough: z.string().optional(),
  jobLocation: z.array(z.object({ address: z.object({ addressLocality: z.string(), addressCountry: z.string() }) })).optional(),
});
export function parseSperton(html: string, url: string, now: string): Assignment | null {
  const $ = load(html);
  const postings = $('script[type="application/ld+json"]').toArray().map(el => JSON.parse($(el).text()) as unknown);
  const job = jobSchema.parse(postings.find(value => typeof value === 'object' && value !== null && '@type' in value && value['@type'] === 'JobPosting'));
  if (job.identifier.value !== new URL(url).pathname.match(/\/jobs\/(\d+)-/)?.[1]) throw new Error('Job identity mismatch');
  // Consultant-jobs department is authoritative: Teamtailor also labels real assignments FULL_TIME.
  // Teamtailor encodes description markup inside JSON-LD; decode once before stripping HTML.
  const markup = /&lt;/.test(job.description) ? load(job.description).root().text() : job.description;
  const description = cleanText(markup).split(/\n(?:Om|About) Sperton\b/)[0], fields = metadata(description);
  if (/^(Frilansere\/Konsulenter|Freelancers)\s*[–-]/i.test(job.title)) return null;
  return normalize('sperton', {
    ...fields, external_id: job.identifier.value, title: job.title, url,
    location: [fields.location ?? job.jobLocation?.map(place => `${place.address.addressLocality}, ${place.address.addressCountry}`).join(' / '),
      textField(description, 'Arbeidsform|Work arrangement')].filter(Boolean).join(' / ') || null,
    deadline: fields.deadline ?? job.validThrough?.match(/^\d{4}-\d{2}-\d{2}/)?.[0],
    start_date: fields.start_date?.split(/\s+[–—]\s+/)[0] ?? null, description,
  }, now);
}
export const spertonAdapter: SourceAdapter = {
  source: 'sperton', async fetch(fetcher, now) {
    let url: string | null = listingUrl;
    const urls: string[] = [], seen = new Set<string>();
    for (let page = 0; url; page++) {
      if (page >= 100) throw new Error('Listing pagination exceeded safety limit');
      const html = await getText(fetcher, url), $ = load(html);
      const jobs = $('a[href]').toArray().map(el => ({ url: new URL($(el).attr('href')!, origin), title: $(el).text().trim() }))
        .filter(job => job.url.origin === origin && /^\/(?:no\/)?jobs\/\d+-/.test(job.url.pathname));
      if (!jobs.length && !$('#jobs_list_container, #jobs, turbo-stream').length) throw new Error('Unrecognized listing format or access required');
      const unique = [...new Map(jobs.map(job => [job.url.pathname.match(/\/jobs\/(\d+)-/)![1], job])).values()];
      checkPage(unique.map(job => job.url.pathname.match(/\/jobs\/(\d+)-/)![1]), seen);
      urls.push(...unique.filter(job => !/^(Frilansere\/Konsulenter|Freelancers)\s*[–-]/i.test(job.title)).map(job => job.url.toString()));
      const href = $('a[href*="/jobs/show_more"]').first().attr('href');
      url = null;
      if (href) {
        const next = new URL(href, origin);
        if (next.origin !== origin || next.pathname !== '/jobs/show_more') throw new Error('Unexpected pagination URL');
        next.searchParams.set('department', 'Consultant jobs'); next.searchParams.set('country', 'Norway'); url = next.toString();
      }
    }
    return fetchDetails(urls, fetcher, (html, url) => parseSperton(html, url, now));
  },
};
