import type { AgentDefinition, AgentContext, AgentResult } from '../base.js';
import { callClaudeJson } from '../../lib/claude-json.js';

import {
  LinkedInPostInputSchema,
  LinkedInPostOutputSchema,
  type LinkedInPostInput,
  type LinkedInPostOutput,
} from './schemas.js';

function buildSystemPrompt(articleCount: number): string {
  return `# LINKEDIN-AGENT – FYRK DECISION FRAME MODE v4

## Rolle
Du er Innholdsstrateg for FYRK.

Du skriver for:
- Ledere
- Produktledere
- Styremedlemmer
- AI-ansvarlige

Du er analytisk, presis og strukturorientert.
Du leverer klare beslutningsrammer, ikke bare meninger.

---

## Hovedoppgave

Les de relevante artiklene.

Ikke oppsummer dem.

Identifiser:
1. Et felles mønster eller signal
2. En styringsmessig implikasjon
3. En konkret beslutningsramme som ledere kan bruke

---

## Obligatorisk krav: Beslutningsramme

Hvert innlegg må inneholde:

- En tydelig tese
- En eksplisitt beslutningsdistinksjon
- En enkel modell, ramme eller test leseren kan bruke

Eksempler:
- "AI-effektivitet vs AI-beslutningskvalitet"
- "Automatisering av arbeid vs automatisering av dømmekraft"
- "Eksperimentering vs skalering"
- "Tool adoption vs capability shift"

---

## Struktur (800–1800 tegn)

### 1. Hook
Start med en tydelig påstand eller spørsmål.

### 2. Mønster
Hva peker artiklene samlet mot?
Hva skjer egentlig?

### 3. Beslutningsramme
Introduser en enkel modell:

Format:
> Hvis X, bør du gjøre Y.
> Hvis ikke, gjør Z.

Eller:
Tre spørsmål ledere bør stille før de investerer i AI.

Eller:
En 2x2-distinksjon som skiller modne fra umodne AI-strategier.

### 4. Implikasjon for OKR / styring
Hvordan bør dette påvirke:
- Prioritering?
- OKR-formulering?
- Ressursallokering?
- AI-agent-design?

### 5. Avslutning
Still et krevende spørsmål til leseren.

---

## Tone

- Thought leader
- Presis
- Ingen hype
- Ingen generisk innovasjonsspråk
- Ingen sammendrag av hver artikkel

---

## FYRK-posisjonering

FYRK skal fremstå som:
- Beslutningspartner
- Strukturbygger
- Den som bringer klarhet før forpliktelse

Ikke selgende.
Men tydelig kompetent.

---

## Outputformat

Returner et JSON-objekt med nøyaktig denne strukturen:
{
  "drafts": [
    {
      "title": "Intern tittel for innlegget",
      "postText": "Selve LinkedIn-innlegget inkludert kilder og hashtags i bunnen",
      "sourceArticles": [
        { "title": "Artikkeltittel", "url": "https://...", "source": "Kildenavn" }
      ],
      "hashtags": ["#AI", "#Beslutningskvalitet", "#OKR", "#Automatisering", "#Strategi"],
      "topic": "Hovedtema",
      "characterCount": 1234
    }
  ],
  "totalArticlesAnalyzed": ${articleCount},
  "generatedAt": "<ISO 8601 timestamp>",
  "hasDrafts": true
}

postText skal inneholde komplett innlegg med kilder og hashtags, klar til å copy-paste til LinkedIn.

Lag ETT syntese-innlegg som trekker på de mest relevante artiklene.
Returner KUN valid JSON, ingen annen tekst.`;
}

function buildUserPrompt(articles: LinkedInPostInput['articles']): string {
  const lines: string[] = [];

  lines.push('## Artikler\n');

  for (const article of articles) {
    lines.push(`### ${article.title}`);
    lines.push(`- **Kilde:** ${article.source}`);
    lines.push(`- **Publisert:** ${article.publishedAt}`);
    lines.push(`- **URL:** ${article.url}`);
    lines.push(`- **Sammendrag:** ${article.summary}`);
    lines.push('');
  }

  lines.push('Lag ett syntese-innlegg med beslutningsramme basert på artiklene.');

  return lines.join('\n');
}

async function execute(
  rawInput: LinkedInPostInput,
  _ctx: AgentContext,
): Promise<AgentResult<LinkedInPostOutput>> {
  const systemPrompt = buildSystemPrompt(rawInput.articles.length);
  const userPrompt = buildUserPrompt(rawInput.articles);

  const { parsed: output } = await callClaudeJson(LinkedInPostOutputSchema, {
    model: 'claude-sonnet-4-5-20250929',
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    cacheControl: { type: 'ephemeral' },
  });

  // Build a human-readable markdown artifact for review
  const markdownLines: string[] = [];
  markdownLines.push(`# LinkedIn-utkast — ${output.generatedAt}\n`);
  markdownLines.push(`Artikler analysert: ${output.totalArticlesAnalyzed}\n`);
  markdownLines.push(`Utkast generert: ${output.drafts.length}\n`);

  for (const draft of output.drafts) {
    markdownLines.push(`---\n`);
    markdownLines.push(`## ${draft.title}\n`);
    markdownLines.push(`**Tema:** ${draft.topic}`);
    const sources = draft.sourceArticles.map(a => `[${a.title}](${a.url}) (${a.source})`).join(', ');
    markdownLines.push(`**Kilder:** ${sources}`);
    markdownLines.push(`**Tegn:** ${draft.characterCount}\n`);
    markdownLines.push(draft.postText);
    markdownLines.push(`\n${draft.hashtags.join(' ')}\n`);
  }

  return {
    output,
    artifacts: output.hasDrafts
      ? [
          {
            kind: 'linkedin-post-drafts',
            content: markdownLines.join('\n'),
            meta: {
              totalArticles: output.totalArticlesAnalyzed,
              draftsGenerated: output.drafts.length,
              generatedAt: output.generatedAt,
            },
          },
        ]
      : [],
  };
}

export const linkedInPostAgent: AgentDefinition<LinkedInPostInput, LinkedInPostOutput> = {
  name: 'linkedin-post',
  version: '0.2',
  inputSchema: LinkedInPostInputSchema,
  outputSchema: LinkedInPostOutputSchema,
  execute,
};
