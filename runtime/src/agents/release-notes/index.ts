import type { AgentDefinition, AgentContext, AgentResult } from '../base.js';
import {
  ReleaseNotesInputSchema,
  ReleaseNotesOutputSchema,
  type ReleaseNotesInput,
  type ReleaseNotesOutput,
  type Commit,
  type CategorizedCommit,
  type ChangeCategory,
} from './schemas.js';

const RISK_KEYWORDS = ['breaking', 'migration', 'security', 'pii', 'auth', 'db', 'payment'];

const CATEGORY_PREFIXES: Record<string, ChangeCategory> = {
  feat: 'features',
  fix: 'fixes',
  chore: 'chores',
  docs: 'chores',
  refactor: 'chores',
  test: 'chores',
  style: 'chores',
  perf: 'features',
  ci: 'chores',
  build: 'chores',
};

const PREFIX_RE = /^(feat|fix|chore|docs|refactor|test|style|perf|ci|build)(\([^)]*\))?:\s*/i;

const VERB_MAP: Record<string, string> = {
  add: 'Lagt til',
  implement: 'Lagt til',
  create: 'Lagt til',
  introduce: 'Lagt til',
  fix: 'Rettet',
  resolve: 'Rettet',
  correct: 'Rettet',
  patch: 'Rettet',
  update: 'Oppdatert',
  upgrade: 'Oppdatert',
  bump: 'Oppdatert',
  improve: 'Forbedret',
  refactor: 'Forbedret',
  clean: 'Forbedret',
  remove: 'Fjernet',
  delete: 'Fjernet',
};

const CATEGORY_VERBS: Record<ChangeCategory, string> = {
  features: 'Lagt til',
  fixes: 'Rettet',
  chores: 'Oppdatert',
};

function stripPrefix(message: string): string {
  const clean = message.replace(PREFIX_RE, '');
  return clean || message;
}

function cleanCommitMessage(message: string, category: ChangeCategory): string {
  // Strip conventional commit prefix
  let clean = message.replace(PREFIX_RE, '');

  // Detect leading action verb and choose Norwegian replacement
  let verb = CATEGORY_VERBS[category];
  const verbMatch = clean.match(/^(\w+)\s+/);
  if (verbMatch) {
    const mapped = VERB_MAP[verbMatch[1].toLowerCase()];
    if (mapped) {
      verb = mapped;
      clean = clean.slice(verbMatch[0].length);
    }
  }

  // Guard against empty result
  if (!clean.trim()) {
    clean = message.replace(PREFIX_RE, '');
    if (!clean.trim()) {
      clean = message;
    }
  }

  // Lowercase first character unless it's an acronym (all-caps word)
  const firstWord = clean.split(/\s/)[0];
  if (!(firstWord === firstWord.toUpperCase() && firstWord.length > 1)) {
    clean = clean.charAt(0).toLowerCase() + clean.slice(1);
  }

  return `${verb} ${clean}`;
}

function categorizeCommit(commit: Commit): CategorizedCommit {
  const message = commit.message.toLowerCase();

  // Detect category from conventional commit prefix
  let category: ChangeCategory = 'chores';
  for (const [prefix, cat] of Object.entries(CATEGORY_PREFIXES)) {
    if (message.startsWith(`${prefix}:`) || message.startsWith(`${prefix}(`)) {
      category = cat;
      break;
    }
  }

  // Detect risk keywords (word boundary match to avoid false positives)
  const riskKeywords = RISK_KEYWORDS.filter((kw) => new RegExp(`\\b${kw}\\b`).test(message));

  // Determine if highlight (features and fixes with significant changes)
  const isHighlight = category === 'features' || (category === 'fixes' && riskKeywords.length > 0);

  return {
    sha: commit.sha,
    message: commit.message,
    author: commit.author,
    url: commit.url,
    category,
    isHighlight,
    riskKeywords,
  };
}

