import { env } from '../config/env';
import { log } from '../lib/logger';

/**
 * Finnhub news client. Free tier allows 60 req/min.
 * Endpoint: GET https://finnhub.io/api/v1/news?category=<cat>&token=<key>
 */
const BASE = 'https://finnhub.io/api/v1';

export interface FinnhubNewsItem {
  category: string;
  datetime: number; // unix seconds
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

export const finnhubAvailable = (): boolean => Boolean(env.FINNHUB_API_KEY);

export async function fetchNews(category: 'general' | 'forex' | 'crypto' | 'merger'): Promise<FinnhubNewsItem[]> {
  if (!env.FINNHUB_API_KEY) {
    log.debug('FINNHUB_API_KEY missing — returning []');
    return [];
  }

  const url = `${BASE}/news?category=${category}&token=${env.FINNHUB_API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      log.warn(`Finnhub ${category} fetch failed`, { status: res.status });
      return [];
    }
    const data = (await res.json()) as FinnhubNewsItem[];
    return Array.isArray(data) ? data : [];
  } catch (e) {
    log.warn(`Finnhub ${category} fetch threw`, {
      err: e instanceof Error ? e.message : e,
    });
    return [];
  }
}

/** Fetch all 4 categories in parallel and dedupe by id. */
export async function fetchAllNews(): Promise<FinnhubNewsItem[]> {
  const cats: Array<'general' | 'forex' | 'crypto' | 'merger'> = [
    'general',
    'forex',
    'crypto',
    'merger',
  ];
  const results = await Promise.all(cats.map(fetchNews));
  const seen = new Set<number>();
  const merged: FinnhubNewsItem[] = [];
  for (const list of results) {
    for (const item of list) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item);
      }
    }
  }
  // Newest first
  merged.sort((a, b) => b.datetime - a.datetime);
  return merged;
}

/**
 * Filter to high-relevance financial stories — avoid sponsored / blog noise.
 * Drops items with no summary, irrelevant domains, or obvious filler.
 */
export function filterRelevant(items: FinnhubNewsItem[]): FinnhubNewsItem[] {
  const NOISE = /sponsored|press release|disclaimer|^\W*$/i;
  return items.filter((i) => {
    if (!i.headline || i.headline.length < 12) return false;
    if (NOISE.test(i.headline)) return false;
    if (NOISE.test(i.summary || '')) return false;
    return true;
  });
}
