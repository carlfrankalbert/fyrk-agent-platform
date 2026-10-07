import { load } from 'cheerio';
import { AssignmentSchema, type Assignment, type Source } from './schemas.js';

export function cleanText(value: string): string {
  const $ = load(value); $('script,style,nav,header,footer').remove();
  $('br').replaceWith('\n'); $('p,li,h1,h2,h3,dt,dd').each((_, el) => { $(el).append('\n'); });
  return $.root().text().replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
export function canonicalUrl(raw: string): string {
  const u = new URL(raw); u.hash = ''; u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/i.test(k)) u.searchParams.delete(k);
  u.searchParams.sort(); u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  return u.toString();
}
export function dateValue(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})(?:T|\s|$)/);
  if (iso) return iso[1];
  const dotted = raw.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/);
  if (dotted) return `${dotted[3]}-${dotted[2].padStart(2, '0')}-${dotted[1].padStart(2, '0')}`;
  const months = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember'];
  const englishMonths = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const long = raw.toLowerCase().match(/(\d{1,2})\.?\s+([a-z]+)\s+(\d{4})/);
  if (long) {
    const month = months.indexOf(long[2]) >= 0 ? months.indexOf(long[2]) : englishMonths.indexOf(long[2]);
    if (month >= 0) return `${long[3]}-${String(month + 1).padStart(2, '0')}-${long[1].padStart(2, '0')}`;
  }
  return cleanText(raw); // Preserve ASAP and unknown date expressions; never guess a year.
}
export function normalize(source: Source, raw: {
  external_id: string; url: string; title: string; customer?: string | null; location?: string | null;
  deadline?: string | null; start_date?: string | null; extent?: string | null; description?: string | null;
}, now = new Date().toISOString()): Assignment {
  const text = (v?: string | null): string | null => v ? cleanText(v) || null : null;
  return AssignmentSchema.parse({ ...raw, source, external_id: raw.external_id.trim(), url: canonicalUrl(raw.url),
    title: cleanText(raw.title), customer: /^(private sector|privat sektor|ukjent|unknown|konfidensiell|confidential)$/i.test(text(raw.customer) ?? '') ? null : text(raw.customer), location: text(raw.location),
    deadline: dateValue(raw.deadline), start_date: dateValue(raw.start_date), extent: text(raw.extent),
    description: cleanText(raw.description ?? ''), first_seen_at: now, last_seen_at: now });
}
