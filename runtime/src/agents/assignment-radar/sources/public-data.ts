import type { Fetcher } from './common.js';

// Public APIs only: no cookies, tokens or browser session are needed.
export async function getJson(fetcher: Fetcher, url: string, body?: unknown): Promise<unknown> {
  const response = await fetcher(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'User-Agent': 'FYRK-Assignment-Radar/1.0', 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
export function textField(text: string, labels: string): string | null {
  return text.match(new RegExp(`(?:^|\\n)(?:${labels})\\s*:\\s*([^\\n]+)`, 'i'))?.[1]?.trim() || null;
}
export function metadata(text: string): { customer: string | null; location: string | null; start_date: string | null; deadline: string | null; extent: string | null } {
  return {
    customer: textField(text, 'Kunde|Oppdragsgiver|Customer|Client'),
    location: textField(text, 'Lokasjon|Arbeidssted|Locations?'),
    start_date: textField(text, 'Oppstart(?:sdato)?|Start(?: date)?|Oppdragsperiode|Assignment period'),
    deadline: textField(text, '(?:Intern )?Søknadsfrist|Svarfrist|Frist|(?:Application )?Deadline'),
    extent: textField(text, 'Omfang(?: og varighet)?|Stillingsprosent|Workload|Allocation'),
  };
}
export function checkPage(ids: string[], seen: Set<string>): void {
  if (ids.some(id => seen.has(id))) throw new Error('Repeated listing page; pagination incomplete');
  ids.forEach(id => seen.add(id));
}
