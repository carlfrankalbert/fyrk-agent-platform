import { load } from 'cheerio';
import { normalize, cleanText } from '../normalize.js';
import type { Assignment } from '../schemas.js';
import { getText, links, fetchDetails, fields, requireListing, type SourceAdapter } from './common.js';

export function parseKons(html: string, url: string, now: string): Assignment {
  const $ = load(html), f = fields(html), root = $('body');
  const title = $('h1').first().text().trim();
  const text = cleanText(root.html() || '');
  const field = (label: string): string | undefined => text.match(new RegExp(`(?:${label}):\\s*([^\\n]+)`, 'i'))?.[1]?.trim();
  if (!title || !f.status) throw new Error('Kons assignment content missing');
  return normalize('kons', { external_id: new URL(url).pathname.split('/').pop()!, url, title,
    customer: f.selskap, location: f.lokasjon, deadline: f.søknadsfrist,
    start_date: f.oppstart ?? f.startdato ?? field('Oppstart|Startdato'), extent: field('Omfang|Stillingsprosent') ?? f.stillingsandel,
    description: root.html() || '' }, now);
}
export const konsAdapter: SourceAdapter = { source: 'kons', async fetch(fetcher, now) {
  const url = 'https://www.kons.no/assignments', html = await getText(fetcher, url);
  const urls = links(html, url, /^\/assignment\/[^/]+$/);
  requireListing(urls, html, /Ingen (?:ledige )?oppdrag|0 oppdrag/i);
  return fetchDetails(urls, fetcher, (body, detail) => parseKons(body, detail, now));
} };
