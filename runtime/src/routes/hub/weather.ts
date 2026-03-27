import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getOrCompute } from '../../lib/cache.js';
import { requireAuth } from './auth.js';

// Gaustad T-bane, Oslo
const LAT = 59.9486;
const LON = 10.7173;
const YR_URL = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${LAT}&lon=${LON}`;
const USER_AGENT = 'HusmorHub/1.0 github.com/fyrk';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

interface WeatherPoint {
  time: string;
  temperature: number;
  feelsLike?: number;
  windSpeed: number;
  windDirection: number;
  humidity: number;
  precipitation: number;
  symbolCode: string;
}

interface WeatherResponse {
  current: WeatherPoint;
  hourly: WeatherPoint[];
  daily: Array<{
    date: string;
    minTemp: number;
    maxTemp: number;
    symbolCode: string;
    precipitation: number;
  }>;
  updatedAt: string;
}

function parseYrResponse(data: Record<string, unknown>): WeatherResponse {
  const props = data.properties as Record<string, unknown>;
  const timeseries = props.timeseries as Array<Record<string, unknown>>;

  const points: WeatherPoint[] = timeseries.slice(0, 48).map((ts) => {
    const d = ts.data as Record<string, unknown>;
    const instant = (d.instant as Record<string, unknown>).details as Record<string, number>;
    const next1h = d.next_1_hours as Record<string, unknown> | undefined;
    const summary = next1h?.summary as Record<string, string> | undefined;
    const details = next1h?.details as Record<string, number> | undefined;

    return {
      time: ts.time as string,
      temperature: instant.air_temperature,
      windSpeed: instant.wind_speed,
      windDirection: instant.wind_from_direction,
      humidity: instant.relative_humidity,
      precipitation: details?.precipitation_amount ?? 0,
      symbolCode: summary?.symbol_code ?? 'cloudy',
    };
  });

  // Daily aggregation (next 7 days)
  const dayMap = new Map<string, { temps: number[]; symbols: string[]; precip: number }>();
  for (const p of points) {
    const date = p.time.slice(0, 10);
    let day = dayMap.get(date);
    if (!day) {
      day = { temps: [], symbols: [], precip: 0 };
      dayMap.set(date, day);
    }
    day.temps.push(p.temperature);
    day.symbols.push(p.symbolCode);
    day.precip += p.precipitation;
  }

  const daily = Array.from(dayMap.entries()).map(([date, d]) => ({
    date,
    minTemp: Math.min(...d.temps),
    maxTemp: Math.max(...d.temps),
    symbolCode: d.symbols[Math.floor(d.symbols.length / 2)], // midday symbol
    precipitation: Math.round(d.precip * 10) / 10,
  }));

  return {
    current: points[0],
    hourly: points.slice(0, 24),
    daily,
    updatedAt: new Date().toISOString(),
  };
}

async function fetchWeather(): Promise<WeatherResponse> {
  const res = await fetch(YR_URL, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`Yr.no returned ${res.status}`);
  const data = await res.json() as Record<string, unknown>;
  return parseYrResponse(data);
}

export async function hubWeatherRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/hub/api/weather', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(request, reply))) return;

    const weather = await getOrCompute('hub:weather', fetchWeather, CACHE_TTL_MS);
    return weather;
  });
}
