import { env } from '../config/env';
import { log } from '../lib/logger';

/**
 * Finnhub economic calendar.
 * Endpoint: GET /v1/calendar/economic?from=YYYY-MM-DD&to=YYYY-MM-DD&token=...
 * Returns events with country, event, impact (low/medium/high), actual, estimate, prev.
 *
 * Free tier supports this endpoint with daily refresh limits, so we cache
 * in-memory and refresh once an hour by default.
 */
const BASE = 'https://finnhub.io/api/v1';

export type Impact = 'high' | 'medium' | 'low';

export interface CalendarEvent {
  time: string;        // ISO datetime
  country: string;     // 'US', 'GB', 'EU', etc.
  currency: string;    // mapped from country: USD, GBP, EUR
  event: string;
  impact: Impact;
  actual: number | null;
  estimate: number | null;
  previous: number | null;
  unit: string;
}

interface FinnhubEcoItem {
  actual?: number;
  country: string; // 2-letter or word
  estimate?: number;
  event: string;
  impact: 'low' | 'medium' | 'high' | string;
  prev?: number;
  time: string;
  unit?: string;
}

const COUNTRY_TO_CCY: Record<string, string> = {
  US: 'USD', USA: 'USD', 'United States': 'USD',
  GB: 'GBP', UK: 'GBP', 'United Kingdom': 'GBP',
  DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', EU: 'EUR', 'Euro Area': 'EUR',
  JP: 'JPY', Japan: 'JPY',
  CN: 'CNY', China: 'CNY',
  CA: 'CAD', Canada: 'CAD',
  AU: 'AUD', Australia: 'AUD',
  NZ: 'NZD', 'New Zealand': 'NZD',
  CH: 'CHF', Switzerland: 'CHF',
};
function ccy(country: string): string {
  return COUNTRY_TO_CCY[country] || country.slice(0, 3).toUpperCase();
}

// Finnhub returns wall-clock UTC strings. Convert to a true ISO-8601 instant
// so `new Date(...)` resolves to the same moment regardless of where the
// browser is running. Already-zoned strings are returned unchanged.
function toIsoUtc(t: string): string {
  if (!t) return t;
  // If the string already carries a zone (Z, +HH:MM, -HH:MM), trust it.
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(t)) {
    const d = new Date(t);
    return isNaN(d.getTime()) ? t : d.toISOString();
  }
  // "YYYY-MM-DD HH:MM:SS" → treat as UTC by swapping space for "T" and
  // appending "Z". Date.UTC parsing handles the rest.
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) {
    const d = new Date(t + 'Z');
    return isNaN(d.getTime()) ? t : d.toISOString();
  }
  const [, y, mo, da, hh, mm, ss = '00'] = m;
  const utcMs = Date.UTC(+y, +mo - 1, +da, +hh, +mm, +ss);
  return new Date(utcMs).toISOString();
}
function normaliseImpact(i: string): Impact {
  const v = (i || '').toLowerCase();
  if (v.startsWith('h')) return 'high';
  if (v.startsWith('m')) return 'medium';
  return 'low';
}

// In-memory cache — { until: epoch ms, data: events[] }
let cache: { until: number; data: CalendarEvent[] } | null = null;
const TTL_MS = 60 * 60 * 1000; // 1 hour

export const calendarAvailable = (): boolean => Boolean(env.FINNHUB_API_KEY);

/** Fetch a date range from Finnhub. Cached for 1 hour. */
export async function fetchCalendar(opts?: {
  from?: string;
  to?: string;
  force?: boolean;
}): Promise<CalendarEvent[]> {
  if (!env.FINNHUB_API_KEY) return [];

  if (!opts?.force && cache && cache.until > Date.now()) return cache.data;

  // Default: today through +7 days
  const today = new Date();
  const week = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const from = opts?.from || fmt(today);
  const to = opts?.to || fmt(week);

  const url = `${BASE}/calendar/economic?from=${from}&to=${to}&token=${env.FINNHUB_API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      log.warn('Finnhub calendar fetch failed', { status: res.status });
      return cache?.data || [];
    }
    const data = (await res.json()) as { economicCalendar?: FinnhubEcoItem[] };
    const items = data.economicCalendar || [];
    const events: CalendarEvent[] = items.map((i) => ({
      // Finnhub returns "2026-05-08 13:30:00" — wall clock UTC with no zone
      // marker. Browsers parse that as LOCAL, which silently shifts every
      // release by the user's offset. Coerce to proper ISO-8601 UTC so the
      // frontend always has an unambiguous instant to format.
      time: toIsoUtc(i.time),
      country: i.country,
      currency: ccy(i.country),
      event: i.event,
      impact: normaliseImpact(String(i.impact)),
      actual: typeof i.actual === 'number' ? i.actual : null,
      estimate: typeof i.estimate === 'number' ? i.estimate : null,
      previous: typeof i.prev === 'number' ? i.prev : null,
      unit: i.unit || '',
    }));
    // Sort by time ascending
    events.sort((a, b) => a.time.localeCompare(b.time));
    cache = { until: Date.now() + TTL_MS, data: events };
    log.info(`Calendar refreshed: ${events.length} events (${from} → ${to})`);
    return events;
  } catch (e) {
    log.warn('Finnhub calendar fetch threw', {
      err: e instanceof Error ? e.message : e,
    });
    return cache?.data || [];
  }
}

/** Filter helpers used by the route. */
export function filterCalendar(
  events: CalendarEvent[],
  opts: { impact?: Impact[]; currencies?: string[] },
): CalendarEvent[] {
  return events.filter((e) => {
    if (opts.impact && opts.impact.length && !opts.impact.includes(e.impact)) return false;
    if (opts.currencies && opts.currencies.length && !opts.currencies.includes(e.currency)) return false;
    return true;
  });
}

/** Group events by date for UI rendering. */
export function groupByDate(events: CalendarEvent[]): Record<string, CalendarEvent[]> {
  const out: Record<string, CalendarEvent[]> = {};
  for (const e of events) {
    const d = e.time.slice(0, 10);
    (out[d] ||= []).push(e);
  }
  return out;
}