function generateHighlights(commits: CategorizedCommit[]): string[] {
  return commits
    .filter((c) => c.isHighlight)
    .slice(0, 3)
    .map((c) => cleanCommitMessage(c.message, c.category));
}

function generateRiskNotes(commits: CategorizedCommit[]): string[] {
  const risks: string[] = [];

  for (const commit of commits) {
    if (commit.riskKeywords.length > 0) {
      const cleanMsg = stripPrefix(commit.message);
      const keywords = commit.riskKeywords.join(', ');
      risks.push(`⚠️ ${cleanMsg} (keywords: ${keywords})`);
    }
  }

  return risks;
}

function generateExecutiveSummary(
  changes: { features: CategorizedCommit[]; fixes: CategorizedCommit[]; chores: CategorizedCommit[] },
): string {
  const parts: string[] = [];
  const nf = changes.features.length;
  const nx = changes.fixes.length;
  const nc = changes.chores.length;

  if (nf > 0) parts.push(`${nf} ${nf === 1 ? 'ny funksjon' : 'nye funksjoner'}`);
  if (nx > 0) parts.push(`${nx} ${nx === 1 ? 'feilretting' : 'feilrettinger'}`);
  if (nc > 0) parts.push(`${nc} ${nc === 1 ? 'vedlikeholdsendring' : 'vedlikeholdsendringer'}`);

  if (parts.length === 0) return 'Ingen endringer i denne releasen.';

  if (parts.length === 1) {
    return `Denne releasen inneholder ${parts[0]}.`;
  }

  const last = parts.pop()!;
  return `Denne releasen inneholder ${parts.join(', ')} og ${last}.`;
}

function generateImpact(
  changes: { features: CategorizedCommit[]; fixes: CategorizedCommit[]; chores: CategorizedCommit[] },
  hasRisks: boolean,
): string[] {
  const impact: string[] = [];

  if (changes.features.length > 0) {
    const n = changes.features.length;
    impact.push(`${n} ${n === 1 ? 'ny funksjon påvirker' : 'nye funksjoner påvirker'} brukeropplevelsen`);
  }
  if (changes.fixes.length > 0) {
    impact.push('Feilrettinger forbedrer stabilitet og pålitelighet');
  }
  if (hasRisks) {
    impact.push('Endringer med risiko krever ekstra oppmerksomhet ved utrulling');
  }

  return impact.slice(0, 3);
}

function generateRollback(allRiskKeywords: string[]): string | null {
  if (allRiskKeywords.length === 0) return null;

  if (allRiskKeywords.includes('breaking') || allRiskKeywords.includes('migration')) {
    return 'Reverter release';
  }
  if (allRiskKeywords.includes('security') || allRiskKeywords.includes('auth') || allRiskKeywords.includes('payment')) {
    return 'Deaktiver feature flag';
  }
  return 'Rull tilbake berørte commits';
}

