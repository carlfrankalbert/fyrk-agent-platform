import { z } from 'zod';
import type { Assignment } from '../schemas.js';
import { cleanText, normalize } from '../normalize.js';
import { fetchDetails, type SourceAdapter } from './common.js';
import { checkPage, getJson, metadata } from './public-data.js';

const origin = 'https://jobs.7n.com';
const filtersSchema = z.object({ localizationFilters: z.array(z.object({ CountriesList: z.array(z.object({ CountryId: z.number().int(), CountryCode: z.string() })) })) });
const listSchema = z.array(z.object({ id: z.string().regex(/^\d+$/), name: z.string().min(1), country: z.string() }));
const detailSchema = z.object({ Title: z.string().min(1), ShortDescription: z.string(), MainDescription: z.string().min(1), City: z.string(), Country: z.string() });
export function parseSevenN(body: string, url: string, now: string): Assignment | null {
  const job = detailSchema.parse(JSON.parse(body)), id = new URL(url).searchParams.get('id');
  if (!id || !/^\d+$/.test(id)) throw new Error('Missing job identity');
  if (!/^(Norway|Norge)$/i.test(job.Country)) return null;
  // Exclude standing network recruitment; these do not identify a concrete assignment.
  if (/experiencing high demand|join our (?:consultant )?network/i.test(cleanText(job.ShortDescription))) return null;
  const description = cleanText(`${job.ShortDescription}\n${job.MainDescription}`).split(/What you can expect from 7N|Ready to take your career/)[0].trim();
  const fields = metadata(description);
  return normalize('7n', { ...fields, external_id: id, title: job.Title, url: `${origin}/job-offers/${id}`,
    location: fields.location ?? [job.City, job.Country].filter(Boolean).join(', '), description }, now);
}
export const sevenNAdapter: SourceAdapter = {
  source: '7n', async fetch(fetcher, now) {
    const filters = filtersSchema.parse(await getJson(fetcher, `${origin}/umbraco/api/Search/GetJobOffersLocalizationsAndCategories?searchVacancies=false&clientCountry=NO`));
    const country = filters.localizationFilters.flatMap(continent => continent.CountriesList).find(country => country.CountryCode === 'NO');
    // The portal only exposes countries with current listings in this filter response.
    if (!country) return { assignments: [], errors: [] };
    const urls: string[] = [], seen = new Set<string>();
    for (let page = 0; ; page++) {
      if (page >= 100) throw new Error('Listing pagination exceeded safety limit');
      const jobs = listSchema.parse(await getJson(fetcher, `${origin}/umbraco/api/Search/ShowJobOffers`, {
        Continents: [], Countries: [country.CountryId], Cities: [], Categories: [], Keywords: [], Offset: page * 50, HowMuch: 50,
      }));
      checkPage(jobs.map(job => job.id), seen);
      urls.push(...jobs.filter(job => /^(Norway|Norge)$/i.test(job.country)).map(job => `${origin}/umbraco/api/content/getjoboffercontent?id=${job.id}`));
      if (jobs.length < 50) break;
    }
    return fetchDetails(urls, fetcher, (body, url) => parseSevenN(body, url, now));
  },
};
