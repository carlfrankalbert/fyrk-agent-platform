import type { AgentContext, AgentDefinition, AgentResult } from '../base.js';
import { getEnv } from '../../lib/env.js';
import {
  BriefJsonSchema,
  BriefSchema,
  EditorialRoomInputSchema,
  EditorialRoomOutputSchema,
  FactGuardJsonSchema,
  FactGuardPassSchema,
  FinalJsonSchema,
  FinalPassSchema,
  GroundworkJsonSchema,
  GroundworkSchema,
  LanguagePassJsonSchema,
  LanguagePassSchema,
  PositioningPassJsonSchema,
  PositioningPassSchema,
  SkepticPassJsonSchema,
  SkepticPassSchema,
  resolveDefaults,
  type EditorialRoomInput,
  type EditorialRoomOutput,
} from './schemas.js';
import {
  buildBriefSystemPrompt,
  buildBriefUserPrompt,
  buildChiefEditorSystemPrompt,
  buildChiefEditorUserPrompt,
  buildFactGuardSystemPrompt,
  buildFactGuardUserPrompt,
  buildGroundworkSystemPrompt,
  buildGroundworkUserPrompt,
  buildLanguageSystemPrompt,
  buildLanguageUserPrompt,
  buildPositioningSystemPrompt,
  buildPositioningUserPrompt,
  buildSkepticSystemPrompt,
  buildSkepticUserPrompt,
} from './prompt.js';
import { buildTiers, callRole } from './models.js';

async function execute(
  rawInput: EditorialRoomInput,
  _ctx: AgentContext,
): Promise<AgentResult<EditorialRoomOutput>> {
  const env = getEnv();
  if (!env.OPENAI_API_KEY) {
    throw new Error(
      'OPENAI_API_KEY is required for editorial-room (most roles run on GPT in both tiers)',
    );
  }

  const resolved = resolveDefaults(rawInput);
  const { mode, language, format, draft, tier } = resolved;
  const tiers = buildTiers();
  const cfg = tiers[tier];

  // Steg 1 — Brief
  const brief = await callRole(cfg.brief, BriefSchema, {
    system: buildBriefSystemPrompt(language),
    user: buildBriefUserPrompt({
      draft,
      mode,
      format,
      audience: resolved.audience,
      intent: resolved.intent,
    }),
    schemaName: 'editorial_brief',
    schemaDescription: 'Felles brief som styrer redaksjonsmøtet.',
    schemaJson: BriefJsonSchema,
  });

  // Steg 2 — Groundwork
  const groundwork = await callRole(cfg.groundwork, GroundworkSchema, {
    system: buildGroundworkSystemPrompt(language),
    user: buildGroundworkUserPrompt({ draft, brief }),
    schemaName: 'editorial_groundwork',
    schemaDescription: 'Tillatt grunnlag destillert fra input og fast kontekst.',
    schemaJson: GroundworkJsonSchema,
  });

  // Steg 3 — Posisjoneringsredaktør
  const positioning = await callRole(cfg.positioning, PositioningPassSchema, {
    system: buildPositioningSystemPrompt(language),
    user: buildPositioningUserPrompt({ draft, brief, groundwork }),
    schemaName: 'editorial_positioning',
    schemaDescription: 'Posisjoneringsredaktørens vurdering basert på tillatt grunnlag.',
    schemaJson: PositioningPassJsonSchema,
  });

  // Steg 4 — Språkredaktør
  const languagePass = await callRole(cfg.language, LanguagePassSchema, {
    system: buildLanguageSystemPrompt(language),
    user: buildLanguageUserPrompt({ draft, brief, groundwork, positioning }),
    schemaName: 'editorial_language',
    schemaDescription: 'Polert utkast og alternativer fra språkredaktøren.',
    schemaJson: LanguagePassJsonSchema,
  });

  // Steg 5 — Skeptiker
  const skeptic = await callRole(cfg.skeptic, SkepticPassSchema, {
    system: buildSkepticSystemPrompt(language),
    user: buildSkepticUserPrompt({
      brief,
      groundwork,
      positioning,
      polishedDraft: languagePass.polishedDraft,
    }),
    schemaName: 'editorial_skeptic',
    schemaDescription: 'Skeptikerens kritiske gjennomgang av polert utkast.',
    schemaJson: SkepticPassJsonSchema,
  });

  // Steg 6 — Faktavokter
  const factGuard = await callRole(cfg.factGuard, FactGuardPassSchema, {
    system: buildFactGuardSystemPrompt(language),
    user: buildFactGuardUserPrompt({
      groundwork,
      polishedDraft: languagePass.polishedDraft,
      skeptic,
    }),
    schemaName: 'editorial_fact_guard',
    schemaDescription: 'Klassifisering av konkrete påstander og renset utkast.',
    schemaJson: FactGuardJsonSchema,
  });

  // Steg 7 — Sjefredaktør
  const finalRaw = await callRole(cfg.chiefEditor, FinalPassSchema, {
    system: buildChiefEditorSystemPrompt(language),
    user: buildChiefEditorUserPrompt({
      originalDraft: draft,
      brief,
      groundwork,
      positioning,
      language: languagePass,
      skeptic,
      factGuard,
      revisionNotes: resolved.revisionNotes,
      previousFinalPost: resolved.previousFinalPost,
    }),
    schemaName: 'editorial_final',
    schemaDescription: 'Sjefredaktørens endelige tekst og maks 5 endringskommentarer.',
    schemaJson: FinalJsonSchema,
  });

  // Hard cap på 5 endringskommentarer ("samme tekst, bare bedre").
  const final = { ...finalRaw, changeNotes: finalRaw.changeNotes.slice(0, 5) };

  const output: EditorialRoomOutput = {
    brief,
    groundwork,
    positioning,
    language: languagePass,
    skeptic,
    factGuard,
    final,
    generatedAt: new Date().toISOString(),
    mode,
  };

  // Markdown-artifact — slank: anbefalt versjon + endringer.
  // Skeptiker og faktavokter kjører internt, men vises ikke som egne seksjoner.
  const md: string[] = [];
  md.push('# Redaksjonsrommet\n');

  md.push('## Anbefalt versjon\n');
  md.push(final.recommendedPost);
  md.push('');

  if (final.changeNotes.length > 0) {
    md.push('## Endringer\n');
    for (const note of final.changeNotes) md.push(`- ${note}`);
    md.push('');
  }

  return {
    output,
    artifacts: [
      {
        kind: 'editorial-room-output',
        content: md.join('\n'),
        meta: {
          mode,
          tier,
          tierLabel: cfg.label,
          verdict: skeptic.verdict,
          generatedAt: output.generatedAt,
          claimsClassified: factGuard.classifiedClaims.length,
          claimsRemoved: factGuard.removedClaims.length,
          claimsSoftened: factGuard.softenedClaims.length,
          modelsUsed: {
            brief: cfg.brief.model,
            groundwork: cfg.groundwork.model,
            positioning: cfg.positioning.model,
            language: cfg.language.model,
            skeptic: cfg.skeptic.model,
            factGuard: cfg.factGuard.model,
            chiefEditor: cfg.chiefEditor.model,
          },
        },
      },
    ],
  };
}

export const editorialRoomAgent: AgentDefinition<EditorialRoomInput, EditorialRoomOutput> = {
  name: 'editorial-room',
  version: '0.3',
  inputSchema: EditorialRoomInputSchema,
  outputSchema: EditorialRoomOutputSchema,
  execute,
};
