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

    it('should limit highlights to 5', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);
      const output = result.output as ReleaseNotesOutput;

      expect(output.highlights.length).toBeLessThanOrEqual(5);
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

  describe('markdown artifact', () => {
    it('should generate markdown with title', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);

      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0].kind).toBe('markdown');
      expect(result.artifacts[0].content).toContain('# Release Notes:');
    });

    it('should include Features heading when features exist', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);

      expect(result.artifacts[0].content).toContain('## Features');
    });

    it('should include Fixes heading when fixes exist', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);

      expect(result.artifacts[0].content).toContain('## Fixes');
    });

    it('should include Chores heading when chores exist', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);

      expect(result.artifacts[0].content).toContain('## Chores');
    });

    it('should include Risk Notes heading when risks exist', async () => {
      const result = await releaseNotesAgent.execute(commitsRisk, ctx);

      expect(result.artifacts[0].content).toContain('## Risk Notes');
    });

    it('should include commit links', async () => {
      const result = await releaseNotesAgent.execute(commitsBasic, ctx);

      expect(result.artifacts[0].content).toContain('[abc1234](https://github.com/');
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
