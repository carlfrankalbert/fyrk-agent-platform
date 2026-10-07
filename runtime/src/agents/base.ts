import { z } from 'zod';
import type { DbClient } from '../db/client.js';
import type { RunResponse } from '../lib/schemas.js';

export interface AgentContext {
  db: DbClient;
  dryRun: boolean;
  publish: boolean;
  runId: string;
  /** True when the request carried a valid operator token (see lib/operator.ts). */
  operator?: boolean;
}

export interface AgentDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  version: string;
  /** Agents touching private state: the run route rejects requests without a valid operator token. */
  requiresOperator?: boolean;
  inputSchema: z.ZodType<TInput, z.ZodTypeDef, unknown>;
  outputSchema: z.ZodSchema<TOutput>;
  /**
   * Optional: what to store in agent_runs.input / agent_runs.output instead of the raw values, for agents handling
   * private state. The API response is unaffected. Agents without these hooks persist everything as before.
   */
  persistedInput?(rawInput: Record<string, unknown>): Record<string, unknown>;
  persistedOutput?(output: TOutput): Record<string, unknown>;
  execute(input: TInput, ctx: AgentContext): Promise<AgentResult<TOutput>>;
}

export interface AgentResult<TOutput = unknown> {
  output: TOutput;
  artifacts: AgentArtifact[];
}

export interface AgentArtifact {
  kind: string;
  content: string;
  meta?: Record<string, unknown>;
}

export async function runAgent<TInput, TOutput>(
  agent: AgentDefinition<TInput, TOutput>,
  rawInput: unknown,
  ctx: AgentContext
): Promise<RunResponse> {
  const artifactIds: string[] = [];

  try {
    // Validate input
    const input = agent.inputSchema.parse(rawInput);

    // Execute agent
    const result = await agent.execute(input, ctx);

    // Store artifacts
    for (const artifact of result.artifacts) {
      const stored = await ctx.db.createArtifact({
        run_id: ctx.runId,
        kind: artifact.kind,
        content: artifact.content,
        meta: artifact.meta ?? {},
      });
      artifactIds.push(stored.id);
    }

    // Update run status
    await ctx.db.updateRun(ctx.runId, {
      status: 'completed',
      output: agent.persistedOutput ? agent.persistedOutput(result.output) : result.output as Record<string, unknown>,
      finished_at: new Date().toISOString(),
    });

    return {
      runId: ctx.runId,
      agentName: agent.name,
      agentVersion: agent.version,
      status: 'ok',
      artifactIds,
      artifacts: result.artifacts.map((a, i) => ({
        id: artifactIds[i],
        kind: a.kind,
        content: a.content,
      })),
      publish: ctx.publish,
      output: result.output as Record<string, unknown>,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    await ctx.db.updateRun(ctx.runId, {
      status: 'failed',
      error: errorMessage,
      finished_at: new Date().toISOString(),
    });

    return {
      runId: ctx.runId,
      agentName: agent.name,
      agentVersion: agent.version,
      status: 'error',
      artifactIds,
      publish: ctx.publish,
      output: {},
      error: errorMessage,
    };
  }
}
