import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from './auth.js';
import { callClaude } from '../../lib/claude.js';
import { getEnv } from '../../lib/env.js';
import { getSupabase } from '../../lib/supabase.js';
import { loadDbContextCached } from '../husmor/db.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface MealsChatRequest {
  messages: ChatMessage[];
}

const SYSTEM_PROMPT = `Du er Husmor — en varm og jordnær matplanlegger for en norsk familie. Familien snakker med deg mens de går rundt på kjøkkenet.

Samtalen har to tydelige faser. IKKE bland dem.

## Fase 1: Hva har dere hjemme?
Start her. Spør hva de ser i kjøleskapet, fryseren og skapet. Oppsummer underveis.
Typiske oppfølgingsspørsmål: "Noe i fryseren?", "Grønnsaker?", "Hermetikk eller pasta i skapet?"
Når de virker ferdige med å fortelle, si noe som "Supert, da har jeg oversikt! Har dere noen ønsker for uken?"

## Fase 2: Ønsker og behov
Spør om preferanser, ønsker, og spesielle hensyn for uken.
Eksempler: "Noe lett på onsdag?", "Vil dere prøve noe nytt?", "Noe barna har bedt om?"

VIKTIG: Ikke spør "hva trenger dere å kjøpe?" — det regner du ut selv basert på hva de har og hva de ønsker.

Vær kort og naturlig — maks 2-3 setninger per svar. Still ett spørsmål om gangen.
Bruk en uformell, vennlig tone. Si "mmhm", "oi, det høres bra ut", "smart!" osv.
Ikke lag menyen ennå — bare samle informasjon.

Når du svarer, inkluder ALLTID en JSON-blokk på slutten med det du har forstått så langt:
\`\`\`json
{
  "ingredients": ["agurk", "3 tomater", "kyllingfilet i fryseren"],
  "preferences": ["vil bruke opp agurken", "noe lett på onsdag"],
  "needToBuy": ["løk", "fløte"],
  "context": "Har agurk, 3 tomater og kyllingfilet i fryseren. Vil ha noe lett på onsdag."
}
\`\`\`

- "ingredients" = det familien HAR hjemme (fase 1)
- "preferences" = ønsker og hensyn for uken (fase 2)
- "needToBuy" = ting du skjønner de mangler basert på ønskene vs. det de har. Fyll inn etterhvert som det blir tydelig. Kan være tom i starten.
- "context" = kort oppsummering (maks 200 tegn) for menygeneratoren.`;

export async function hubMealsChatRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/hub/api/meals/chat', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(request, reply))) return;

    const env = getEnv();
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return reply.status(500).send({ error: 'Missing ANTHROPIC_API_KEY' });
    }

    const body = request.body as MealsChatRequest | null;
    if (!body?.messages || body.messages.length === 0) {
      return reply.status(400).send({ error: 'messages required' });
    }

    // Load family context for personalization
    const supabase = getSupabase();
    const ctx = await loadDbContextCached(supabase);
    const familyContext = buildFamilyContext(ctx);

    try {
      const response = await callClaude(apiKey, {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: SYSTEM_PROMPT + familyContext,
        messages: body.messages,
      });

      const text = response.content
        .filter((b: { type: string }) => b.type === 'text')
        .map((b: { text: string }) => b.text)
        .join('');

      // Extract the JSON context block
      const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
      let extracted: { ingredients: string[]; preferences: string[]; needToBuy: string[]; context: string } | null = null;
      if (jsonMatch) {
        try {
          extracted = JSON.parse(jsonMatch[1]);
        } catch { /* ignore parse errors */ }
      }

      // Clean reply (remove JSON block)
      const cleanReply = text.replace(/```json[\s\S]*?```/, '').trim();

      return {
        reply: cleanReply,
        extracted,
      };
    } catch (err) {
      fastify.log.error(err, 'Meals chat failed');
      return reply.status(500).send({ error: 'Samtale feilet' });
    }
  });
}

function buildFamilyContext(ctx: any): string {
  const parts: string[] = [];

  if (ctx.childProfiles?.length > 0) {
    const kids = ctx.childProfiles.map((c: any) => {
      const likes = c.likes?.length > 0 ? `liker: ${c.likes.join(', ')}` : '';
      const dislikes = c.dislikes?.length > 0 ? `liker ikke: ${c.dislikes.join(', ')}` : '';
      return `${c.name} (${[likes, dislikes].filter(Boolean).join('; ')})`;
    }).join('. ');
    parts.push(`\n\nBarna i familien: ${kids}`);
  }

  if (ctx.plan?.meals?.length > 0) {
    const current = ctx.plan.meals.map((m: any) => m.name).join(', ');
    parts.push(`Nåværende ukemeny: ${current}`);
  }

  return parts.length > 0 ? '\n\n' + parts.join('\n') : '';
}
