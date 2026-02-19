import Fastify from 'fastify';
import { validateEnv } from './lib/env.js';
import { healthRoutes } from './routes/health.js';
import { runRoutes } from './routes/run.js';

async function main(): Promise<void> {
  const env = validateEnv();

  const fastify = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
  });

  // Register routes
  await fastify.register(healthRoutes);
  await fastify.register(runRoutes);

  // Start server
  try {
    await fastify.listen({ port: env.PORT, host: env.HOST });
    fastify.log.info(`Server running at http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error:', err);
  process.exit(1);
});
