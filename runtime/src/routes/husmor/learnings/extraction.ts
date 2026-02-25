import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { callClaude, extractText } from '../../../lib/claude.js';
import type { ClaudeMessage } from '../../../lib/claude.js';
import { stripJsonFences } from '../../../lib/json.js';
import type { Logger } from '../../../lib/types.js';

// --- Types ---

export interface Learning {
  id: string;
  category: string;
  insight: string;
  confidence: number;
  confirmed: boolean | null;
  source: string;
}

// --- Extraction schema ---

const ExtractionResultSchema = z.array(z.object({
  category: z.enum(['preference', 'household_info', 'feedback', 'constraint', 'routine']),
  insight: z.string(),
  confidence: z.number().min(0).max(1),
  supersedes: z.string().optional(),
  expires_in_days: z.number().optional(),
}));

// --- Mechanism 1: Conversation extraction ---

const EXTRACTION_PROMPT = `Du er en analytiker som trekker ut varige lerdommer fra samtaler mellom en familie og deres matplanlegger "Husmor".

Analyser samtalen og trekk ut varige innsikter. Returner en JSON-array med objekter.

Kategorier:
- preference: Matpreferanser (liker/misliker, favoritter)
- household_info: Informasjon om husholdningen (antall personer, barns alder, etc.)
- feedback: Tilbakemelding pa spesifikke retter
- constraint: Begrensninger (allergier, diett, tid)
- routine: Faste rutiner (taco-fredag, etc.)

Regler:
- Bare varige lerdommer, ikke situasjonsbestemt (f.eks. "vi har laks i kjoleskapet" er IKKE varig)
- Kort og konkret insight (maks 100 tegn)
- confidence 0.0-1.0 (0.9+ for eksplisitte utsagn, 0.5-0.8 for implisitte)
- Sett expires_in_days for tidsbundne lerdommer
- Hvis en ny lring motisier en eksisterende, sett "supersedes" til insight-teksten til den gamle
- Returner tom array [] hvis ingen varige lerdommer finnes

EKSISTERENDE LERDOMMER (ikke gjenta disse):
{existingLearnings}

Returner KUN en JSON-array, ingen annen tekst.`;

