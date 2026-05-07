import { prisma } from '../config/db';
import { Prisma } from '@prisma/client';
import { log } from '../lib/logger';
import { fetchAllNews, filterRelevant, type FinnhubNewsItem, finnhubAvailable } from './finnhub.service';
import { scoreHeadline, claudeAvailable } from './claude.service';
import type { NewsStory, Bias, Impact } from '@prisma/client';
import { broadcastNews } from '../ws/news-broadcast';

// Circuit breaker — pauses polling for 30 min after credit-balance errors
let _creditCircuitOpenUntil = 0;
function isCreditError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes('credit balance is too low') || msg.includes('insufficient_quota');
}

/**
 * One pass: fetch latest news, dedupe against DB, score new items via Claude,
 * persist, broadcast over WebSocket.
 */
export async function pollAndScore(): Promise<{ scanned: number; new: number; errors: number }> {
  if (!finnhubAvailable()) {
    log.debug('news poll skipped — FINNHUB_API_KEY missing');
    return { scanned: 0, new: 0, errors: 0 };
  }
  if (!claudeAvailable()) {
    log.debug('news poll skipped — ANTHROPIC_API_KEY missing');
    return { scanned: 0, new: 0, errors: 0 };
  }
  if (Date.now() < _creditCircuitOpenUntil) {
    const minsLeft = Math.ceil((_creditCircuitOpenUntil - Date.now()) / 60_000);
    log.debug(`news poll skipped — Claude credit circuit open (retry in ${minsLeft}m)`);
    return { scanned: 0, new: 0, errors: 0 };
  }

  const items = filterRelevant(await fetchAllNews());
  if (!items.length) return { scanned: 0, new: 0, errors: 0 };

  // Dedupe vs DB — only score what we've never seen
  const finnhubIds = items.map((i) => String(i.id));
  const seen = await prisma.newsStory.findMany({
    where: { finnhubId: { in: finnhubIds } },
    select: { finnhubId: true },
  });
  const seenSet = new Set(seen.map((s) => s.finnhubId));
  const fresh = items.filter((i) => !seenSet.has(String(i.id)));

  if (!fresh.length) {
    return { scanned: items.length, new: 0, errors: 0 };
  }

  log.info(`Scoring ${fresh.length} new headlines (${items.length} scanned)`);

  // Score sequentially to respect Claude rate limits (and benefit from prompt caching)
  let scored = 0;
  let errors = 0;
  for (const item of fresh) {
    try {
      const story = await scoreAndStore(item);
      if (story) {
        broadcastNews(story);
        scored++;
      }
    } catch (e) {
      errors++;
      // Trip circuit breaker on credit-balance errors so we stop hammering the API
      if (isCreditError(e)) {
        _creditCircuitOpenUntil = Date.now() + 30 * 60 * 1000; // 30 min cooldown
        log.error('Anthropic credit balance exhausted — pausing news poller for 30min. Top up at https://console.anthropic.com/settings/billing');
        break; // stop this cycle immediately
      }
      log.warn('Failed to score headline', {
        finnhubId: item.id,
        headline: item.headline.slice(0, 80),
        err: e instanceof Error ? e.message : e,
      });
    }
  }

  return { scanned: items.length, new: scored, errors };
}

async function scoreAndStore(item: FinnhubNewsItem): Promise<NewsStory | null> {
  const score = await scoreHeadline(item.headline, item.summary);

  const bias: Bias = score.bias;
  const impact: Impact = score.impact;

  // Derive affectedAssets (legacy string[]) from the richer affectedMarkets list,
  // with fallback to old `assets` field if Claude returned the older format.
  const affectedAssets =
    score.affectedMarkets && score.affectedMarkets.length
      ? score.affectedMarkets.map((m) => m.symbol)
      : score.assets || [];

  // Store affectedMarkets as Json — null if empty so the UI knows to fall back
  const affectedMarketsJson =
    score.affectedMarkets && score.affectedMarkets.length
      ? (score.affectedMarkets as unknown as Prisma.InputJsonValue)
      : Prisma.JsonNull;

  return prisma.newsStory.upsert({
    where: { finnhubId: String(item.id) },
    update: {
      headline: item.headline,
      summary: item.summary || null,
      source: item.source,
      url: item.url,
      bias,
      impact,
      isBreaking: score.breaking,
      affectedAssets,
      affectedMarkets: affectedMarketsJson,
      reasoning: score.reasoning,
      publishedAt: new Date(item.datetime * 1000),
    },
    create: {
      finnhubId: String(item.id),
      headline: item.headline,
      summary: item.summary || null,
      source: item.source,
      url: item.url,
      bias,
      impact,
      isBreaking: score.breaking,
      affectedAssets,
      affectedMarkets: affectedMarketsJson,
      reasoning: score.reasoning,
      publishedAt: new Date(item.datetime * 1000),
    },
  });
}

// ──────── Read APIs ────────
export async function getRecentNews(limit = 50) {
  return prisma.newsStory.findMany({
    orderBy: { publishedAt: 'desc' },
    take: limit,
  });
}

export async function getBreakingNews(limit = 20) {
  return prisma.newsStory.findMany({
    where: { OR: [{ isBreaking: true }, { impact: 'high' }] },
    orderBy: { publishedAt: 'desc' },
    take: limit,
  });
}

export async function getNewsById(id: string) {
  return prisma.newsStory.findUnique({ where: { id } });
}
