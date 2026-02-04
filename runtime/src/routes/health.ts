import type { FastifyInstance } from 'fastify';

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/health', () => {
    return { ok: true };
  });
  await Promise.resolve();
}
