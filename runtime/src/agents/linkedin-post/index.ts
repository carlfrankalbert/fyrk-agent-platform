import type { AgentDefinition, AgentContext, AgentResult } from '../base.js';
import { callClaude, extractText } from '../../lib/claude.js';
import { getEnv } from '../../lib/env.js';

import {
  LinkedInPostInputSchema,
  LinkedInPostOutputSchema,
  type LinkedInPostInput,
  type LinkedInPostOutput,
} from './schemas.js';

const DEFAULT_TOPICS = ['AI', 'automatisering', 'beslutningsverktøy'];
const DEFAULT_MAX_POSTS = 3;
const DEFAULT_LANGUAGE = 'no' as const;
const DEFAULT_TONE = 'thought-leader' as const;

const TONE_INSTRUCTIONS: Record<string, string> = {
  professional: 'Skriv i en profesjonell og saklig tone. Fokuser på fakta og forretningsverdi.',
  conversational: 'Skriv i en uformell og engasjerende tone. Bruk direkte henvendelser og korte setninger.',
  'thought-leader': 'Skriv som en tankeleder innen AI og automatisering. Del innsikt, still spørsmål, og utfordre etablerte oppfatninger.',
};

interface ResolvedInput {
  articles: LinkedInPostInput['articles'];
  topics: string[];
  maxPosts: number;
  language: 'no' | 'en';
  tone: 'professional' | 'conversational' | 'thought-leader';
}

function resolveDefaults(input: LinkedInPostInput): ResolvedInput {
  return {
    articles: input.articles,
    topics: input.topics ?? DEFAULT_TOPICS,
    maxPosts: input.maxPosts ?? DEFAULT_MAX_POSTS,
    language: input.language ?? DEFAULT_LANGUAGE,
    tone: input.tone ?? DEFAULT_TONE,
  };
}

function buildSystemPrompt(input: ResolvedInput): string {
  const lang = input.language === 'no' ? 'norsk' : 'engelsk';
  const toneInstruction = TONE_INSTRUCTIONS[input.tone] ?? TONE_INSTRUCTIONS['thought-leader'];

  return `Du er en innholdsstrateg for FYRK, et norsk teknologiselskap som bygger AI-agenter, beslutningsverktøy (Decision Loop) og automatiseringsløsninger.

Din oppgave er å lage LinkedIn-innlegg basert på relevante artikler.

Regler:
- Skriv på ${lang}
- ${toneInstruction}
- Hvert innlegg skal være 800–1800 tegn (optimal lengde for LinkedIn)
- Start med en hook — et spørsmål, en overraskende innsikt, eller en påstand
- Knytt artikkelen tilbake til FYRKs domene: AI-agenter, beslutningsstøtte, OKR, automatisering
- Avslutt med en CTA eller et tankevekkende spørsmål
- 3–5 hashtags per innlegg
- Ikke kopier artikkeltekst direkte — skap originalt innhold inspirert av artikkelen
- Inkluder lenke til kildeartikkelen i innlegget

Fokusområder: ${input.topics.join(', ')}

Returner et JSON-objekt med nøyaktig denne strukturen:
{
  "drafts": [
    {
      "title": "Intern tittel for utkastet",
      "postText": "Selve LinkedIn-innlegget med lenke til artikkelen",
      "sourceArticle": { "title": "Artikkeltittel", "url": "https://...", "source": "Kildenavn" },
      "hashtags": ["#hashtag1", "#hashtag2"],
      "topic": "Hovedtema",
      "characterCount": 1234
    }
  ],
  "totalArticlesAnalyzed": 3,
  "generatedAt": "2026-02-23T10:00:00Z",
  "hasDrafts": true
}

Velg de ${input.maxPosts} mest relevante artiklene å lage innlegg fra.
Returner KUN valid JSON, ingen annen tekst.`;
}

function buildUserPrompt(input: ResolvedInput): string {
  const lines: string[] = [];

  lines.push('## Artikler å vurdere\n');

  for (const article of input.articles) {
    lines.push(`### ${article.title}`);
    lines.push(`- **Kilde:** ${article.source}`);
    lines.push(`- **Publisert:** ${article.publishedAt}`);
    lines.push(`- **URL:** ${article.url}`);
    lines.push(`- **Sammendrag:** ${article.summary}`);
    lines.push('');
  }

  lines.push(`Lag opptil ${input.maxPosts} LinkedIn-innlegg basert på de mest relevante artiklene.`);

  return lines.join('\n');
}

async function execute(
  rawInput: LinkedInPostInput,
  _ctx: AgentContext,
): Promise<AgentResult<LinkedInPostOutput>> {
  const input = resolveDefaults(rawInput);

  const env = getEnv();
  const apiKey = env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required for linkedin-post agent');
  }

  const systemPrompt = buildSystemPrompt(input);
  const userPrompt = buildUserPrompt(input);

  const response = await callClaude(apiKey, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = extractText(response);

  // Strip markdown fences if present
  let jsonStr = text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(jsonStr);
  const output = LinkedInPostOutputSchema.parse(parsed);

  // Build a human-readable markdown artifact for review
  const markdownLines: string[] = [];
  markdownLines.push(`# LinkedIn-utkast — ${output.generatedAt}\n`);
  markdownLines.push(`Artikler analysert: ${output.totalArticlesAnalyzed}\n`);
  markdownLines.push(`Utkast generert: ${output.drafts.length}\n`);

  for (const draft of output.drafts) {
    markdownLines.push(`---\n`);
    markdownLines.push(`## ${draft.title}\n`);
    markdownLines.push(`**Tema:** ${draft.topic}`);
    markdownLines.push(`**Kilde:** [${draft.sourceArticle.title}](${draft.sourceArticle.url}) (${draft.sourceArticle.source})`);
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
              language: input.language,
              tone: input.tone,
              generatedAt: output.generatedAt,
            },
          },
        ]
      : [],
  };
}

export const linkedInPostAgent: AgentDefinition<LinkedInPostInput, LinkedInPostOutput> = {
  name: 'linkedin-post',
  version: '0.1',
  inputSchema: LinkedInPostInputSchema,
  outputSchema: LinkedInPostOutputSchema,
  execute,
};
