import { EXPERIENCE_DATABASE } from './experience-db.js';
import type { CvTailorOutput } from './schemas.js';

export type CVValidationIssue = {
  severity: 'error' | 'warning';
  category:
    | 'chronology'
    | 'abbreviation'
    | 'unsupported_fact'
    | 'overclaim'
    | 'tone'
    | 'job_ad_mirroring'
    | 'format'
    | 'language'
    | 'experience_scope';
  message: string;
  location?: string;
  suggestedFix?: string;
};

interface ValidateOptions {
  language: 'no' | 'en';
  roleHint?: string | null;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  januar: 1,
  feb: 2,
  februar: 2,
  mar: 3,
  mars: 3,
  apr: 4,
  april: 4,
  may: 5,
  mai: 5,
  jun: 6,
  juni: 6,
  jul: 7,
  juli: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  okt: 10,
  oktober: 10,
  nov: 11,
  november: 11,
  dec: 12,
  des: 12,
  desember: 12,
};

const FORBIDDEN_SECTIONS = [
  'Treffanalyse',
  'Gap-analyse',
  'Spørsmål til kandidaten',
  'Spørsmål til Carl',
  'Forslag til vinkling',
  'Match-score',
];

const SOURCE_CERTIFICATIONS = extractTableColumn('## Sertifiseringer');
const SOURCE_TALKS = extractTableColumn('## Foredrag');
const SOURCE_EDUCATION = extractTableColumn('## Utdanning');

export function validateAndFinalizeCv(
  output: CvTailorOutput,
  options: ValidateOptions,
): { output: CvTailorOutput; issues: CVValidationIssue[] } {
  const issues: CVValidationIssue[] = [];
  const cv = structuredClone(output.cv);

  cv.title = cleanTitle(cv.title, cv.experience, options, issues);
  cv.profile = stripForbiddenSections(cleanText(cv.profile, options.language, issues, 'Profil'), issues, 'Profil');
  cv.coreCompetencies = cv.coreCompetencies
    .map(item => stripForbiddenSections(cleanText(item, options.language, issues, 'Kjernekompetanse'), issues, 'Kjernekompetanse'))
    .filter(Boolean)
    .slice(0, 8);

  const sortedExperience = [...cv.experience].sort((a, b) => comparePeriodsDesc(a.period, b.period));
  if (!sameExperienceOrder(cv.experience, sortedExperience)) {
    issues.push({
      severity: 'error',
      category: 'chronology',
      message: 'Experience sections are not sorted by start date descending.',
      location: 'Experience',
      suggestedFix: 'Reordered experience to strict reverse chronology.',
    });
    cv.experience = sortedExperience;
  }

  cv.experience = cv.experience.map((entry, index) => ({
    ...entry,
    role: cleanText(entry.role, options.language, issues, `Erfaring ${index + 1} rolle`),
    description: stripForbiddenSections(cleanText(entry.description, options.language, issues, `Erfaring ${index + 1}`), issues, `Erfaring ${index + 1}`),
    highlights: entry.highlights
      .map((highlight, highlightIndex) =>
        stripForbiddenSections(
          cleanText(highlight, options.language, issues, `Erfaring ${index + 1} bullet ${highlightIndex + 1}`),
          issues,
          `Erfaring ${index + 1} bullet ${highlightIndex + 1}`,
        )
      )
      .filter(Boolean),
  }));

  cv.previousExperienceSummary = normalizePreviousExperienceSummary(
    cv.previousExperienceSummary ?? null,
    cv.experience,
    options.language,
    issues,
  );

  cv.education = filterSupportedList(cv.education, SOURCE_EDUCATION, issues, 'Utdanning');
  cv.certifications = filterSupportedList(cv.certifications, SOURCE_CERTIFICATIONS, issues, 'Sertifiseringer');
  cv.talks = filterSupportedList(cv.talks, SOURCE_TALKS, issues, 'Foredrag');
  cv.languages = cv.languages
    .filter((language) => {
      if (/\bgrunnleggende\b|\bbasic\b/i.test(language)) {
        issues.push({
          severity: 'warning',
          category: 'language',
          message: `Removed non-professional language level: ${language}.`,
          location: 'Språk',
          suggestedFix: 'Keep only professional language levels or better.',
        });
        return false;
      }
      return true;
    })
    .map(language => cleanText(language, options.language, issues, 'Språk'));

  const finalOutput: CvTailorOutput = {
    ...output,
    cv,
  };

  return { output: finalOutput, issues };
}