export async function extractLearnings(
  supabase: SupabaseClient,
  apiKey: string,
  threadTs: string,
  messages: ClaudeMessage[],
  existingLearnings: Learning[],
  logger: Logger,
): Promise<void> {
  // Guard: minimum 1 user message
  const userMessageCount = messages.filter(m => m.role === 'user').length;
  if (userMessageCount < 1) return;

  // Guard: already extracted for this thread
  const { data: existing } = await supabase
    .from('household_learnings')
    .select('id')
    .eq('thread_ts', threadTs)
    .eq('source', 'extraction')
    .limit(1);

  if (existing && existing.length > 0) return;

  // Build extraction prompt
  const existingStr = existingLearnings.length > 0
    ? existingLearnings.map(l => `- [${l.category}] ${l.insight}`).join('\n')
    : '(ingen)';

  const systemPrompt = EXTRACTION_PROMPT.replace('{existingLearnings}', existingStr);

  const conversationText = messages
    .map(m => `${m.role === 'user' ? 'Bruker' : 'Husmor'}: ${m.content}`)
    .join('\n');

  const response = await callClaude(apiKey, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: conversationText }],
    cache_control: { type: 'ephemeral' },
  });

  logger.info({
    input_tokens: response.usage.input_tokens,
    cache_read: response.usage.cache_read_input_tokens ?? 0,
    cache_write: response.usage.cache_creation_input_tokens ?? 0,
    output_tokens: response.usage.output_tokens,
  }, 'Claude API usage (learning_extraction)');

  const text = extractText(response);
  const jsonStr = stripJsonFences(text);

  let learnings: z.infer<typeof ExtractionResultSchema>;
  try {
    learnings = ExtractionResultSchema.parse(JSON.parse(jsonStr));
  } catch {
    logger.warn({ text }, 'Failed to parse extraction response');
    return;
  }

  if (learnings.length === 0) return;

  // Split into superseding (need sequential insert+update) and normal (can batch)
  const superseding = learnings.filter(l => l.supersedes);
  const normal = learnings.filter(l => !l.supersedes);

  let insertedCount = 0;

  // Batch-insert normal learnings in a single call
  if (normal.length > 0) {
    const rows = normal.map(l => ({
      household_id: 'default',
      thread_ts: threadTs,
      category: l.category,
      insight: l.insight,
      confidence: l.confidence,
      source: 'extraction',
      expires_at: l.expires_in_days
        ? new Date(Date.now() + l.expires_in_days * 86400000).toISOString()
        : null,
    }));
    const { error } = await supabase.from('household_learnings').insert(rows);
    if (error) {
      logger.warn({ error, count: rows.length }, 'Batch learning insert failed');
    } else {
      insertedCount += normal.length;
    }
  }

  // Handle superseding learnings sequentially (must be ordered: insert new, update old)
  for (const learning of superseding) {
    try {
      const { data: old } = await supabase
        .from('household_learnings')
        .select('id')
        .eq('insight', learning.supersedes!)
        .is('superseded_by', null)
        .limit(1);

      if (old && old.length > 0) {
        const { data: newRow } = await supabase
          .from('household_learnings')
          .insert({
            household_id: 'default',
            thread_ts: threadTs,
            category: learning.category,
            insight: learning.insight,
            confidence: learning.confidence,
            source: 'extraction',
            expires_at: learning.expires_in_days
              ? new Date(Date.now() + learning.expires_in_days * 86400000).toISOString()
              : null,
          })
          .select('id')
          .single();

        if (newRow) {
          await supabase
            .from('household_learnings')
            .update({ superseded_by: newRow.id })
            .eq('id', old[0].id);
        }
        insertedCount++;
      } else {
        // No old learning to supersede — insert as normal
        const { error } = await supabase.from('household_learnings').insert({
          household_id: 'default',
          thread_ts: threadTs,
          category: learning.category,
          insight: learning.insight,
          confidence: learning.confidence,
          source: 'extraction',
          expires_at: learning.expires_in_days
            ? new Date(Date.now() + learning.expires_in_days * 86400000).toISOString()
            : null,
        });
        if (!error) insertedCount++;
      }
    } catch (err) {
      logger.warn({ err, insight: learning.insight }, 'Superseding learning insert failed (partial)');
    }
  }

  logger.info({ threadTs, count: insertedCount, total: learnings.length }, 'Extracted learnings from conversation');
}

// --- Load active learnings ---

export async function loadLearnings(supabase: SupabaseClient): Promise<Learning[]> {
  const now = new Date().toISOString();
  const { data } = await supabase
    .from('household_learnings')
    .select('id, category, insight, confidence, confirmed, source, expires_at')
    .eq('household_id', 'default')
    .is('superseded_by', null)
    .not('confirmed', 'eq', false)
    .gte('confidence', 0.5)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order('created_at', { ascending: false })
    .limit(30);

  return (data ?? []).map((l: Record<string, unknown>) => ({
    id: l.id as string,
    category: l.category as string,
    insight: l.insight as string,
    confidence: l.confidence as number,
    confirmed: l.confirmed as boolean | null,
    source: l.source as string,
  }));
}

// --- Build learnings section for prompt ---

const CATEGORY_LABELS: Record<string, string> = {
  preference: 'Matpreferanser',
  household_info: 'Husholdningsinformasjon',
  feedback: 'Tilbakemeldinger',
  constraint: 'Begrensninger',
  routine: 'Rutiner',
  pattern: 'Monstre',
};

export function buildLearningsSection(learnings: Learning[]): string | null {
  if (learnings.length === 0) return null;

  const grouped = new Map<string, Learning[]>();
  for (const l of learnings) {
    const existing = grouped.get(l.category) ?? [];
    existing.push(l);
    grouped.set(l.category, existing);
  }

  const lines: string[] = ['## Lerdommer fra tidligere samtaler', 'Bruk disse aktivt nar du planlegger og anbefaler.\n'];

  for (const [category, items] of grouped) {
    const label = CATEGORY_LABELS[category] ?? category;
    lines.push(`### ${label}`);
    for (const item of items) {
      const confirmed = item.confirmed === true ? ' (bekreftet)' : '';
      lines.push(`- ${item.insight}${confirmed}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
