import type { FastifyInstance } from 'fastify';

/**
 * Register a custom JSON content-type parser that preserves the raw body
 * as `__rawBody` on the parsed object. Required for Slack signature verification.
 *
 * Must be called inside an encapsulated Fastify sub-plugin so the custom parser
 * doesn't affect other routes.
 */
export function registerRawBodyParser(scope: FastifyInstance): void {
  scope.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        const json = JSON.parse(body as string);
        (json as Record<string, unknown>).__rawBody = body;
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );
}
