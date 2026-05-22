import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, '..', '..', 'static', 'editorial-room.html');
const PACKAGE_JSON_PATH = join(process.cwd(), 'package.json');

async function loadRuntimeVersion(): Promise<{ version: string; commit: string | null }> {
  const pkg = JSON.parse(await readFile(PACKAGE_JSON_PATH, 'utf-8')) as { version?: string };
  const commit = process.env.FLY_IMAGE_REF
    ?? process.env.SOURCE_COMMIT
    ?? process.env.SOURCE_VERSION
    ?? process.env.RELEASE_VERSION
    ?? null;

  return {
    version: pkg.version ?? 'unknown',
    commit,
  };
}

export async function editorialRoomRoutes(fastify: FastifyInstance): Promise<void> {
  const serveHtml = async (
    _request: unknown,
    reply: { type: (contentType: string) => { send: (body: string) => unknown } },
  ) => {
    const html = await readFile(HTML_PATH, 'utf-8');
    return reply.type('text/html').send(html);
  };

  fastify.get('/editor', serveHtml);
  fastify.get('/editor/', serveHtml);

  fastify.get('/editor/version', async () => loadRuntimeVersion());
  fastify.get('/editor/version/', async () => loadRuntimeVersion());
}
