/**
 * Recurring background jobs.
 *
 * We use plain `setInterval` rather than node-cron — TradeContext runs as a
 * single-process server, so a process-local interval is the simplest reliable
 * scheduler. If the server restarts, the next tick happens at the next interval
 * boundary (no missed-job recovery), which is fine for the workloads here.
 *
 * Jobs:
 *  • dailyMarketWrap    — Claude generates the day-ahead BlogPost. Once at the
 *                          top of every UTC hour, but only acts when minute===0
 *                          and the local UTC hour matches WRAP_AT_UTC_HOUR (06).
 *  • biasOutcomeSnapshot — Picks every fresh BiasOutcome where price-after-Nh
 *                           is still NULL and N hours have elapsed, fetches the
 *                           current price, and stamps the hit/miss flag.
 *
 * Both jobs no-op silently when their preconditions aren't met (e.g. Claude
 * credits exhausted, or backend boots mid-day so the wrap already published).
 */
import { prisma } from '../config/db';
import { generateMarketWrap } from './blog-generator.service';
import { getPrice } from './price.service';
import { log } from '../lib/logger';
import { claudeAvailable } from './claude.service';

const WRAP_AT_UTC_HOUR = 6;            // 06:00 UTC daily — pre-London-open
const SNAPSHOT_INTERVAL_MS = 5 * 60_000; // 5 min — cheap because we batch
const WRAP_INTERVAL_MS = 60_000;        // re-check every minute

let _wrapPublishedYmd: string | null = null;

async function tickDailyMarketWrap() {
  try {
    const now = new Date();
    if (now.getUTCHours() !== WRAP_AT_UTC_HOUR) return;
    const ymd = now.toISOString().slice(0, 10);
    if (_wrapPublishedYmd === ymd) return;        // already done today

    if (!claudeAvailable()) {
      log.debug('cron: market wrap skipped — Claude not configured');
      return;
    }

    // Existing DB check — survive restarts on the same UTC day
    const existing = await prisma.blogPost.findFirst({
      where: { kind: 'market-wrap', publishedAt: { gte: new Date(ymd + 'T00:00:00Z') } },
      select: { id: true },
    });
    if (existing) {
      _wrapPublishedYmd = ymd;
      return;
    }

    log.info('cron: generating daily market wrap');
    const post = await generateMarketWrap();
    _wrapPublishedYmd = ymd;
    log.info('cron: market wrap published', { slug: post.slug });
  } catch (err) {
    log.warn('cron: market wrap failed', { err: err instanceof Error ? err.message : String(err) });
  }
}

async function tickBiasOutcomeSnapshot() {
  try {
    // Find every settled-eligible BiasOutcome where one of the price snapshots
    // is still missing AND enough time has elapsed.
    const now = Date.now();
    const candidates = await prisma.biasOutcome.findMany({
      where: {
        OR: [
          { priceAfter1h: null, generatedAt: { lte: new Date(now - 1 * 3600_000) } },
          { priceAfter4h: null, generatedAt: { lte: new Date(now - 4 * 3600_000) } },
          { priceAfter24h: null, generatedAt: { lte: new Date(now - 24 * 3600_000) } },
        ],
      },
      take: 50, // batch
    });
    if (!candidates.length) return;

    for (const o of candidates) {
      try {
        const tick = await getPrice(o.symbol);
        if (!tick.price || tick.source === 'unsupported') continue;
        const elapsed = now - o.generatedAt.getTime();
        const update: any = {};
        const dirHit = (priceNow: number) => {
          const baseN = Number(o.priceAtGen);
          if (o.bias === 'bullish') return priceNow > baseN;
          if (o.bias === 'bearish') return priceNow < baseN;
          return null; // neutral never "hits"
        };
        if (o.priceAfter1h === null && elapsed >= 1 * 3600_000) {
          update.priceAfter1h = tick.price;
          update.hit1h = dirHit(tick.price);
        }
        if (o.priceAfter4h === null && elapsed >= 4 * 3600_000) {
          update.priceAfter4h = tick.price;
          update.hit4h = dirHit(tick.price);
        }
        if (o.priceAfter24h === null && elapsed >= 24 * 3600_000) {
          update.priceAfter24h = tick.price;
          update.hit24h = dirHit(tick.price);
        }
        if (Object.keys(update).length) {
          await prisma.biasOutcome.update({ where: { id: o.id }, data: update });
        }
      } catch (innerErr) {
        log.debug('cron: skip outcome snapshot row', { id: o.id, err: (innerErr as Error)?.message });
      }
    }
    log.debug('cron: bias outcomes snapshotted', { settled: candidates.length });
  } catch (err) {
    log.warn('cron: bias snapshot failed', { err: err instanceof Error ? err.message : String(err) });
  }
}

export function startCron() {
  setInterval(tickDailyMarketWrap, WRAP_INTERVAL_MS);
  setInterval(tickBiasOutcomeSnapshot, SNAPSHOT_INTERVAL_MS);
  // First snapshot tick in 30s so a fresh restart settles any backlog quickly
  setTimeout(tickBiasOutcomeSnapshot, 30_000);
  log.info('cron: scheduler started (daily wrap @ 06 UTC, bias snapshots every 5m)');
}
