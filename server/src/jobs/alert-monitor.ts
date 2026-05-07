import { tickAlerts } from '../services/alert.service';
import { log } from '../lib/logger';

/**
 * Poll prices and fire alerts every 30 seconds.
 *
 * Cheap: skips entirely when no alerts are active. price.service caches
 * each symbol for 5s so consecutive ticks within that window are free.
 */
const POLL_INTERVAL_MS = 30_000;

let timer: NodeJS.Timeout | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) {
    log.debug('alert-monitor skip — previous cycle still running');
    return;
  }
  running = true;
  const t0 = Date.now();
  try {
    const result = await tickAlerts();
    if (result.triggered > 0) {
      log.info('alert-monitor cycle', { ...result, ms: Date.now() - t0 });
    } else if (result.scanned > 0) {
      log.debug('alert-monitor cycle (no triggers)', { ...result, ms: Date.now() - t0 });
    }
  } catch (e) {
    log.error('alert-monitor crashed', { err: e instanceof Error ? e.message : e });
  } finally {
    running = false;
  }
}

export function startAlertMonitor(): void {
  if (timer) return;
  log.info(`alert-monitor starting (every ${POLL_INTERVAL_MS / 1000}s)`);
  void tick();
  timer = setInterval(tick, POLL_INTERVAL_MS);
}

export function stopAlertMonitor(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('alert-monitor stopped');
  }
}
