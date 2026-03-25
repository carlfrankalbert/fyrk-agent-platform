import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getSupabase } from '../../lib/supabase.js';
import { requireAuth } from './auth.js';
import { callClaude } from '../../lib/claude.js';
import { getEnv } from '../../lib/env.js';
import { loadDbContextCached } from '../husmor/db.js';

// In-memory rate limiter: max 1 proactive message per 20 minutes
let lastMessageTime = 0;
let lastMessageText = '';
const COOLDOWN_MS = 20 * 60 * 1000;

const SYSTEM_PROMPT = `Du er Husmor, en varm familieassistent på en iPad-skjerm på kjøkkenet.
Du skal lage EN kort, proaktiv melding til familien basert på konteksten nedenfor.
Meldingen skal føles naturlig — som om en vennlig person i huset sier noe i forbifarten.

Regler:
- Maks 1-2 setninger
- Bruk emoji sparsomt (maks 1)
- Vær konkret, ikke generisk
- Ikke still spørsmål — gi et tips, påminnelse, eller oppmuntring
- Skriv på norsk
- Tilpass til tidspunktet på dagen

Meldingstyper du kan velge mellom:
- Måltidspåminnelse: "Husk å tine laksen til i kveld! 🐟"
- Handleliste-nudge: "Det er 6 ting på handlelisten — kanskje handle på vei hjem?"
- Bruk-snart: "Avokadoene bør brukes i dag"
- Værtips: "Det blir kaldt i ettermiddag — perfekt for en varm suppe"
- Oppmuntring: "Bra uke så langt — dere har spist hjemmelaget 4 av 5 dager!"

Svar med KUN meldingsteksten, ingenting annet. Hvis det ikke er noe nyttig å si akkurat nå, svar med tom streng.`;

export async function hubProactiveRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/hub/api/proactive', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(request, reply))) return;

    const now = Date.now();

    // Rate limit: return nothing if too recent
    if (now - lastMessageTime < COOLDOWN_MS) {
      return { message: null };
    }

    try {
      const env = getEnv();
      const apiKey = env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return { message: null };
      }

      const supabase = getSupabase();
      const ctx = await loadDbContextCached(supabase);

      // Load settings
      const { data: settingsRows } = await supabase
        .from('family_preferences')
        .select('key, value')
        .in('key', ['dinner_time', 'proactive_enabled']);

      const settings: Record<string, unknown> = {};
      if (settingsRows) {
        for (const row of settingsRows) settings[row.key] = row.value;
      }

      // Respect proactive_enabled setting
      if (settings.proactive_enabled === false) {
        return { message: null };
      }

      const dinnerTime = (typeof settings.dinner_time === 'string' ? settings.dinner_time : '17:00');

      // Build context for Claude
      const nowDate = new Date();
      const hour = nowDate.toLocaleString('nb-NO', { timeZone: 'Europe/Oslo', hour: '2-digit', hour12: false });
      const dateStr = nowDate.toLocaleDateString('nb-NO', {
        timeZone: 'Europe/Oslo',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });

      const weekday = nowDate.getDay();
      const todayNum = weekday === 0 ? 7 : weekday;

      const contextParts: string[] = [];
      contextParts.push(`Tidspunkt: ${dateStr}, kl ${hour}`);
      contextParts.push(`Middagstid: kl ${dinnerTime} (gi påminnelser i god tid før dette)`);

      // Today's meal
      const todayMeal = ctx.plan?.meals?.find((m: { dayOfWeek: number }) => m.dayOfWeek === todayNum);
      if (todayMeal) {
        contextParts.push(`Dagens middag: ${todayMeal.name}${todayMeal.description ? ` — ${todayMeal.description}` : ''}`);
      } else {
        contextParts.push('Ingen middag planlagt i dag.');
      }

      // Tomorrow's meal
      const tomorrowNum = todayNum === 7 ? 1 : todayNum + 1;
      const tomorrowMeal = ctx.plan?.meals?.find((m: { dayOfWeek: number }) => m.dayOfWeek === tomorrowNum);
      if (tomorrowMeal) {
        contextParts.push(`Morgendagens middag: ${tomorrowMeal.name}`);
      }

      // Shopping list
      const { data: shoppingItems } = await supabase
        .from('husmor_shopping_items')
        .select('name, checked')
        .eq('checked', false);

      if (shoppingItems && shoppingItems.length > 0) {
        contextParts.push(`Handleliste: ${shoppingItems.length} varer (${shoppingItems.slice(0, 5).map((i: { name: string }) => i.name).join(', ')}${shoppingItems.length > 5 ? '...' : ''})`);
      }

      // Inventory use-soon
      if (ctx.inventoryNotes && ctx.inventoryNotes.length > 0) {
        const useSoon = ctx.inventoryNotes.filter((n: { status: string }) => n.status === 'use_soon');
        if (useSoon.length > 0) {
          contextParts.push(`Må brukes snart: ${useSoon.map((n: { itemName: string }) => n.itemName).join(', ')}`);
        }
      }

      // Week progress
      const mealsEaten = ctx.plan?.meals?.filter((m: { dayOfWeek: number }) => m.dayOfWeek < todayNum).length ?? 0;
      if (mealsEaten > 0) {
        contextParts.push(`Middager spist denne uken: ${mealsEaten}`);
      }

      // Previous message (to avoid repetition)
      if (lastMessageText) {
        contextParts.push(`Forrige melding (unngå gjentakelse): "${lastMessageText}"`);
      }

      const userMessage = contextParts.join('\n');

      const response = await callClaude(apiKey, {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      });

      const text = response.content
        .filter((b: { type: string }) => b.type === 'text')
        .map((b: { text: string }) => b.text)
        .join('')
        .trim();

      if (!text) {
        return { message: null };
      }

      // Update rate limiter
      lastMessageTime = now;
      lastMessageText = text;

      return { message: text };
    } catch (err) {
      fastify.log.warn({ err }, 'Proactive message error');
      return { message: null };
    }
  });
}
