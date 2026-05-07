import { pollAndScore } from '../services/news.service';
import { finnhubAvailable } from '../services/finnhub.service';
import { claudeAvailable } from '../services/claude.service';
import { log } from '../lib/logger';

const POLL_INTERVAL_MS = 60_000; // briefing §4.3 — every 60s

let timer: NodeJS.Timeout | null = null;
let running = false;

/**
 * Run one poll cycle, with a guard so overlapping cycles can't pile up
 * if Claude is slow. Errors are logged, never thrown.
 */
async function tick() {
  if (running) {
    log.debug('news-poller skip — previous cycle still running');
    return;
  }
  running = true;
  const t0 = Date.now();
  try {
    const result = await pollAndScore();
    if (result.new > 0 || result.errors > 0) {
      log.info('news-poller cycle', {
        ...result,
        ms: Date.now() - t0,
      });
    }
  } catch (e) {
    log.error('news-poller crashed in tick', {
      err: e instanceof Error ? e.message : e,
    });
  } finally {
    running = false;
  }
}

export function startNewsPoller(): void {
  if (timer) return;
  if (!finnhubAvailable() || !claudeAvailable()) {
    log.warn('news-poller NOT started — FINNHUB_API_KEY or ANTHROPIC_API_KEY missing');
    return;
  }
  log.info(`news-poller starting (every ${POLL_INTERVAL_MS / 1000}s)`);

  // Fire once immediately, then on interval
  void tick();
  timer = setInterval(tick, POLL_INTERVAL_MS);
}

export function stopNewsPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('news-poller stopped');
  }
}
