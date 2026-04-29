import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CvTailorOutputSchema } from '../agents/cv-tailor/schemas.js';
import { buildCvDocx, buildCvDocxFilename } from '../lib/cv-docx.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEARNINGS_PATH = join(__dirname, '..', 'agents', 'cv-tailor', 'learnings.json');
const HTML_PATH = join(__dirname, '..', '..', 'static', 'cv-tailor.html');
const PACKAGE_JSON_PATH = join(process.cwd(), 'package.json');

const LearnRequestSchema = z.object({
  entries: z.array(z.object({
    question: z.string().min(1),
    answer: z.string().min(1),
    jobContext: z.string().optional(),
  })).min(1),
});

const ExportDocxRequestSchema = z.object({
  cv: CvTailorOutputSchema.shape.cv,
});

export interface Learning {
  question: string;
  answer: string;
  jobContext?: string;
  savedAt: string;
}

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

async function loadLearnings(): Promise<Learning[]> {
  try {
    const raw = await readFile(LEARNINGS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveLearnings(learnings: Learning[]): Promise<void> {
  await writeFile(LEARNINGS_PATH, JSON.stringify(learnings, null, 2) + '\n', 'utf-8');
}

export async function cvTailorRoutes(fastify: FastifyInstance): Promise<void> {
  const serveCvTailorHtml = async (_request: unknown, reply: { type: (contentType: string) => { send: (body: string) => unknown } }) => {
    const html = await readFile(HTML_PATH, 'utf-8');
    return reply.type('text/html').send(html);
  };

  // Serve the CV Tailor UI
  fastify.get('/cv-tailor', serveCvTailorHtml);
  fastify.get('/cv-tailor/', serveCvTailorHtml);

  fastify.get('/cv-tailor/version', async () => {
    return loadRuntimeVersion();
  });
  fastify.get('/cv-tailor/version/', async () => {
    return loadRuntimeVersion();
  });

  fastify.post('/cv-tailor/export-docx', async (request, reply) => {
    const parse = ExportDocxRequestSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({ error: parse.error.message });
    }

    const buffer = await buildCvDocx(parse.data.cv);
    const filename = buildCvDocxFilename(parse.data.cv.name);

    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send(buffer);
  });
  fastify.post('/cv-tailor/export-docx/', async (request, reply) => {
    const parse = ExportDocxRequestSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({ error: parse.error.message });
    }

    const buffer = await buildCvDocx(parse.data.cv);
    const filename = buildCvDocxFilename(parse.data.cv.name);

    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send(buffer);
  });

  // Save gap-analysis answers to the experience learnings
  fastify.post('/cv-tailor/learn', async (request, reply) => {
    const parse = LearnRequestSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({ error: parse.error.message });
    }

    const existing = await loadLearnings();
    const now = new Date().toISOString();

    const newEntries: Learning[] = parse.data.entries.map((e) => ({
      question: e.question,
      answer: e.answer,
      jobContext: e.jobContext,
      savedAt: now,
    }));

    const merged = [...existing, ...newEntries];
    await saveLearnings(merged);

    fastify.log.info({ count: newEntries.length, total: merged.length }, 'CV learnings saved');
    return { saved: newEntries.length, total: merged.length };
  });

  // Get all learnings
  fastify.get('/cv-tailor/learnings', async () => {
    const learnings = await loadLearnings();
    return { learnings, count: learnings.length };
  });
}
