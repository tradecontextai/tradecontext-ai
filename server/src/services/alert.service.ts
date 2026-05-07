import { prisma } from '../config/db';
import { HttpError } from '../middleware/error';
import { log } from '../lib/logger';
import { getPrice } from './price.service';
import { broadcastAlert } from '../ws/alert-broadcast';
import type { Alert, AlertCondition } from '@prisma/client';

/**
 * Price alerts service.
 *
 * - CRUD on user-defined alerts (symbol + condition + price)
 * - `tickAlerts()` — called by the alert-monitor job every 30s
 *   - Fetches all currently active (untriggered) alerts
 *   - Groups by symbol so we hit /api/price once per symbol
 *   - For each fetched price, checks every alert and triggers what crosses
 *   - Broadcasts triggered alerts via WebSocket
 */

export interface CreateAlertInput {
  symbol: string;
  condition: AlertCondition;
  price: number;
}

export async function listAlerts(userId: string, opts?: { activeOnly?: boolean }): Promise<Alert[]> {
  return prisma.alert.findMany({
    where: { userId, ...(opts?.activeOnly ? { triggered: false } : {}) },
    orderBy: [{ triggered: 'asc' }, { createdAt: 'desc' }],
  });
}

export async function createAlert(userId: string, input: CreateAlertInput): Promise<Alert> {
  return prisma.alert.create({
    data: {
      userId,
      symbol: input.symbol.trim().toUpperCase(),
      condition: input.condition,
      price: input.price,
    },
  });
}

export async function deleteAlert(userId: string, alertId: string): Promise<void> {
  const existing = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!existing) throw new HttpError(404, 'Alert not found', 'NOT_FOUND');
  if (existing.userId !== userId) throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
  await prisma.alert.delete({ where: { id: alertId } });
}

/** Reset a triggered alert so it can fire again. */
export async function resetAlert(userId: string, alertId: string): Promise<Alert> {
  const existing = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!existing) throw new HttpError(404, 'Alert not found', 'NOT_FOUND');
  if (existing.userId !== userId) throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
  return prisma.alert.update({
    where: { id: alertId },
    data: { triggered: false, triggeredAt: null },
  });
}

// ──────── Monitor ────────
/**
 * One pass — fetch prices for every symbol with active alerts, fire any that crossed.
 * Returns count of how many fired this cycle.
 */
export async function tickAlerts(): Promise<{ scanned: number; triggered: number; symbolsPolled: number }> {
  const activeAlerts = await prisma.alert.findMany({
    where: { triggered: false },
    orderBy: { createdAt: 'desc' },
  });

  if (!activeAlerts.length) return { scanned: 0, triggered: 0, symbolsPolled: 0 };

  // Unique symbols
  const symbols = Array.from(new Set(activeAlerts.map((a) => a.symbol)));

  // Fetch prices in parallel (price.service has its own 5s cache so this stays cheap)
  const prices: Record<string, number> = {};
  await Promise.all(
    symbols.map(async (s) => {
      try {
        const tick = await getPrice(s);
        if (tick.price > 0 && tick.source !== 'unsupported') prices[s] = tick.price;
      } catch (e) {
        log.warn('Alert monitor: price fetch failed', { symbol: s, err: e instanceof Error ? e.message : e });
      }
    }),
  );

  let triggered = 0;
  for (const alert of activeAlerts) {
    const cur = prices[alert.symbol];
    if (cur === undefined) continue;
    const target = Number(alert.price);
    const fires =
      (alert.condition === 'above' && cur >= target) ||
      (alert.condition === 'below' && cur <= target);
    if (!fires) continue;

    // Mark triggered atomically + broadcast
    const updated = await prisma.alert.update({
      where: { id: alert.id },
      data: { triggered: true, triggeredAt: new Date() },
    });
    broadcastAlert({
      type: 'alert',
      alertId: updated.id,
      userId: updated.userId,
      symbol: updated.symbol,
      condition: updated.condition,
      target,
      currentPrice: cur,
      triggeredAt: updated.triggeredAt!.toISOString(),
    });
    log.info('Alert fired', {
      alertId: updated.id,
      userId: updated.userId,
      symbol: updated.symbol,
      target,
      cur,
    });
    triggered++;
  }

  return { scanned: activeAlerts.length, triggered, symbolsPolled: symbols.length };
}
