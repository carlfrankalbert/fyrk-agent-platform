import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { getEnv } from './env.js';

/** Header carrying the operator token for agents that touch private state. */
export const OPERATOR_HEADER = 'x-operator-token';

/** Constant-time comparison; fails closed when no token is configured. */
export function isOperatorToken(provided: unknown, expected: string | undefined): boolean {
  if (!expected || typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isOperatorRequest(request: FastifyRequest): boolean {
  return isOperatorToken(request.headers[OPERATOR_HEADER], getEnv().AGENT_OPERATOR_TOKEN);
}
