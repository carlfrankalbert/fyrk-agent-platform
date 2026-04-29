import type { AgentDefinition, AgentContext, AgentResult } from '../base.js';
import { callClaudeJson } from '../../lib/claude-json.js';
import { callOpenAiJson } from '../../lib/openai-json.js';
import { getEnv } from '../../lib/env.js';
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildEditorialSystemPrompt,
  buildEditorialUserPrompt,
  buildSecondOpinionSystemPrompt,
  buildSecondOpinionUserPrompt,
} from './prompt.js';

import {
  CvTailorInputSchema,
  CvTailorOutputSchema,
  EditorialPassSchema,
  ReviewPassSchema,
  ReviewPassJsonSchema,
  type CvTailorInput,
  type CvTailorOutput,
} from './schemas.js';
import { validateAndFinalizeCv } from './validate.js';

async function execute(
  rawInput: CvTailorInput,
  _ctx: AgentContext,
): Promise<AgentResult<CvTailorOutput>> {
  const language = rawInput.language ?? 'no';
  const roleHint = rawInput.roleHint ?? null;
  const env = getEnv();

  const systemPrompt = buildSystemPrompt(language);
  const userPrompt = buildUserPrompt(rawInput.jobPosting, roleHint, rawInput.additionalContext);

  const { parsed: output } = await callClaudeJson(CvTailorOutputSchema, {
    model: 'claude-sonnet-4-5-20250929',
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: 8192,
    cacheControl: { type: 'ephemeral' },
  });

  // Editorial pass — Haiku polishes language without changing facts
  const editorialInput = {
    profile: output.cv.profile,
    coreCompetencies: output.cv.coreCompetencies,
    previousExperienceSummary: output.cv.previousExperienceSummary ?? null,
    experience: output.cv.experience.map(e => ({ description: e.description, highlights: e.highlights })),
  };

  const { parsed: editorial } = await callClaudeJson(EditorialPassSchema, {
    model: 'claude-haiku-4-5-20251001',
    system: buildEditorialSystemPrompt(language),
    messages: [{ role: 'user', content: buildEditorialUserPrompt(editorialInput) }],
    maxTokens: 4096,
  });

  // Merge polished text back into output
  output.cv.profile = editorial.profile;
  output.cv.coreCompetencies = editorial.coreCompetencies;
  output.cv.previousExperienceSummary = editorial.previousExperienceSummary ?? output.cv.previousExperienceSummary ?? null;
  for (let i = 0; i < output.cv.experience.length; i++) {
    if (editorial.experience[i]) {
      output.cv.experience[i].description = editorial.experience[i].description;
      output.cv.experience[i].highlights = editorial.experience[i].highlights;
    }
  }

  let secondOpinion: CvTailorOutput['secondOpinion'] | undefined;

  if (env.CV_SECOND_OPINION_PROVIDER === 'openai') {
    const reviewInput = {
      profile: output.cv.profile,
      coreCompetencies: output.cv.coreCompetencies,
      previousExperienceSummary: output.cv.previousExperienceSummary ?? null,
      experience: output.cv.experience.map(e => ({ description: e.description, highlights: e.highlights })),
    };

    const { parsed: review } = await callOpenAiJson(ReviewPassSchema, {
      system: buildSecondOpinionSystemPrompt(language),
      input: buildSecondOpinionUserPrompt({
        jobPosting: rawInput.jobPosting,
        roleHint,
        cv: reviewInput,
      }),
      schemaName: 'cv_second_opinion_review',
      schemaDescription: 'Independent review of a CV draft with concise findings and safe text revisions.',
      schemaJson: ReviewPassJsonSchema,
      maxTokens: 4096,
    });

    output.cv.profile = review.profile;
    output.cv.coreCompetencies = review.coreCompetencies;
    output.cv.previousExperienceSummary = review.previousExperienceSummary ?? output.cv.previousExperienceSummary ?? null;
    for (let i = 0; i < output.cv.experience.length; i++) {
      if (review.experience[i]) {
        output.cv.experience[i].description = review.experience[i].description;
        output.cv.experience[i].highlights = review.experience[i].highlights;
      }
    }

    secondOpinion = {
      provider: 'openai',
      summary: review.summary,
      findings: review.findings,
    };
    output.secondOpinion = secondOpinion;
  }

  const { output: validatedOutput, issues } = validateAndFinalizeCv(output, {
    language,
    roleHint,
  });

  // Build markdown artifact for human review
  const md: string[] = [];
  const cv = validatedOutput.cv;

  md.push(`# ${cv.name}`);
  md.push(`**${cv.title}**`);
  md.push(`${cv.contact}\n`);
  md.push(`${cv.profile}\n`);

  md.push('## Kjernekompetanse\n');
  for (const comp of cv.coreCompetencies) {
    md.push(`- ${comp}`);
  }

  md.push('\n## Erfaring\n');
  for (const exp of cv.experience) {
    md.push(`### ${exp.company} | ${exp.role}`);
    md.push(`*${exp.period}*\n`);
    md.push(`${exp.description}\n`);
    for (const h of exp.highlights) {
      md.push(`- ${h}`);
    }
    md.push('');
  }

  if (cv.previousExperienceSummary) {
    md.push('## Tidligere erfaring\n');
    md.push(`${cv.previousExperienceSummary}\n`);
  }

  if (cv.education.length > 0) {
    md.push('## Utdanning\n');
    for (const edu of cv.education) {
      md.push(`- ${edu}`);
    }
    md.push('');
  }

  if (cv.certifications.length > 0) {
    md.push('## Sertifiseringer\n');
    for (const cert of cv.certifications) {
      md.push(`- ${cert}`);
    }
    md.push('');
  }

  if (cv.talks.length > 0) {
    md.push('## Foredrag\n');
    for (const talk of cv.talks) {
      md.push(`- ${talk}`);
    }
    md.push('');
  }

  if (cv.languages.length > 0) {
    md.push('## Språk\n');
    md.push(cv.languages.join(' | '));
    md.push('');
  }

  // Match analysis and gap analysis are kept in JSON output only (output.matchAnalysis, output.gaps)
  // but NOT included in the markdown artifact — the CV should be clean and ready to use

  return {
    output: validatedOutput,
    artifacts: [
      {
        kind: 'cv-tailor-output',
        content: md.join('\n'),
        meta: {
          roleHint,
          fitScore: validatedOutput.matchAnalysis.fitScore,
          overallFit: validatedOutput.matchAnalysis.overallFit,
          gapQuestions: validatedOutput.gaps.questions.length,
          secondOpinionProvider: secondOpinion?.provider ?? null,
          secondOpinionFindings: secondOpinion?.findings.length ?? 0,
          validationIssueCount: issues.length,
          validationErrorsFixed: issues.filter(issue => issue.severity === 'error').length,
          generatedAt: validatedOutput.generatedAt,
        },
      },
    ],
  };
}

export const cvTailorAgent: AgentDefinition<CvTailorInput, CvTailorOutput> = {
  name: 'cv-tailor',
  version: '0.1',
  inputSchema: CvTailorInputSchema,
  outputSchema: CvTailorOutputSchema,
  execute,
};