function cleanTitle(
  title: string,
  experience: CvTailorOutput['cv']['experience'],
  options: ValidateOptions,
  issues: CVValidationIssue[],
): string {
  let next = title.trim();

  if ((next.match(/\|/g) ?? []).length > 1) {
    const parts = next.split('|').map(part => part.trim()).filter(Boolean);
    next = `${parts[0]} | ${parts.slice(1).join(' ')}`;
    issues.push({
      severity: 'warning',
      category: 'format',
      message: 'CV title used more than one pipe separator.',
      location: 'Tittel',
      suggestedFix: 'Collapsed title to a single pipe separator.',
    });
  }

  const candidateTitle = inferCandidatePositioning(experience);
  const leftSegment = next.split('|')[0]?.trim() ?? next;
  const normalizedRoles = experience.map(entry => normalize(leftSegmentMatchSource(entry.role)));

  if (shouldReplaceTitle(leftSegment, normalizedRoles, options.roleHint)) {
    issues.push({
      severity: 'warning',
      category: 'job_ad_mirroring',
      message: `Title "${leftSegment}" looks closer to the target role than the candidate's documented positioning.`,
      location: 'Tittel',
      suggestedFix: `Use "${candidateTitle}" instead.`,
    });
    next = candidateTitle;
  }

  return cleanText(next, options.language, issues, 'Tittel');
}

function shouldReplaceTitle(leftSegment: string, supportedRoles: string[], roleHint?: string | null): boolean {
  const normalizedLeft = normalize(leftSegment);
  if (!normalizedLeft) return true;

  const looksSupported = supportedRoles.some((role) => role.includes(normalizedLeft) || normalizedLeft.includes(role));
  if (looksSupported) return false;

  if (roleHint && normalize(roleHint) === normalizedLeft) {
    return true;
  }

  return /\bdelivery\b|\blead\b|\bhead\b/i.test(leftSegment);
}

function inferCandidatePositioning(experience: CvTailorOutput['cv']['experience']): string {
  const roleText = experience.map(entry => entry.role.toLowerCase()).join(' | ');
  const hasProduct = roleText.includes('produktleder');
  const hasDelivery = roleText.includes('teamleder')
    || roleText.includes('områdeleder')
    || roleText.includes('releaseleder')
    || roleText.includes('smidig coach')
    || roleText.includes('leveranse');
  const hasPayment = experience.some(entry =>
    /bank|betaling|transaksjon|mobilbank/i.test(`${entry.company} ${entry.role} ${entry.description}`)
  );

  const prefix = hasProduct && hasDelivery
    ? 'Produkt- og leveranseleder'
    : hasProduct
      ? 'Produktleder'
      : hasDelivery
        ? 'Leveranseleder'
        : 'Erfaren leder';

  const suffix = hasPayment ? 'Bank og regulerte teknologimiljøer' : 'Komplekse teknologimiljøer';
  return `${prefix} | ${suffix}`;
}

function normalizePreviousExperienceSummary(
  summary: string | null,
  experience: CvTailorOutput['cv']['experience'],
  language: 'no' | 'en',
  issues: CVValidationIssue[],
): string | null {
  const oldestStartYear = experience.reduce((min, entry) => Math.min(min, parsePeriod(entry.period).year), Number.POSITIVE_INFINITY);

  if (summary) {
    return stripForbiddenSections(cleanText(summary, language, issues, 'Tidligere erfaring'), issues, 'Tidligere erfaring');
  }

  if (oldestStartYear >= 2014) {
    issues.push({
      severity: 'warning',
      category: 'experience_scope',
      message: 'Added a short previous experience summary to preserve older breadth without expanding older roles.',
      location: 'Tidligere erfaring',
      suggestedFix: 'Keep older experience as a compact summary below detailed roles.',
    });
    return 'Tidligere erfaring fra test, kvalitetssikring og leveranse i bank, finans og offentlig sektor, blant annet for Nets/BBS, EVRY, SEB, Handelsbanken og Domstoladministrasjonen.';
  }

  return null;
}

