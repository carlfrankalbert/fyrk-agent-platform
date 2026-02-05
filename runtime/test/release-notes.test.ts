import { describe, it, expect, beforeEach } from 'vitest';
import { releaseNotesAgent } from '../src/agents/release-notes/index.js';
import { NullDbClient } from '../src/db/client.js';
import type { AgentContext } from '../src/agents/base.js';
import type { ReleaseNotesOutput } from '../src/agents/release-notes/schemas.js';
import commitsBasic from './fixtures/commits_basic.json';
import commitsRisk from './fixtures/commits_risk.json';

describe('release-notes agent', () => {
  let ctx: AgentContext;

  beforeEach(() => {
    ctx = {
      db: new NullDbClient(),
      dryRun: true,
      runId: 'test-run-id',
    };
  });

  describe('categorization', () => {
    it('should categorize feat commits as features', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);
      const output = result.output as ReleaseNotesOutput;

      expect(output.changes.features).toHaveLength(2);
      expect(output.changes.features[0].message).toContain('feat:');
    });

    it('should categorize fix commits as fixes', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);
      const output = result.output as ReleaseNotesOutput;

      expect(output.changes.fixes).toHaveLength(1);
      expect(output.changes.fixes[0].message).toContain('fix:');
    });

    it('should categorize chore and docs commits as chores', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);
      const output = result.output as ReleaseNotesOutput;

      expect(output.changes.chores).toHaveLength(2);
      expect(output.changes.chores.some((c) => c.message.includes('chore:'))).toBe(true);
      expect(output.changes.chores.some((c) => c.message.includes('docs:'))).toBe(true);
    });
  });

  describe('highlights', () => {
    it('should prioritize features in highlights', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);
      const output = result.output as ReleaseNotesOutput;

      expect(output.highlights.length).toBeGreaterThan(0);
      expect(output.highlights[0]).toContain('user authentication');
    });

    it('should limit highlights to 3', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);
      const output = result.output as ReleaseNotesOutput;

      expect(output.highlights.length).toBeLessThanOrEqual(3);
    });
  });

  describe('risk detection', () => {
    it('should detect breaking keyword', async () => {
      const result = await releaseNotesAgent.execute(commitsRisk, ctx);
      const output = result.output as ReleaseNotesOutput;

      expect(output.riskNotes.some((n) => n.includes('breaking'))).toBe(true);
    });

    it('should detect security keyword', async () => {
      const result = await releaseNotesAgent.execute(commitsRisk, ctx);
      const output = result.output as ReleaseNotesOutput;

      expect(output.riskNotes.some((n) => n.includes('security'))).toBe(true);
    });

    it('should detect db keyword', async () => {
      const result = await releaseNotesAgent.execute(commitsRisk, ctx);
      const output = result.output as ReleaseNotesOutput;

      expect(output.riskNotes.some((n) => n.includes('db'))).toBe(true);
    });

    it('should detect payment keyword', async () => {
      const result = await releaseNotesAgent.execute(commitsRisk, ctx);
      const output = result.output as ReleaseNotesOutput;

      expect(output.riskNotes.some((n) => n.includes('payment'))).toBe(true);
    });

    it('should detect pii keyword', async () => {
      const result = await releaseNotesAgent.execute(commitsRisk, ctx);
      const output = result.output as ReleaseNotesOutput;

      expect(output.riskNotes.some((n) => n.includes('pii'))).toBe(true);
    });
  });

  describe('new output fields', () => {
    it('should include date in YYYY-MM-DD format', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);
      const output = result.output as ReleaseNotesOutput;

      expect(output.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should include executiveSummary', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);
      const output = result.output as ReleaseNotesOutput;

      expect(output.executiveSummary).toBeTruthy();
      expect(typeof output.executiveSummary).toBe('string');
    });

    it('should include impact with max 3 items', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);
      const output = result.output as ReleaseNotesOutput;

      expect(output.impact.length).toBeGreaterThan(0);
      expect(output.impact.length).toBeLessThanOrEqual(3);
    });

    it('should include maintenance as public alias of chores', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);
      const output = result.output as ReleaseNotesOutput;

      expect(output.maintenance).toHaveLength(output.changes.chores.length);
    });

    it('should set rollback to null when no risks', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);
      const output = result.output as ReleaseNotesOutput;

      expect(output.rollback).toBeNull();
    });

    it('should set rollback when risks are present', async () => {
      const result = await releaseNotesAgent.execute(commitsRisk, ctx);
      const output = result.output as ReleaseNotesOutput;

      expect(output.rollback).toBeTruthy();
      expect(typeof output.rollback).toBe('string');
    });
  });

  describe('markdown artifact', () => {
    it('should generate markdown with FYRK title format', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);

      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0].kind).toBe('markdown');
      expect(result.artifacts[0].content).toContain('# Release notes —');
    });

    it('should include date in markdown', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);

      expect(result.artifacts[0].content).toMatch(/\*\*Date:\*\* \d{4}-\d{2}-\d{2}/);
    });

    it('should include Executive summary section', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);

      expect(result.artifacts[0].content).toContain('## Executive summary');
    });

    it('should include Highlights section', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);

      expect(result.artifacts[0].content).toContain('## Highlights');
    });

    it('should include Changes section with subsections', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);
      const md = result.artifacts[0].content;

      expect(md).toContain('## Changes');
      expect(md).toContain('### Features');
      expect(md).toContain('### Fixes');
      expect(md).toContain('### Maintenance');
    });

    it('should include Impact section', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);

      expect(result.artifacts[0].content).toContain('## Impact');
    });

    it('should include Links section', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);

      expect(result.artifacts[0].content).toContain('## Links');
    });

    it('should include commit links', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);

      expect(result.artifacts[0].content).toContain('[abc1234](https://github.com/');
    });

    it('should include Risk & Notes only when risks present', async () => {
      const basicResult = await releaseNotesAgent.execute(commitsBasic, ctx);
      const riskResult = await releaseNotesAgent.execute(commitsRisk, ctx);

      expect(basicResult.artifacts[0].content).not.toContain('## Risk & Notes');
      expect(riskResult.artifacts[0].content).toContain('## Risk & Notes');
    });

    it('should include Rollback / Mitigation only when risks present', async () => {
      const basicResult = await releaseNotesAgent.execute(commitsBasic, ctx);
      const riskResult = await releaseNotesAgent.execute(commitsRisk, ctx);

      expect(basicResult.artifacts[0].content).not.toContain('## Rollback / Mitigation');
      expect(riskResult.artifacts[0].content).toContain('## Rollback / Mitigation');
    });

    it('should never contain "feat", "fix", "chore", or "refactor" in markdown', async () => {
      const basicResult = await releaseNotesAgent.execute(commitsBasic, ctx);
      const riskResult = await releaseNotesAgent.execute(commitsRisk, ctx);

      for (const result of [basicResult, riskResult]) {
        const md = result.artifacts[0].content;
        expect(md).not.toMatch(/\bfeat\b/);
        expect(md).not.toMatch(/\bfix\b/);
        expect(md).not.toMatch(/\bchore\b/);
        expect(md).not.toMatch(/\brefactor\b/);
      }
    });

    it('should use Norwegian-style verbs in change items', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);
      const md = result.artifacts[0].content;

      expect(md).toContain('Lagt til');
      expect(md).toContain('Rettet');
    });
  });

  describe('error handling', () => {
    it('should throw error for github mode', async () => {
      const githubInput = {
        mode: 'github' as const,
        repo: 'owner/repo',
        from: 'v1.0.0',
        to: 'v1.1.0',
      };

      await expect(releaseNotesAgent.execute(githubInput, ctx)).rejects.toThrow(
        'github mode not implemented yet'
      );
    });
  });
});
