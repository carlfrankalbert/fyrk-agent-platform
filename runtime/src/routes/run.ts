import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { RunRequestSchema, type RunResponse } from '../lib/schemas.js';
import { getAgent, listAgents } from '../agents/registry.js';
import { runAgent, type AgentContext } from '../agents/base.js';
import { SupabaseDbClient, NullDbClient, type DbClient } from '../db/client.js';

interface RunParams {
  agentName: string;
}

function getDbClient(dryRun: boolean): DbClient {
  if (dryRun) {
    return new NullDbClient();
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  }

  return new SupabaseDbClient(url, key);
}

export async function runRoutes(fastify: FastifyInstance): Promise<void> {
  // List available agents
  fastify.get('/agents', () => {
    return { agents: listAgents() };
  });

  // Run an agent
  fastify.post<{ Params: RunParams }>(
    '/run/:agentName',
    async (request: FastifyRequest<{ Params: RunParams }>, reply: FastifyReply): Promise<RunResponse> => {
      const { agentName } = request.params;

      // Find agent
      const agent = getAgent(agentName);
      if (!agent) {
        return reply.status(404).send({
          runId: '00000000-0000-0000-0000-000000000000',
          agentName,
          agentVersion: 'unknown',
          status: 'error',
          artifactIds: [],
          output: {},
          error: `Agent '${agentName}' not found. Available: ${listAgents().join(', ')}`,
        } satisfies RunResponse);
      }

      // Parse request body
      const parseResult = RunRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          runId: '00000000-0000-0000-0000-000000000000',
          agentName,
          agentVersion: agent.version,
          status: 'error',
          artifactIds: [],
          output: {},
          error: `Invalid request: ${parseResult.error.message}`,
        } satisfies RunResponse);
      }

      const { input, dryRun } = parseResult.data;

      // Get DB client
      const db = getDbClient(dryRun);

      // Create run record
      const run = await db.createRun({
        agent_name: agentName,
        agent_version: agent.version,
        status: 'started',
        input,
        output: {},
        error: null,
      });

      fastify.log.info({ runId: run.id, agentName, dryRun }, 'Agent run started');

      // Create context
      const ctx: AgentContext = {
        db,
        dryRun,
        runId: run.id,
      };

      // Run agent
      const result = await runAgent(agent, input, ctx);

      fastify.log.info({ runId: run.id, status: result.status }, 'Agent run finished');

      return result;
    }
  );

  await Promise.resolve();
}
