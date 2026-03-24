import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createSign } from 'crypto';
import { getOrCompute } from '../husmor/cache.js';
import { requireAuth } from './auth.js';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location?: string;
  description?: string;
  calendar: string;
  color?: string;
}

interface CalendarResponse {
  events: CalendarEvent[];
  updatedAt: string;
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function base64url(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64url');
}

function createJwt(key: ServiceAccountKey): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: key.client_email,
    scope: SCOPES,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));

  const signInput = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signInput);
  const signature = signer.sign(key.private_key, 'base64url');

  return `${signInput}.${signature}`;
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(key: ServiceAccountKey): Promise<string> {
  if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAt - 60_000) {
    return cachedAccessToken.token;
  }

  const jwt = createJwt(key);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Google token exchange failed: ${res.status} ${body}`);
    throw new Error(`Google token exchange failed: ${res.status}`);
  }
  const data = await res.json() as { access_token: string; expires_in: number };

  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

function parseServiceAccountKey(): ServiceAccountKey | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ServiceAccountKey;
  } catch {
    return null;
  }
}

function getCalendarIds(): string[] {
  const raw = process.env.HUB_GOOGLE_CALENDAR_IDS;
  if (!raw) return ['primary'];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

// Calendar name/color map from env: "id1:Name1:color1,id2:Name2:color2"
function getCalendarMeta(): Map<string, { name: string; color?: string }> {
  const map = new Map<string, { name: string; color?: string }>();
  const raw = process.env.HUB_GOOGLE_CALENDAR_META;
  if (!raw) return map;
  for (const entry of raw.split(',')) {
    const [id, name, color] = entry.split(':');
    if (id && name) map.set(id.trim(), { name: name.trim(), color: color?.trim() });
  }
  return map;
}

async function fetchCalendarEvents(
  token: string,
  calendarId: string,
  meta: Map<string, { name: string; color?: string }>,
): Promise<CalendarEvent[]> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 7 * 24 * 60 * 60 * 1000); // next 7 days

  const params = new URLSearchParams({
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '20',
  });

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Calendar API error for ${calendarId}: ${res.status} ${body}`);
    return [];
  }

  const data = await res.json() as {
    items?: Array<{
      id: string;
      summary?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      location?: string;
      description?: string;
    }>;
  };

  const calMeta = meta.get(calendarId);

  return (data.items ?? []).map(item => ({
    id: item.id,
    title: item.summary ?? '(Ingen tittel)',
    startTime: item.start?.dateTime ?? item.start?.date ?? '',
    endTime: item.end?.dateTime ?? item.end?.date ?? '',
    allDay: !item.start?.dateTime,
    location: item.location,
    description: item.description,
    calendar: calMeta?.name ?? calendarId,
    color: calMeta?.color,
  }));
}

export async function fetchAllCalendars(): Promise<CalendarResponse> {
  const key = parseServiceAccountKey();
  if (!key) return { events: [], updatedAt: new Date().toISOString() };

  const token = await getAccessToken(key);
  const calendarIds = getCalendarIds();
  const meta = getCalendarMeta();

  const results = await Promise.all(
    calendarIds.map(id => fetchCalendarEvents(token, id, meta)),
  );

  const events = results
    .flat()
    .sort((a, b) => {
      // All-day first, then by start time
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return a.startTime.localeCompare(b.startTime);
    });

  return { events, updatedAt: new Date().toISOString() };
}

export async function hubCalendarRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/hub/api/calendar', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(request, reply))) return;

    const key = parseServiceAccountKey();
    if (!key) {
      fastify.log.warn('Google Calendar not configured — GOOGLE_SERVICE_ACCOUNT_KEY missing');
      return { events: [], updatedAt: new Date().toISOString(), configured: false };
    }

    try {
      const calendar = await getOrCompute('hub:calendar', fetchAllCalendars, CACHE_TTL_MS);
      fastify.log.info({ eventCount: calendar.events.length }, 'Calendar fetched');
      return calendar;
    } catch (err) {
      fastify.log.error(err, 'Calendar fetch failed');
      return { events: [], updatedAt: new Date().toISOString() };
    }
  });
}
