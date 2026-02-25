import type { SupabaseClient } from '@supabase/supabase-js';
import type { Learning } from './extraction.js';

// --- Feature #8: Reaction mining ---

export interface ReactionSummary {
  positive: number;
  negative: number;
  topPositive: string[];
  topNegative: string[];
}

const POSITIVE_REACTIONS = new Set([
  'thumbsup', '+1', 'heart', 'fire', 'yum', 'star', 'tada',
  'raised_hands', 'clap', 'ok_hand', 'muscle', 'chef_kiss',
]);

const NEGATIVE_REACTIONS = new Set([
  'thumbsdown', '-1', 'confused', 'disappointed', 'cry',
  'face_with_rolling_eyes', 'unamused', 'grimacing', 'nauseated_face',
]);

export async function loadReactionSummary(supabase: SupabaseClient): Promise<ReactionSummary | null> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const { data: reactions } = await supabase
    .from('message_reactions')
    .select('reaction')
    .eq('household_id', 'default')
    .gte('created_at', cutoff.toISOString());

  if (!reactions || reactions.length < 3) return null;

  let positive = 0;
  let negative = 0;
  const positiveCounts = new Map<string, number>();
  const negativeCounts = new Map<string, number>();

  for (const r of reactions) {
    const reaction = r.reaction as string;
    if (POSITIVE_REACTIONS.has(reaction)) {
      positive++;
      positiveCounts.set(reaction, (positiveCounts.get(reaction) ?? 0) + 1);
    } else if (NEGATIVE_REACTIONS.has(reaction)) {
      negative++;
      negativeCounts.set(reaction, (negativeCounts.get(reaction) ?? 0) + 1);
    }
  }

  if (positive + negative < 3) return null;

  const topPositive = [...positiveCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([r]) => r);

  const topNegative = [...negativeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([r]) => r);

  return { positive, negative, topPositive, topNegative };
}

export function buildReactionSummarySection(summary: ReactionSummary | null): string | null {
  if (!summary) return null;

  const total = summary.positive + summary.negative;
  const posRate = total > 0 ? ((summary.positive / total) * 100).toFixed(0) : '0';

  const lines: string[] = [
    '## Reaksjonssignal',
    `Siste 30 dager: ${summary.positive} positive, ${summary.negative} negative reaksjoner (${posRate}% positive).`,
  ];

  if (summary.topPositive.length > 0) {
    lines.push(`Vanligste positive: ${summary.topPositive.map(r => `:${r}:`).join(', ')}`);
  }
  if (summary.topNegative.length > 0) {
    lines.push(`Vanligste negative: ${summary.topNegative.map(r => `:${r}:`).join(', ')}`);
  }

  lines.push('\nBruk reaksjonene som signal pa om svarene dine treffer godt.');
  return lines.join('\n');
}

// --- Feature #3: Knowledge gap detection ---

export interface KnowledgeGap {
  category: string;
  priority: number;
  question: string;
}

interface KnowledgeGapDef {
  category: string;
  priority: number;
  prefKeys: string[];
  keywords: string[];
  question: string;
}

const KNOWLEDGE_CATEGORIES: KnowledgeGapDef[] = [
  { category: 'allergier', priority: 1, prefKeys: ['allergies', 'allergi'], keywords: ['allergi', 'intoleranse'], question: 'Har noen i familien allergier eller intoleranser?' },
  { category: 'familiestorrelse', priority: 1, prefKeys: ['adults', 'children', 'family_size'], keywords: ['barn', 'voksne', 'personer'], question: 'Hvor mange voksne og barn er dere?' },
  { category: 'tidsbruk', priority: 2, prefKeys: ['cooking_time', 'max_time'], keywords: ['minutter', 'rask', 'tid', 'travelt'], question: 'Hvor lang tid har dere vanligvis til middag pa hverdager?' },
  { category: 'misliker', priority: 2, prefKeys: ['dislikes', 'avoid'], keywords: ['misliker', 'liker ikke', 'unnga'], question: 'Er det noe dere absolutt ikke liker eller vil unnga?' },
  { category: 'budsjett', priority: 3, prefKeys: ['budget'], keywords: ['budsjett', 'billig', 'spare'], question: 'Har dere et matbudsjett per uke?' },
  { category: 'kokeerfaring', priority: 3, prefKeys: ['cooking_skill', 'skill_level'], keywords: ['nybegynner', 'erfaren', 'kokeerfaring'], question: 'Hvordan vil dere beskrive kokeerfaringen i husholdningen?' },
];

export function detectKnowledgeGaps(
  learnings: Learning[],
  preferences: Array<{ key: string; value: unknown }>,
): KnowledgeGap[] {
  const gaps: KnowledgeGap[] = [];
  const prefKeySet = new Set(preferences.map(p => p.key.toLowerCase()));
  const allInsights = learnings.map(l => l.insight.toLowerCase()).join(' ');

  for (const def of KNOWLEDGE_CATEGORIES) {
    const hasPref = def.prefKeys.some(k => prefKeySet.has(k));
    const hasLearning = def.keywords.some(kw => allInsights.includes(kw));

    if (!hasPref && !hasLearning) {
      gaps.push({
        category: def.category,
        priority: def.priority,
        question: def.question,
      });
    }
  }

  return gaps.sort((a, b) => a.priority - b.priority);
}

export function buildKnowledgeGapsSection(gaps: KnowledgeGap[]): string | null {
  if (gaps.length === 0) return null;

  const top = gaps.slice(0, 3);
  const lines: string[] = [
    '## Kunnskapshull',
    'Du mangler viktig informasjon om familien. Still ETT sporsmal nar det er naturlig — ikke kok over.\n',
  ];
  for (const g of top) {
    lines.push(`- ${g.category}: "${g.question}"`);
  }
  return lines.join('\n');
}
