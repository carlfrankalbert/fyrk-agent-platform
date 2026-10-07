import type { Assignment, Profile, Score } from './schemas.js';
import { experienceProfile, experienceEvidence, domainEvidence, experienceLimits } from './experience-profile.js';

export function folded(s: string): string { return s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ø/g, 'o').replace(/[^a-z0-9%]+/g, ' ').trim(); }
const ROLES: [string, RegExp][] = [
  ['product', /produktleder|produkteier|product manager|product owner|produktcoach|product coach/],
  ['test', /testleder|test manager|testledelse|testressurs|testanalytiker|qa(?: |$)|kvalitetsleder|quality manager/],
  ['delivery', /prosjektleder|project manager|leveranseleder|delivery manager/],
  ['advisor', /radgiver|advisor|adviser|konsulent/],
];
export function role(s: string): string | null { const t = folded(s); return ROLES.find(([, r]) => r.test(t))?.[0] ?? null; }
export function requirements(description: string): { required: string[]; desired: string[] } {
  const required: string[] = [], desired: string[] = [];
  let mode: 'required' | 'desired' | null = null;
  for (const line of description.split(/\n|(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)) {
    const t = folded(line);
    if (/(skal krav|obligatoriske krav|^ma ha(?: krav)?$|^krav$|must have|mandatory|^(?:key )?requirements|kompetansekrav|^felles krav)/.test(t) && line.length < 160) {
      mode = 'required';
      const rest = line.includes(':') ? line.slice(line.indexOf(':') + 1).trim() : '';
      if (rest) required.push(rest);
      continue;
    }
    if (/(bor (?:ha )?krav|^fordelaktig a ha$|onskede krav|onskede kvalifikasjoner|nice to have|^preferred|onsket kompetanse)/.test(t) && line.length < 160) { mode = 'desired'; continue; }
    if (/^(oppstart|varighet|omfang|oppdragsdetaljer|assignment description|oppdragsbeskrivelse|ansvarsomrader|responsibilities|kontaktperson|detaljer|vi tilbyr|vi ser etter)/.test(t) || /oppgaver$/.test(t)) mode = null;
    if (/must|required|obligatorisk|minimum|ma ha|skal ha/.test(t)) required.push(line);
    else if (/onskelig|fordel|preferred|nice to have|bor ha/.test(t)) desired.push(line);
    else if (mode) (mode === 'required' ? required : desired).push(line);
  }
  return { required: [...new Set(required)], desired: [...new Set(desired)] };
}
export function assessRequirement(line: string): { supported: boolean; evidence: string[]; limits: string[] } {
  const t = folded(line);
  const limits = experienceLimits(t);
  const matches = experienceEvidence.filter(e => e.match.test(t));
  // Specific unsupported qualifications must not inherit support from a generic word like "Scrum".
  const unsupported = /\b(?:pmp|sap|frosio|offshore|fdvu|eam|erp)\b|prince2 practitioner|sikkerhetsklar|security clearance|istqb expert/.test(t) ||
    (/\bsafe\b/.test(t) && !/scrum.*(?:eller|or|tilsvarende)/.test(t));
  return { supported: !unsupported && !limits.length && matches.length > 0, evidence: matches.map(e => e.text), limits };
}
export function scoreAssignment(a: Assignment, profile: Profile, today = new Date().toISOString().slice(0, 10)): Score {
  const t = folded(`${a.title} ${a.description}`), r = role(a.title);
  const advisorRelevant = r === 'advisor' && /produkt|digital|smidig|test|kvalitet|forretning/.test(t);
  const relevant = !!r && (r !== 'advisor' || advisorRelevant);
  const req = requirements(a.description), missing = req.required.filter(s => !assessRequirement(s).supported);
  const desiredMissing = req.desired.filter(s => !assessRequirement(s).supported);
  const domains = domainEvidence.filter(e => e.match.test(t));
  const evidence = experienceEvidence.filter(e => e.match.test(t) && !['languages', 'education', 'staffing'].includes(e.id));
  const reasons: string[] = [], gaps: string[] = [];
  const extent = a.extent?.match(/(\d+)\s*%/);
  const locationMatch = !!a.location && (profile.preferredLocations.some(l => folded(a.location!).includes(folded(l))) || /remote|hjemmekontor|fjernarbeid/.test(folded(a.location)));
  const breakdown = {
    role: relevant ? (advisorRelevant ? 20 : 30) : 0,
    domain: domains.length ? 15 : 5,
    seniority: /senior|erfaren|experienced/.test(t) ? 10 : /junior/.test(t) ? 0 : 5,
    location: locationMatch ? 10 : a.location ? 0 : 5,
    extent: extent ? (Number(extent[1]) <= profile.maxExtent ? 5 : 0) : 2,
    mandatory: req.required.length ? Math.round(10 * (1 - missing.length / req.required.length)) : 5,
    desired: req.desired.length ? Math.round(5 * (1 - desiredMissing.length / req.desired.length)) : 2,
    experience: evidence.length ? 5 : 0,
  };
  if (relevant) reasons.push(`Rolle samsvarer med Carls erfaring innen ${r === 'product' ? 'produktledelse' : r === 'test' ? 'testledelse' : r === 'delivery' ? 'prosjekt og leveranse' : 'rådgivning'}.`);
  // Keep Slack assessments concrete and short; evidence names the actual project/qualification.
  const examples = [...new Set([...domains.map(e => e.text), ...evidence.map(e => e.text)])].slice(0, 2);
  reasons.push(...examples.map(text => `Erfaringsmatch: ${text}`));
  if (!locationMatch) gaps.push(a.location ? `Avklar arbeidssted: ${a.location}.` : 'Arbeidssted er ukjent.');
  if (!extent) gaps.push('Omfang er ikke oppgitt i prosent.');
  else if (Number(extent[1]) > profile.maxExtent) gaps.push('Omfang overstiger konfigurert kapasitet.');
  gaps.unshift(...missing.map(s => `Obligatorisk krav ikke dokumentert: ${s}`));
  gaps.unshift(...[...new Set(missing.flatMap(s => assessRequirement(s).limits))]);
  gaps.push(...desiredMissing.slice(0, 3).map(s => `Ønsket krav ikke dokumentert: ${s}`));
  if (!req.required.length) gaps.push('Obligatoriske krav er ikke tydelig identifisert.');
  // Preserve the relative weights of the remaining factors on the 0–100 scale.
  let total = Math.round(Object.values(breakdown).reduce((sum, n) => sum + n, 0) * 100 / 90);
  if (!relevant) total = Math.min(total, 30);
  if (/offshore|frosio|civil structural|mekanisk|mechanical|bygg og anlegg/.test(t) && !/testled|digitalisering|bank|produktled/.test(t)) total = Math.min(total, 55);
  if (missing.length) total = Math.min(total, 55);
  // A former client in the profile is evidence of experience, but not automatically a prospect.
  const customer = folded(a.customer ?? '');
  const excludedCustomer = experienceProfile.excludedCustomers.some(name => customer === folded(name)) ||
    /^(?:sparebank 1|sb1 utvikling)(?:\s|$)/.test(customer);
  if (excludedCustomer) { total = 0; gaps.unshift('SpareBank 1 er ikke aktuell som oppdragsgiver ifølge erfaringsbasen.'); }
  const expired = !!a.deadline && /^\d{4}-\d{2}-\d{2}$/.test(a.deadline) && a.deadline < today;
  if (expired) { total = 0; gaps.unshift('Søknadsfristen har gått ut.'); }
  return { total, relevant: relevant && !expired && !excludedCustomer, breakdown, reasons, gaps,
    action: expired || excludedCustomer ? 'Arkiver treffet.' : missing.length ? 'Avklar obligatoriske krav med megler før søknad.' : 'Kontroller krav, og vurder å melde interesse.' };
}
