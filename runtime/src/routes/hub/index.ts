import type { FastifyInstance } from 'fastify';
import { hubAuthRoutes } from './auth.js';
import { hubWeatherRoutes } from './weather.js';
import { hubTransportRoutes } from './transport.js';
import { hubMealsRoutes } from './meals.js';
import { hubShoppingRoutes } from './shopping.js';
import { hubCalendarRoutes } from './calendar.js';
import { hubReminderRoutes } from './reminders.js';
import { hubChildrenRoutes } from './children.js';
import { hubVoiceRoutes } from './voice.js';
import { hubOdaRoutes } from './oda.js';
import { hubMealsChatRoutes } from './meals-chat.js';
import { hubProactiveRoutes } from './proactive.js';
import { hubSettingsRoutes } from './settings.js';
import { hubAnalyticsRoutes } from './analytics.js';
import { join } from 'path';
import { existsSync } from 'fs';

export async function hubRoutes(fastify: FastifyInstance): Promise<void> {
  // Register API routes
  await hubAuthRoutes(fastify);
  await hubWeatherRoutes(fastify);
  await hubTransportRoutes(fastify);
  await hubMealsRoutes(fastify);
  await hubShoppingRoutes(fastify);
  await hubCalendarRoutes(fastify);
  await hubReminderRoutes(fastify);
  await hubChildrenRoutes(fastify);
  await hubVoiceRoutes(fastify);
  await hubOdaRoutes(fastify);
  await hubMealsChatRoutes(fastify);
  await hubProactiveRoutes(fastify);
  await hubSettingsRoutes(fastify);
  await hubAnalyticsRoutes(fastify);

  // Serve frontend static files (production build)
  const hubDistPath = join(process.cwd(), '..', 'hub', 'dist');
  const hubDistAlt = join(process.cwd(), 'hub-dist'); // Docker: copied alongside dist/

  const staticPath = existsSync(hubDistPath) ? hubDistPath : existsSync(hubDistAlt) ? hubDistAlt : null;

  if (staticPath) {
    const fastifyStatic = await import('@fastify/static');
    await fastify.register(fastifyStatic.default, {
      root: staticPath,
      prefix: '/hub/',
      decorateReply: false,
    });

    // SPA fallback: serve index.html for non-API, non-asset routes
    fastify.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/hub/') && !request.url.startsWith('/hub/api/')) {
        return reply.sendFile('index.html', staticPath);
      }
      return reply.status(404).send({ error: 'Not found' });
    });

    fastify.log.info({ path: staticPath }, 'Hub frontend served at /hub/');
  } else {
    fastify.log.info('Hub frontend not found — API-only mode (run `pnpm build` in hub/)');
  }
}