function cleanText(
  value: string,
  language: 'no' | 'en',
  issues: CVValidationIssue[],
  location: string,
): string {
  let next = value.trim();
  const original = next;

  const replacements: Array<[RegExp, string, CVValidationIssue['category'], string]> = [
    [/\bBM Mobilbank\b/g, 'Mobilbank Bedrift', 'abbreviation', 'Spelled out "BM Mobilbank".'],
    [/\bPRs\b/g, 'pull requests', 'abbreviation', 'Spelled out "PRs".'],
    [/\bWIP\b/g, 'pågående arbeid', 'abbreviation', 'Replaced "WIP" with plain language.'],
    [/\bAEM\b/g, 'Adobe Experience Manager', 'abbreviation', 'Spelled out "AEM".'],
    [/\bCSPO\b/g, 'Certified Scrum Product Owner', 'abbreviation', 'Spelled out "CSPO".'],
    [/\bStoppet parallelt arbeid\b/gi, 'Reduserte parallelt arbeid', 'overclaim', 'Softened "Stoppet parallelt arbeid".'],
    [/\bGjennomførte migrering\b/gi, 'Koordinerte migrering', 'overclaim', 'Softened "Gjennomførte migrering".'],
    [/\bDrev gjennom\b/gi, 'Ledet arbeidet med', 'overclaim', 'Softened "Drev gjennom".'],
    [/\bEide\b/gi, 'Hadde ansvar for', 'overclaim', 'Softened "Eide".'],
    [/første bank i Norge/gi, 'en tidlig løsning av sitt slag i Norge', 'overclaim', 'Softened "første bank i Norge".'],
    [/fra scratch/gi, 'fra tidligfase', 'tone', 'Replaced colloquial "fra scratch".'],
    [/få ting gjort/gi, 'skape fremdrift', 'tone', 'Replaced colloquial "få ting gjort".'],
    [/dårlig stemning/gi, 'en teamfase preget av endring', 'tone', 'Softened "dårlig stemning".'],
    [/kaotisk team/gi, 'teamfase preget av endring', 'tone', 'Softened "kaotisk team".'],
    [/testrapporter ingen leste/gi, 'rapportering som ikke ga beslutningsverdi', 'tone', 'Replaced internal phrasing.'],
    [/\bpioneerte\b/gi, 'innførte', 'tone', 'Replaced "pioneerte".'],
    [/Monday commitment/gi, 'ukentlig arbeidsrytme', 'tone', 'Replaced internal shorthand.'],
    [/Friday wins/gi, 'synlig fremdrift', 'tone', 'Replaced internal shorthand.'],
    [/bugs til bugfixes/gi, 'raskere feilretting', 'tone', 'Replaced internal shorthand.'],
  ];

  for (const [pattern, replacement, category, message] of replacements) {
    if (pattern.test(next)) {
      next = next.replace(pattern, replacement);
      issues.push({
        severity: category === 'abbreviation' ? 'warning' : 'warning',
        category,
        message,
        location,
      });
    }
  }

  if (language === 'no' && /[öä]/i.test(next)) {
    const before = next;
    next = next.replace(/ö/g, 'ø').replace(/Ö/g, 'Ø').replace(/ä/g, 'æ').replace(/Ä/g, 'Æ');
    if (next !== before) {
      issues.push({
        severity: 'warning',
        category: 'language',
        message: 'Normalized Swedish characters to Norwegian orthography.',
        location,
      });
    }
  }

  if (original !== next) {
    next = next.replace(/\s{2,}/g, ' ').trim();
  }

  return next;
}

function stripForbiddenSections(value: string, issues: CVValidationIssue[], location: string): string {
  let next = value;

  for (const section of FORBIDDEN_SECTIONS) {
    if (next.includes(section)) {
      next = next
        .split('\n')
        .filter(line => !line.includes(section))
        .join('\n')
        .trim();
      issues.push({
        severity: 'error',
        category: 'format',
        message: `Removed internal analysis marker "${section}" from final CV text.`,
        location,
      });
    }
  }

  return next;
}

function filterSupportedList(
  items: string[],
  sourceItems: string[],
  issues: CVValidationIssue[],
  location: string,
): string[] {
  return items.filter((item) => {
    const normalizedItem = normalize(item);
    const supported = sourceItems.some(source => normalize(source).includes(normalizedItem) || normalizedItem.includes(normalize(source)));
    if (!supported) {
      issues.push({
        severity: 'warning',
        category: 'unsupported_fact',
        message: `Removed unsupported entry from ${location}: ${item}.`,
        location,
        suggestedFix: 'Keep only items explicitly present in the source data.',
      });
    }
    return supported;
  });
}

function sameExperienceOrder(
  left: CvTailorOutput['cv']['experience'],
  right: CvTailorOutput['cv']['experience'],
): boolean {
  return left.every((entry, index) => entry.company === right[index]?.company && entry.role === right[index]?.role && entry.period === right[index]?.period);
}

function comparePeriodsDesc(left: string, right: string): number {
  const a = parsePeriod(left);
  const b = parsePeriod(right);
  if (a.year !== b.year) return b.year - a.year;
  return b.month - a.month;
}

function parsePeriod(period: string): { year: number; month: number } {
  const [start] = period.split(/[–-]/).map(part => part.trim());
  const match = start.match(/([A-Za-zæøåÆØÅ]+)?\s*(\d{4})/);
  if (!match) return { year: 0, month: 0 };
  const month = match[1] ? MONTHS[match[1].toLowerCase()] ?? 0 : 0;
  return { year: Number(match[2]), month };
}

function extractTableColumn(heading: string): string[] {
  const start = EXPERIENCE_DATABASE.indexOf(heading);
  if (start < 0) return [];
  const rest = EXPERIENCE_DATABASE.slice(start).split('\n');
  const values: string[] = [];

  for (const line of rest.slice(3)) {
    if (!line.startsWith('|')) break;
    const cells = line.split('|').map(cell => cell.trim()).filter(Boolean);
    if (cells.length > 0) {
      values.push(cells[0]);
    }
  }

  return values;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function leftSegmentMatchSource(value: string): string {
  return value.split(/[|—,-]/)[0]?.trim() ?? value;
}
