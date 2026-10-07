import { load } from 'cheerio';
import { z } from 'zod';
import { normalize } from '../normalize.js';
import type { Assignment } from '../schemas.js';
import { getText, links, fetchDetails, fields, requireListing, type SourceAdapter } from './common.js';

// Next RSC carries the complete article before hydration. Parse JSON, never eval scripts.
export function rscArticle(html: string): { html: string; props: Record<string, unknown> } {
  const chunks: string[] = [];
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g)) chunks.push(JSON.parse(m[1]) as string);
  const nodes: unknown[] = [];
  const references = new Map<string, unknown>();
  for (const line of chunks.join('').split('\n')) {
    const m = line.match(/^([\da-f]+):(.*)$/);
    if (m) { try { const value: unknown = JSON.parse(m[2]); nodes.push(value); references.set(m[1], value); } catch { /* non-JSON RSC record */ } }
  }
  const articles: unknown[] = [];
  let props: Record<string, unknown> = {};
  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (node[0] === '$' && typeof node[3] === 'object' && node[3]) {
      const v = node[3] as Record<string, unknown>;
      if (node[1] === 'article') articles.push(node);
      if (typeof v.assignmentId === 'string') props.externalId = v.assignmentId;
      if (typeof v.title === 'string' && typeof v.deadline === 'string' && v.startDate) props = { ...props, ...v };
      walk(v.children);
    } else node.forEach(walk);
  };
  nodes.forEach(walk);
  const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const render = (node: unknown): string => {
    if (typeof node === 'string') {
      if (/^\$L?[\da-f]+$/.test(node)) return render(references.get(node.replace(/^\$L?/, '')));
      return node.startsWith('$') ? '' : escape(node);
    }
    if (!Array.isArray(node)) return '';
    if (node[0] === '$') {
      const v = node[3] as Record<string, unknown> | null;
      const tag = typeof node[1] === 'string' && /^[a-z][a-z0-9]*$/.test(node[1]) ? node[1] : 'div';
      if (['script', 'style'].includes(tag)) return '';
      return `<${tag}>${render(v?.children)}</${tag}>`;
    }
    return node.map(render).join('');
  };
  return { html: articles.map(render).sort((a, b) => b.length - a.length)[0] ?? '', props };
}
export function parseIc(html: string, url: string, now: string): Assignment {
  const rsc = rscArticle(html), $ = load(rsc.html || html), f = fields(rsc.html || html);
  const title = z.string().min(1).parse(rsc.props.title ?? $('article h1, main h1').first().text().trim());
  const description = $('article').text() || $('main').text();
  if (!description.trim()) throw new Error('IC article missing');
  return normalize('ic', { external_id: typeof rsc.props.externalId === 'string' ? rsc.props.externalId : new URL(url).pathname.split('/').pop()!, url, title,
    customer: f.oppdragsgiver, location: rsc.props.location as string | undefined ?? f.lokasjon,
    deadline: rsc.props.deadline as string | undefined ?? f.søknadsfrist,
    start_date: rsc.props.startDate as string | undefined ?? f.oppstartsdato,
    extent: description.match(/(?:Stillingsprosent|Omfang):\s*([^\n]+?%)/i)?.[1] ?? f.omfang,
    description: rsc.html || $('main').html() || '' }, now);
}
export const icAdapter: SourceAdapter = { source: 'ic', async fetch(fetcher, now) {
  const url = 'https://www.ic.no/oppdrag', html = await getText(fetcher, url);
  const urls = links(html, url, /^\/oppdrag\/[^/]+$/);
  requireListing(urls, html, /Ingen aktive oppdrag|0 oppdrag/i);
  return fetchDetails(urls, fetcher, (body, detail) => parseIc(body, detail, now));
} };
