import { load } from 'cheerio';
import type { Assignment, Source } from '../schemas.js';

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export interface SourceResult { assignments: Assignment[]; errors: string[] }
export interface SourceAdapter { source: Source; fetch(fetcher: Fetcher, now: string): Promise<SourceResult> }
export async function getText(fetcher: Fetcher, url: string, headers?: Record<string, string>): Promise<string> {
  const r = await fetcher(url, { headers: { 'User-Agent': 'FYRK-Assignment-Radar/1.0', ...headers }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}
export function links(html: string, base: string, pattern: RegExp): string[] {
  const $ = load(html);
  return [...new Set($('a[href]').toArray().map(el => new URL($(el).attr('href')!, base))
    .filter(u => u.origin === new URL(base).origin && pattern.test(u.pathname)).map(u => { u.hash = ''; return u.toString(); }))];
}
export async function fetchDetails(urls: string[], fetcher: Fetcher, parse: (html: string, url: string) => Assignment | null): Promise<SourceResult> {
  const assignments: Assignment[] = [], errors: string[] = [];
  // Small batches bound portal load; detail errors do not discard successful observations.
  for (let i = 0; i < urls.length; i += 4) {
    const results = await Promise.allSettled(urls.slice(i, i + 4).map(async url => parse(await getText(fetcher, url), url)));
    results.forEach((r, j) => {
      if (r.status === 'fulfilled') { if (r.value) assignments.push(r.value); }
      else errors.push(`${urls[i + j]}: detail fetch/parse failed`);
    });
  }
  return { assignments, errors };
}
export function requireListing(urls: string[], html: string, empty: RegExp): void {
  if (!urls.length && !empty.test(load(html).root().text())) throw new Error('Unrecognized listing format or access required');
}
export function fields(html: string): Record<string, string> {
  const $ = load(html), result: Record<string, string> = {};
  $('dt').each((_, el) => { result[$(el).text().trim().toLowerCase()] = $(el).next('dd').text().trim(); });
  return result;
}