function generateMarkdown(
  _repo: string,
  _rangeLabel: string,
  output: ReleaseNotesOutput,
): string {
  const lines: string[] = [];

  // Title
  lines.push(`# ${output.title}`);
  lines.push('');

  // Date
  lines.push(`**Date:** ${output.date}`);
  lines.push('');

  // Executive summary
  lines.push('## Executive summary');
  lines.push('');
  lines.push(output.executiveSummary);
  lines.push('');

  // Highlights (max 3)
  if (output.highlights.length > 0) {
    lines.push('## Highlights');
    lines.push('');
    for (const highlight of output.highlights) {
      lines.push(`- ${highlight}`);
    }
    lines.push('');
  }

  // Changes
  const hasChanges =
    output.changes.features.length > 0 ||
    output.changes.fixes.length > 0 ||
    output.changes.chores.length > 0;

  if (hasChanges) {
    lines.push('## Changes');
    lines.push('');

    if (output.changes.features.length > 0) {
      lines.push('### Features');
      lines.push('');
      for (const commit of output.changes.features) {
        const clean = cleanCommitMessage(commit.message, 'features');
        lines.push(`- ${clean} ([${commit.sha.slice(0, 7)}](${commit.url})) - @${commit.author}`);
      }
      lines.push('');
    }

    if (output.changes.fixes.length > 0) {
      lines.push('### Fixes');
      lines.push('');
      for (const commit of output.changes.fixes) {
        const clean = cleanCommitMessage(commit.message, 'fixes');
        lines.push(`- ${clean} ([${commit.sha.slice(0, 7)}](${commit.url})) - @${commit.author}`);
      }
      lines.push('');
    }

    if (output.changes.chores.length > 0) {
      lines.push('### Maintenance');
      lines.push('');
      for (const commit of output.changes.chores) {
        const clean = cleanCommitMessage(commit.message, 'chores');
        lines.push(`- ${clean} ([${commit.sha.slice(0, 7)}](${commit.url})) - @${commit.author}`);
      }
      lines.push('');
    }
  }

  // Impact
  if (output.impact.length > 0) {
    lines.push('## Impact');
    lines.push('');
    for (const item of output.impact) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  // Risk & Notes (only if risks detected)
  if (output.riskNotes.length > 0) {
    lines.push('## Risk & Notes');
    lines.push('');
    for (const note of output.riskNotes) {
      lines.push(`- ${note}`);
    }
    lines.push('');
  }

  // Rollback / Mitigation (only if risks detected)
  if (output.rollback) {
    lines.push('## Rollback / Mitigation');
    lines.push('');
    lines.push(output.rollback);
    lines.push('');
  }

  // Links
  const allCommits = [
    ...output.changes.features,
    ...output.changes.fixes,
    ...output.changes.chores,
  ];
  if (allCommits.length > 0) {
    lines.push('## Links');
    lines.push('');
    for (const commit of allCommits) {
      const desc = stripPrefix(commit.message);
      lines.push(`- [${commit.sha.slice(0, 7)}](${commit.url}) — ${desc}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function execute(
  input: ReleaseNotesInput,
  _ctx: AgentContext,
): Promise<AgentResult<ReleaseNotesOutput>> {
  if (input.mode === 'github') {
    return Promise.reject(new Error('github mode not implemented yet'));
  }

  // Fixture mode - process provided commits
  const categorized = input.commits.map(categorizeCommit);

  const changes = {
    features: categorized.filter((c) => c.category === 'features'),
    fixes: categorized.filter((c) => c.category === 'fixes'),
    chores: categorized.filter((c) => c.category === 'chores'),
  };

  const date = new Date().toISOString().split('T')[0];
  const riskNotes = generateRiskNotes(categorized);
  const allRiskKeywords = categorized.flatMap((c) => c.riskKeywords);
  const hasRisks = riskNotes.length > 0;

  const output: ReleaseNotesOutput = {
    title: `Release notes — ${input.rangeLabel}`,
    highlights: generateHighlights(categorized),
    changes,
    riskNotes,
    date,
    executiveSummary: generateExecutiveSummary(changes),
    impact: generateImpact(changes, hasRisks),
    maintenance: changes.chores.map((c) => cleanCommitMessage(c.message, 'chores')),
    rollback: generateRollback(allRiskKeywords),
  };

  const markdown = generateMarkdown(input.repo, input.rangeLabel, output);

  return Promise.resolve({
    output,
    artifacts: [
      {
        kind: 'markdown',
        content: markdown,
        meta: {
          repo: input.repo,
          rangeLabel: input.rangeLabel,
        },
      },
    ],
  });
}

export const releaseNotesAgent: AgentDefinition<ReleaseNotesInput, ReleaseNotesOutput> = {
  name: 'release-notes',
  version: '0.1',
  inputSchema: ReleaseNotesInputSchema,
  outputSchema: ReleaseNotesOutputSchema,
  execute,
};
