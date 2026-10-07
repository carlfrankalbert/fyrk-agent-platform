import { load } from 'cheerio';
import { z } from 'zod';
import type { Assignment } from '../schemas.js';
import { cleanText, normalize } from '../normalize.js';
import { getText, type SourceAdapter } from './common.js';
import { metadata } from './public-data.js';

const base = 'https://rightpeoplegroup.com/nb/open-assignments';
const page = z.object({ props: z.object({ pageProps: z.object({ projects: z.array(z.object({
  id: z.number().int().positive(), title: z.string().min(1), slug: z.string().min(1), description: z.string().min(1),
  location: z.string(), open: z.boolean(),
})) }) }) });
export function parseRightPeopleGroup(html: string, now: string): Assignment[] {
  const $ = load(html), data = page.parse(JSON.parse($('#__NEXT_DATA__').text()));
  return data.props.pageProps.projects.filter(job => job.open && /^(Norway|Norge)$/i.test(job.location)).map(job => {
    const description = cleanText(job.description), fields = metadata(description);
    return normalize('rightpeoplegroup', {
      ...fields, external_id: String(job.id), url: `${base}/${encodeURIComponent(job.slug)}`, title: job.title,
      location: fields.location ?? job.location, description,
    }, now);
  });
}
export const rightPeopleGroupAdapter: SourceAdapter = {
  source: 'rightpeoplegroup', async fetch(fetcher, now) {
    // The SSR page embeds the complete projects array, including full descriptions.
    return { assignments: parseRightPeopleGroup(await getText(fetcher, base), now), errors: [] };
  },
};
