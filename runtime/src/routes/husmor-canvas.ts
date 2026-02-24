import type { SupabaseClient } from '@supabase/supabase-js';
import { DAY_NAMES } from '../lib/constants.js';
import { createCanvas, editCanvas } from '../lib/slack.js';

interface CanvasMeal {
  dayOfWeek: number;
  dayName: string;
  name: string;
  description: string | null;
}

interface CanvasShoppingItem {
  name: string;
  amount?: string;
  unit?: string;
  category?: string;
}

export function buildCanvasMarkdown(
  weekNumber: number,
  year: number,
  meals: CanvasMeal[],
  shoppingItems?: CanvasShoppingItem[],
): string {
  const lines: string[] = [`# Ukeplan uke ${weekNumber}, ${year}`, ''];

  lines.push('## Middager');
  if (meals.length > 0) {
    for (const m of meals) {
      const desc = m.description ? ` — ${m.description}` : '';
      lines.push(`- **${m.dayName}:** ${m.name}${desc}`);
    }
  } else {
    lines.push('_Ingen middager planlagt enna._');
  }

  if (shoppingItems && shoppingItems.length > 0) {
    lines.push('', '## Handleliste');
    const grouped = new Map<string, CanvasShoppingItem[]>();
    for (const item of shoppingItems) {
      const cat = item.category ?? 'Annet';
      const existing = grouped.get(cat) ?? [];
      existing.push(item);
      grouped.set(cat, existing);
    }
    for (const [category, items] of grouped) {
      lines.push(`\n### ${category}`);
      for (const item of items) {
        const qty = item.amount ? ` ${item.amount}${item.unit ? ` ${item.unit}` : ''}` : '';
        lines.push(`- [ ] ${item.name}${qty}`);
      }
    }
  }

  return lines.join('\n');
}

type Logger = { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };

export async function syncCanvas(
  supabase: SupabaseClient,
  slackToken: string,
  planId: string,
  shoppingItems: CanvasShoppingItem[],
  logger: Logger,
): Promise<void> {
  const { data: planData } = await supabase
    .from('weekly_plans')
    .select('id, week_number, year, canvas_id')
    .eq('id', planId)
    .single();

  const { data: mealRows } = await supabase
    .from('planned_meals')
    .select('day_of_week, name, description')
    .eq('plan_id', planId)
    .order('day_of_week', { ascending: true });

  const meals = (mealRows ?? []).map((m) => ({
    dayOfWeek: m.day_of_week,
    dayName: DAY_NAMES[m.day_of_week] ?? `Dag ${m.day_of_week}`,
    name: m.name,
    description: m.description,
  }));

  const markdown = buildCanvasMarkdown(
    planData?.week_number ?? 0,
    planData?.year ?? 0,
    meals,
    shoppingItems,
  );

  if (planData?.canvas_id) {
    await editCanvas(slackToken, planData.canvas_id, markdown);
    logger.info({ canvasId: planData.canvas_id }, 'Updated Canvas');
  } else {
    const title = `Ukeplan uke ${planData?.week_number ?? '?'}, ${planData?.year ?? '?'}`;
    const canvasRes = await createCanvas(slackToken, title, markdown);
    if (canvasRes.ok && canvasRes.canvas_id) {
      await supabase
        .from('weekly_plans')
        .update({ canvas_id: canvasRes.canvas_id })
        .eq('id', planId);
      logger.info({ canvasId: canvasRes.canvas_id }, 'Created Canvas');
    }
  }
}
