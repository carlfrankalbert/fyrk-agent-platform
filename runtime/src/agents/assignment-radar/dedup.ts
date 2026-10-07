import { canonicalUrl } from './normalize.js';
import { folded, role } from './score.js';
import type { Assignment, StoredAssignment } from './schemas.js';

function tokens(s: string): Set<string> { return new Set(folded(s).split(' ').filter(w => w.length > 2 && !['for','med','som','the','and','til','will','skal'].includes(w))); }
export function similarity(a: string, b: string): number {
  const x = tokens(a), y = tokens(b);
  if (!x.size || !y.size) return 0;
  const intersection = [...x].filter(w => y.has(w)).length;
  return intersection / new Set([...x, ...y]).size;
}
export type MatchReason = 'external_id' | 'canonical_url' | 'customer_role_period' | 'text';
export function duplicateReason(a: Assignment, b: Assignment): MatchReason | null {
  if (a.source === b.source && a.external_id === b.external_id) return 'external_id';
  if (canonicalUrl(a.url) === canonicalUrl(b.url)) return 'canonical_url';
  const customerA = a.customer ? folded(a.customer).replace(/\b(as|asa|sf)\b/g, '').trim() : '';
  const customerB = b.customer ? folded(b.customer).replace(/\b(as|asa|sf)\b/g, '').trim() : '';
  // Public procurements can name the purchasing agency in one portal and the end customer in another.
  const endCustomerInTitle = customerA && customerB && customerA !== customerB &&
    (folded(a.title).includes(customerB) || folded(b.title).includes(customerA));
  if (customerA && customerB && customerA !== customerB && !endCustomerInTitle) return null;
  const period = (date: string | null): string | null => {
    if (!date) return null;
    const iso = date.match(/^(\d{4}-\d{2})/); if (iso) return iso[1];
    const months = ['jan','feb','mar','apr','mai','jun','jul','aug','sep','okt','nov','des'];
    const m = date.toLowerCase().match(/\b([a-z]{3})[a-z.]*\s+(\d{4})\b/);
    return m && months.includes(m[1]) ? `${m[2]}-${String(months.indexOf(m[1]) + 1).padStart(2, '0')}` : null;
  };
  const periodA = period(a.start_date), periodB = period(b.start_date);
  if (periodA && periodB && periodA !== periodB) return null;
  const dateA = a.start_date && /^\d{4}-\d{2}-\d{2}$/.test(a.start_date) ? a.start_date : null;
  const dateB = b.start_date && /^\d{4}-\d{2}-\d{2}$/.test(b.start_date) ? b.start_date : null;
  if (dateA && dateB && Math.abs(Date.parse(dateA) - Date.parse(dateB)) > 21 * 86400000) return null;
  const title = similarity(a.title, b.title), description = similarity(a.description, b.description);
  const distinctive = (s: string): Set<string> => tokens(s.replace(/senior|produktleder|produkteier|product manager|product owner|testleder|test manager|prosjektleder|project manager|leveranseleder|delivery manager/gi, ''));
  const contextA = distinctive(a.title), contextB = distinctive(b.title);
  // Project acronyms/reference numbers are stronger than generic role words.
  const projectKeys = (s: string): Set<string> => new Set([...s.matchAll(/\b(?:[A-ZÆØÅ]{3,12}|P\d{4,}|[A-Z]{2,}[-/]\d{3,})\b/g)]
    .map(m => m[0]).filter(w => !['ERP','EAM','SAP','API','SQL','AWS','CRM','QA','ISTQB','NATO','SCRUM','SAFE','HTML','HTTP','HTTPS'].includes(w)));
  const projectA = projectKeys(`${a.title} ${a.description}`), projectB = projectKeys(`${b.title} ${b.description}`);
  const sharedProject = [...projectA].some(w => projectB.has(w));
  const sameCustomer = (customerA && customerA === customerB) || endCustomerInTitle;
  const sameRole = role(a.title) && role(a.title) === role(b.title);
  if (sameCustomer && sameRole && periodA && periodA === periodB && sharedProject && description >= 0.15) return 'customer_role_period';
  const sharedContext = [...contextA].filter(w => contextB.has(w)).length >= 2;
  // Customer/role/start alone is too coarse: distinct teams can recruit the same role.
  if (customerA && customerA === customerB && role(a.title) && role(a.title) === role(b.title) && dateA && dateB
      && (description >= 0.45 || (title >= 0.7 && sharedContext))) return 'customer_role_period';
  if (endCustomerInTitle && sharedContext && role(a.title) === role(b.title) && role(a.title) && description >= 0.32) return 'text';
  if (tokens(a.description).size >= 25 && tokens(b.description).size >= 25 && description >= 0.72 && title >= 0.55) return 'text';
  return null;
}
export function findDuplicate(a: Assignment, stored: StoredAssignment[]): { record: StoredAssignment; reason: MatchReason } | null {
  // Exact identity must win over a fuzzy match regardless of candidate order.
  for (const stage of ['external_id', 'canonical_url', 'customer_role_period', 'text'] as const) {
    for (const record of stored) if (record.observations.some(b => duplicateReason(a, b) === stage)) return { record, reason: stage };
  }
  return null;
}
export function mergeObservation(record: StoredAssignment, a: Assignment): StoredAssignment {
  const existing = record.observations.find(b => a.source === b.source && a.external_id === b.external_id);
  const observation = { ...a, first_seen_at: existing?.first_seen_at ?? a.first_seen_at };
  const observations = record.observations.filter(b => !(a.source === b.source && a.external_id === b.external_id)).concat(observation);
  // Preserve the richest description and fill missing canonical metadata from other portals.
  const assignment = { ...record.assignment, last_seen_at: a.last_seen_at };
  for (const key of ['customer','location','deadline','start_date','extent'] as const) if (!assignment[key]) assignment[key] = a[key];
  if (a.description.length > assignment.description.length) assignment.description = a.description;
  if (a.source === assignment.source && a.external_id === assignment.external_id) {
    Object.assign(assignment, observation, { first_seen_at: assignment.first_seen_at });
  }
  return { ...record, assignment, observations };
}
