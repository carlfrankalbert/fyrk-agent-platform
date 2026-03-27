import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getOrCompute } from '../../lib/cache.js';
import { requireAuth } from './auth.js';

// Gaustad T-bane stop place ID (Entur National Stop Register)
const STOP_PLACE_ID = 'NSR:StopPlace:59519';
const ENTUR_URL = 'https://api.entur.io/journey-planner/v3/graphql';
const CLIENT_NAME = 'fyrk-husmor-hub';
const CACHE_TTL_MS = 60 * 1000; // 1 min (real-time data)

const DEPARTURES_QUERY = `
query stopPlace($id: String!, $n: Int!) {
  stopPlace(id: $id) {
    name
    estimatedCalls(
      timeRange: 3600
      numberOfDepartures: $n
    ) {
      expectedDepartureTime
      aimedDepartureTime
      realtime
      cancellation
      destinationDisplay {
        frontText
      }
      serviceJourney {
        line {
          publicCode
          transportMode
        }
      }
    }
  }
}
`;

export interface Departure {
  line: string;
  destination: string;
  departureTime: string;
  aimedTime: string;
  realtime: boolean;
  delayed: boolean;
  delayMinutes: number;
  cancelled: boolean;
  transportMode: string;
}

interface EnturResponse {
  stopName: string;
  departures: Departure[];
  updatedAt: string;
}

async function fetchDepartures(): Promise<EnturResponse> {
  const res = await fetch(ENTUR_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ET-Client-Name': CLIENT_NAME,
    },
    body: JSON.stringify({
      query: DEPARTURES_QUERY,
      variables: { id: STOP_PLACE_ID, n: 15 },
    }),
  });

  if (!res.ok) throw new Error(`Entur returned ${res.status}`);
  const json = await res.json() as Record<string, unknown>;
  const data = (json as { data: { stopPlace: Record<string, unknown> } }).data.stopPlace;

  const calls = data.estimatedCalls as Array<Record<string, unknown>>;
  const departures: Departure[] = calls.map((call) => {
    const expected = call.expectedDepartureTime as string;
    const aimed = call.aimedDepartureTime as string;
    const delayMs = new Date(expected).getTime() - new Date(aimed).getTime();
    const delayMinutes = Math.round(delayMs / 60000);
    const dest = call.destinationDisplay as { frontText: string };
    const sj = call.serviceJourney as { line: { publicCode: string; transportMode: string } };

    return {
      line: sj.line.publicCode,
      destination: dest.frontText,
      departureTime: expected,
      aimedTime: aimed,
      realtime: call.realtime as boolean,
      delayed: delayMinutes > 1,
      delayMinutes: Math.max(0, delayMinutes),
      cancelled: call.cancellation as boolean,
      transportMode: sj.line.transportMode,
    };
  });

  return {
    stopName: data.name as string,
    departures,
    updatedAt: new Date().toISOString(),
  };
}

export async function hubTransportRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/hub/api/transport', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(request, reply))) return;

    const transport = await getOrCompute('hub:transport', fetchDepartures, CACHE_TTL_MS);
    return transport;
  });
}
