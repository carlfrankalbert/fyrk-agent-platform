import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEARNINGS_PATH = join(__dirname, '..', 'agents', 'cv-tailor', 'learnings.json');
const HTML_PATH = join(__dirname, '..', '..', 'static', 'cv-tailor.html');

const LearnRequestSchema = z.object({
  entries: z.array(z.object({
    question: z.string().min(1),
    answer: z.string().min(1),
    jobContext: z.string().optional(),
  })).min(1),
});

export interface Learning {
  question: string;
  answer: string;
  jobContext?: string;
  savedAt: string;
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
  // Serve the CV Tailor UI
  fastify.get('/cv-tailor', async (_request, reply) => {
    const html = await readFile(HTML_PATH, 'utf-8');
    return reply.type('text/html').send(html);
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
