import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getSupabase } from '../../lib/supabase.js';
import { requireAuth } from './auth.js';
import { callClaude } from '../../lib/claude.js';
import { getEnv } from '../../lib/env.js';
import { executeActions } from '../../lib/meal-actions.js';
import { loadDbContextCached } from '../../lib/meal-db.js';

const VoiceInputSchema = z.object({
  text: z.string().min(1).max(500),
});

const SYSTEM_PROMPT = `Du er Husmor, en familieassistent på en iPad i kjøkkenet.
Du mottar taletranskribert tekst fra familien. Tolk hva de vil og svar med JSON.

Tilgjengelige handlinger:
- rate_meal: Vurder dagens middag. Trenger: dayOfWeek (1-7), feedbackEmoji ("👍" eller "👎"), feedbackText (valgfri)
- log_child_reaction: Logg barns reaksjon på mat. Trenger: childName, mealName, reaction ("loved"|"liked"|"neutral"|"disliked"|"refused"), notes (valgfri)
- add_shopping_items: Legg til på handlelisten. Trenger: items (array av {name})
- answer: Bare svar på et spørsmål, ingen handling

Svar ALLTID med gyldig JSON i dette formatet:
{
  "action": "rate_meal" | "log_child_reaction" | "add_shopping_items" | "answer",
  "params": { ... },
  "reply": "Kort bekreftelse eller svar til familien"
}

Eksempler:
- "Oscar elsket tacoen" → {"action":"log_child_reaction","params":{"childName":"Oscar","mealName":"taco","reaction":"loved"},"reply":"Notert! Oscar elsket tacoen 🌮"}
- "Middagen var kjempegod" → {"action":"rate_meal","params":{"dayOfWeek":DAGENS_DAG,"feedbackEmoji":"👍","feedbackText":"kjempegod"},"reply":"Glad dere likte den! 👍"}
- "Legg til melk og brød" → {"action":"add_shopping_items","params":{"items":[{"name":"melk"},{"name":"brød"}]},"reply":"Lagt til melk og brød 🛒"}
- "Hva er middagen i morgen?" → {"action":"answer","params":{},"reply":"I morgen er det ..."}

Bruk konteksten nedenfor for å svare på spørsmål om ukemenyen.`;

export async function hubVoiceRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/hub/api/voice', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(request, reply))) return;

    const parsed = VoiceInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }

    const supabase = getSupabase();
    const ctx = await loadDbContextCached(supabase);

    const mealContext = ctx.plan?.meals
      ?.map((m: { dayOfWeek: number; name: string }) => {
        const days = ['', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];
        return `${days[m.dayOfWeek]}: ${m.name}`;
      })
      .join('\n') ?? 'Ingen ukemeny planlagt';

    const today = new Date();
    const weekday = today.getDay();
    const todayNum = weekday === 0 ? 7 : weekday;

    const userMessage = `Dagens dag: ${todayNum} (1=mandag, 7=søndag)
Dato: ${today.toLocaleDateString('nb-NO')}

Ukemeny:
${mealContext}

Brukerens melding: "${parsed.data.text}"`;

    try {
      const env = getEnv();
      const apiKey = env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return reply.status(500).send({ error: 'Missing ANTHROPIC_API_KEY' });
      }
      const response = await callClaude(apiKey, {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      });

      const text = response.content
        .filter((b: { type: string }) => b.type === 'text')
        .map((b: { text: string }) => b.text)
        .join('');

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { reply: text, action: null };
      }

      const result = JSON.parse(jsonMatch[0]);

      // Execute action via shared action handler
      if (result.action && result.action !== 'answer' && result.params) {
        const action = { type: result.action, ...result.params };
        if (result.action === 'rate_meal' && !action.dayOfWeek) {
          action.dayOfWeek = todayNum;
        }
        try {
          await executeActions(supabase, [action], fastify.log);
        } catch (actionErr) {
          fastify.log.warn({ actionErr, action: result.action }, 'Action execution failed');
        }
      }

      return {
        reply: result.reply ?? 'Forstått!',
        action: result.action,
      };
    } catch (err) {
      fastify.log.error(err, 'Voice intent error');
      return reply.status(500).send({ error: 'Beklager, noe gikk galt' });
    }
  });
}
