import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { getSupabase } from '../../lib/supabase.js';
import { getEnv } from '../../lib/env.js';

const SESSION_TTL_DAYS = 30;

const VerifyCodeSchema = z.object({
  code: z.string().min(1),
});

/** Verify session token from Authorization header. Returns email or null. */
export async function verifySession(request: FastifyRequest): Promise<string | null> {
  const auth = request.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;

  const token = auth.slice(7);
  const supabase = getSupabase();
  const { data } = await supabase
    .from('hub_sessions')
    .select('email, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return data.email;
}

/** Auth guard — sends 401 if not authenticated. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const email = await verifySession(request);
  if (!email) {
    reply.status(401).send({ error: 'Unauthorized' });
    return null;
  }
  return email;
}

export async function hubAuthRoutes(fastify: FastifyInstance): Promise<void> {
  // Verify access code and create session
  fastify.post('/hub/api/auth/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = VerifyCodeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Ugyldig kode' });
    }

    const env = getEnv();
    const accessCode = env.HUB_ACCESS_CODE;

    if (!accessCode) {
      return reply.status(500).send({ error: 'HUB_ACCESS_CODE not configured' });
    }

    if (parsed.data.code !== accessCode) {
      return reply.status(401).send({ error: 'Feil kode' });
    }

    // Create session
    const supabase = getSupabase();
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    await supabase.from('hub_sessions').insert({
      email: 'familie@husmor.hub',
      token,
      expires_at: expiresAt.toISOString(),
    });

    return { ok: true, token, expiresAt: expiresAt.toISOString() };
  });

  // Check current session
  fastify.get('/hub/api/auth/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const email = await verifySession(request);
    if (!email) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    return { email };
  });
}
