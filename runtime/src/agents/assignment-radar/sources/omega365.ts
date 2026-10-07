import { load } from 'cheerio';
import { normalize, cleanText } from '../normalize.js';
import type { Assignment } from '../schemas.js';
import { getText, links, fetchDetails, requireListing, type SourceAdapter } from './common.js';

export function parseOmega(html: string, url: string, now: string): Assignment {
  const $ = load(html); const root = $('#content').length ? $('#content') : $('body');
  const title = $('h1').first().text().trim();
  const text = cleanText(root.html() || '');
  if (!title || !/Assignment Description|Oppdragsbeskrivelse|Beskrivelse av oppdraget|Duties|Responsibilities|Requirements|Qualifications|Job Description/i.test(text)) throw new Error('Omega job content missing');
  const field = (label: string): string | undefined => text.match(new RegExp(`(?:${label}):\\s*([^\\n]+)`, 'i'))?.[1]?.trim();
  return normalize('omega365', { external_id: new URL(url).pathname.split('/').pop()!, url, title,
    customer: field('Customer|Client|Kunde') ?? text.match(/(?:^|\n)([A-ZÆØÅ][^\n.,]{2,70}) (?:har behov|søker|skal anskaffe)/)?.[1], location: field('Location|Lokasjon'),
    deadline: field('Duedate|Deadline|Søknadsfrist'), start_date: field('Duration|Varighet')?.split(' - ')[0],
    extent: field('Extent|Workload|Omfang|Stillingsprosent'),
    description: text.slice(Math.max(0, text.search(/Assignment Description|Oppdragsbeskrivelse|Beskrivelse av oppdraget|Duties|Responsibilities|Job Description/i))).split(/Contact person|Kontaktperson|Apply now/i)[0] }, now);
}
export const omegaAdapter: SourceAdapter = { source: 'omega365', async fetch(fetcher, now) {
  const url = 'https://www.omega365.com/jobs', html = await getText(fetcher, url);
  const urls = links(html, url, /^\/jobs\/jobinfo\/\d+$/);
  requireListing(urls, html, /0 open positions/i);
  return fetchDetails(urls, fetcher, (body, detail) => parseOmega(body, detail, now));
} };
