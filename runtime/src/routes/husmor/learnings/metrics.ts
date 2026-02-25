import type { SupabaseClient } from '@supabase/supabase-js';
import { DAY_NAMES } from '../../../lib/constants.js';

// --- Feature #1: Suggestion metrics ---

export interface SuggestionMetrics {
  totalSuggested: number;
  accepted: number;
  modified: number;
  removed: number;
  acceptanceRate: number;
  categoryBreakdown: Record<string, { suggested: number; accepted: number }>;
}

const MEAL_CATEGORIES: Record<string, string[]> = {
  fisk: ['laks', 'torsk', 'sei', 'kveite', 'orret', 'makrell', 'sild', 'reke', 'fisk'],
  vegetar: ['vegetar', 'vegan', 'gronnsaksburger', 'linse', 'kikert', 'bonne', 'tofu'],
  rodt_kjott: ['biff', 'storfe', 'svin', 'lam', 'kjottdeig', 'karbonade'],
  kylling: ['kylling', 'kalkun', 'fjaerekre'],
};

function categorizeMeal(name: string): string {
  const lower = name.toLowerCase();
  for (const [cat, keywords] of Object.entries(MEAL_CATEGORIES)) {
    if (keywords.some(kw => lower.includes(kw))) return cat;
  }
  return 'annet';
}

export async function computeSuggestionMetrics(supabase: SupabaseClient): Promise<SuggestionMetrics | null> {
  // Get plans from last 12 weeks
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 84);

  const { data: plans } = await supabase
    .from('weekly_plans')
    .select('id')
    .eq('household_id', 'default')
    .gte('created_at', cutoff.toISOString());

  if (!plans || plans.length === 0) return null;

  const planIds = plans.map((p: { id: string }) => p.id);

  const { data: meals } = await supabase
    .from('planned_meals')
    .select('name, suggested_by, original_suggestion')
    .eq('suggested_by', 'husmor')
    .in('plan_id', planIds);

  if (!meals || meals.length < 3) return null;

  const { data: modifications } = await supabase
    .from('suggestion_modifications')
    .select('original_meal, replacement_meal')
    .eq('household_id', 'default')
    .in('plan_id', planIds);

  const modSet = new Set((modifications ?? []).map((m: { original_meal: string }) => m.original_meal));
  const removals = (modifications ?? []).filter((m: { replacement_meal: string | null }) => m.replacement_meal === null);
  const changes = (modifications ?? []).filter((m: { replacement_meal: string | null }) => m.replacement_meal !== null);

  const totalSuggested = meals.length;
  const modified = changes.length;
  const removed = removals.length;
  const accepted = totalSuggested - modified - removed;

  const categoryBreakdown: Record<string, { suggested: number; accepted: number }> = {};
  for (const meal of meals) {
    const cat = categorizeMeal(meal.name as string);
    if (!categoryBreakdown[cat]) categoryBreakdown[cat] = { suggested: 0, accepted: 0 };
    categoryBreakdown[cat].suggested++;
    if (!modSet.has(meal.name as string)) {
      categoryBreakdown[cat].accepted++;
    }
  }

  return {
    totalSuggested,
    accepted,
    modified,
    removed,
    acceptanceRate: totalSuggested > 0 ? accepted / totalSuggested : 0,
    categoryBreakdown,
  };
}

const CATEGORY_DISPLAY: Record<string, string> = {
  fisk: 'Fisk',
  vegetar: 'Vegetar',
  rodt_kjott: 'Rodt kjott',
  kylling: 'Kylling',
  annet: 'Annet',
};

export function buildSuggestionMetricsSection(metrics: SuggestionMetrics | null): string | null {
  if (!metrics || metrics.totalSuggested < 3) return null;

  const lines: string[] = [
    '## Forslagsstatus',
    `Siste 12 uker: ${metrics.totalSuggested} forslag, ${metrics.accepted} akseptert, ${metrics.modified} endret, ${metrics.removed} fjernet.`,
    `Akseptrate: ${(metrics.acceptanceRate * 100).toFixed(0)}%\n`,
  ];

  const cats = Object.entries(metrics.categoryBreakdown)
    .filter(([, v]) => v.suggested > 0)
    .sort((a, b) => b[1].suggested - a[1].suggested);

  if (cats.length > 0) {
    for (const [cat, data] of cats) {
      const label = CATEGORY_DISPLAY[cat] ?? cat;
      const rate = data.suggested > 0 ? ((data.accepted / data.suggested) * 100).toFixed(0) : '0';
      lines.push(`- ${label}: ${data.suggested} foreslatt, ${rate}% akseptert`);
    }
  }

  lines.push('\nBruk dette til a justere forslagene dine — foresla mer av det som aksepteres.');
  return lines.join('\n');
}

// --- Feature #6: Rejection pattern analysis ---

export interface RejectionPattern {
  type: 'category' | 'day' | 'meal';
  description: string;
}

export async function computeRejectionPatterns(supabase: SupabaseClient): Promise<RejectionPattern[]> {
  const { data: modifications } = await supabase
    .from('suggestion_modifications')
    .select('original_meal, replacement_meal, day_of_week')
    .eq('household_id', 'default')
    .order('created_at', { ascending: false })
    .limit(50);

  if (!modifications || modifications.length < 2) return [];

  const patterns: RejectionPattern[] = [];

  // 1. Category rejection rates
  const catRejections = new Map<string, number>();
  for (const mod of modifications) {
    const cat = categorizeMeal(mod.original_meal as string);
    catRejections.set(cat, (catRejections.get(cat) ?? 0) + 1);
  }
  for (const [cat, count] of catRejections) {
    if (count >= 3) {
      const label = CATEGORY_DISPLAY[cat] ?? cat;
      patterns.push({
        type: 'category',
        description: `${label}-forslag avvist ${count} ganger`,
      });
    }
  }

  // 2. Day-specific patterns
  const dayReplacements = new Map<number, Map<string, number>>();
  for (const mod of modifications) {
    const day = mod.day_of_week as number;
    const replacement = mod.replacement_meal as string | null;
    if (!replacement) continue;
    const dayMap = dayReplacements.get(day) ?? new Map<string, number>();
    const key = replacement.toLowerCase();
    dayMap.set(key, (dayMap.get(key) ?? 0) + 1);
    dayReplacements.set(day, dayMap);
  }
  for (const [day, replacements] of dayReplacements) {
    for (const [meal, count] of replacements) {
      if (count >= 2) {
        const dayName = DAY_NAMES[day] ?? `Dag ${day}`;
        patterns.push({
          type: 'day',
          description: `${dayName}: forslag endres ofte til ${meal}`,
        });
      }
    }
  }

  // 3. Specific meal rejections
  const mealRejections = new Map<string, number>();
  for (const mod of modifications) {
    const key = (mod.original_meal as string).toLowerCase();
    mealRejections.set(key, (mealRejections.get(key) ?? 0) + 1);
  }
  for (const [meal, count] of mealRejections) {
    if (count >= 3) {
      patterns.push({
        type: 'meal',
        description: `${meal} avvist ${count} ganger`,
      });
    }
  }

  return patterns;
}

export function buildRejectionPatternsSection(patterns: RejectionPattern[]): string | null {
  if (patterns.length === 0) return null;

  const lines: string[] = [
    '## Avvisningsmonstre',
    'Disse monstrene er observert i hvordan forslagene dine blir endret:\n',
  ];
  for (const p of patterns) {
    lines.push(`- ${p.description}`);
  }
  lines.push('\nUnnga a gjenta forslag som konsekvent avvises.');
  return lines.join('\n');
}
