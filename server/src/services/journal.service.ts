import { prisma } from '../config/db';
import { HttpError } from '../middleware/error';
import { generateTraderScore, type TraderScore, claudeAvailable } from './claude.service';
import type { Trade, JournalEntry, JournalEntryType, Direction } from '@prisma/client';
import { log } from '../lib/logger';

/**
 * Trading Journal service (Elite plan only — gated at the route level).
 *
 * Owns:
 *  - Trade CRUD (with ownership checks — users can only touch their own rows)
 *  - JournalEntry CRUD (text notes, reflections, mistakes)
 *  - TradeContext Score generation via Claude — cached in-memory per user for 1 hour
 *    or invalidated when the user adds/edits/deletes a trade.
 */

// ──────── Trades ────────
export interface TradeInput {
  symbol: string;
  direction: Direction;
  size: number;
  entryPrice: number;
  exitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  pnl?: number;
  pnlR?: number;
  setupType?: string;
  broker?: string;
  notes?: string;
  openedAt: Date;
  closedAt?: Date;
}

export async function createTrade(userId: string, input: TradeInput): Promise<Trade> {
  invalidateScoreCache(userId);
  return prisma.trade.create({
    data: {
      userId,
      symbol: input.symbol,
      direction: input.direction,
      size: input.size,
      entryPrice: input.entryPrice,
      exitPrice: input.exitPrice ?? null,
      stopLoss: input.stopLoss ?? null,
      takeProfit: input.takeProfit ?? null,
      pnl: input.pnl ?? null,
      pnlR: input.pnlR ?? null,
      setupType: input.setupType ?? null,
      broker: input.broker ?? null,
      notes: input.notes ?? null,
      openedAt: input.openedAt,
      closedAt: input.closedAt ?? null,
    },
  });
}

export async function listTrades(userId: string, opts?: { limit?: number; closedOnly?: boolean }) {
  return prisma.trade.findMany({
    where: { userId, ...(opts?.closedOnly ? { closedAt: { not: null } } : {}) },
    orderBy: { openedAt: 'desc' },
    take: opts?.limit ?? 100,
  });
}

export async function updateTrade(userId: string, tradeId: string, input: Partial<TradeInput>): Promise<Trade> {
  // Verify ownership before update
  const existing = await prisma.trade.findUnique({ where: { id: tradeId } });
  if (!existing) throw new HttpError(404, 'Trade not found', 'NOT_FOUND');
  if (existing.userId !== userId) throw new HttpError(403, 'Forbidden', 'FORBIDDEN');

  invalidateScoreCache(userId);
  return prisma.trade.update({
    where: { id: tradeId },
    data: {
      symbol: input.symbol,
      direction: input.direction,
      size: input.size,
      entryPrice: input.entryPrice,
      exitPrice: input.exitPrice,
      stopLoss: input.stopLoss,
      takeProfit: input.takeProfit,
      pnl: input.pnl,
      pnlR: input.pnlR,
      setupType: input.setupType,
      broker: input.broker,
      notes: input.notes,
      openedAt: input.openedAt,
      closedAt: input.closedAt,
    },
  });
}

export async function deleteTrade(userId: string, tradeId: string): Promise<void> {
  const existing = await prisma.trade.findUnique({ where: { id: tradeId } });
  if (!existing) throw new HttpError(404, 'Trade not found', 'NOT_FOUND');
  if (existing.userId !== userId) throw new HttpError(403, 'Forbidden', 'FORBIDDEN');

  invalidateScoreCache(userId);
  await prisma.trade.delete({ where: { id: tradeId } });
}

// ──────── Journal entries (notes / reflections / mistake logs) ────────
export async function createEntry(opts: {
  userId: string;
  entryType: JournalEntryType;
  content: string;
  tradeId?: string;
}): Promise<JournalEntry> {
  return prisma.journalEntry.create({
    data: {
      userId: opts.userId,
      entryType: opts.entryType,
      content: opts.content,
      tradeId: opts.tradeId ?? null,
    },
  });
}

export async function listEntries(userId: string, opts?: { limit?: number; type?: JournalEntryType }) {
  return prisma.journalEntry.findMany({
    where: { userId, ...(opts?.type ? { entryType: opts.type } : {}) },
    orderBy: { createdAt: 'desc' },
    take: opts?.limit ?? 50,
    include: { trade: true },
  });
}

// ──────── TradeContext Score ────────
interface CachedScore {
  score: TraderScore;
  expires: number;
}
const SCORE_TTL_MS = 60 * 60 * 1000; // 1 hour
const scoreCache = new Map<string, CachedScore>();

export function invalidateScoreCache(userId: string): void {
  scoreCache.delete(userId);
}

/**
 * Compute the TradeContext Score for a user via Claude.
 *
 * Sends recent trade summary (last 30 trades) to Claude with the score
 * system prompt. Result cached per user for 1 hour or until invalidated
 * by a CRUD change.
 */
export async function getTraderScore(userId: string, opts?: { force?: boolean }): Promise<TraderScore | null> {
  if (!claudeAvailable()) {
    throw new HttpError(503, 'Claude API not configured', 'CLAUDE_DISABLED');
  }

  if (!opts?.force) {
    const c = scoreCache.get(userId);
    if (c && c.expires > Date.now()) return c.score;
  }

  const trades = await prisma.trade.findMany({
    where: { userId, closedAt: { not: null } },
    orderBy: { closedAt: 'desc' },
    take: 30,
    select: {
      symbol: true,
      direction: true,
      size: true,
      entryPrice: true,
      exitPrice: true,
      pnl: true,
      pnlR: true,
      setupType: true,
      openedAt: true,
      closedAt: true,
    },
  });

  if (trades.length === 0) {
    // No closed trades — return null so the frontend can show an empty state
    return null;
  }

  // Sanitise Decimal → number for the JSON payload
  const summary = trades.map((t) => ({
    symbol: t.symbol,
    direction: t.direction,
    size: Number(t.size),
    entry: Number(t.entryPrice),
    exit: t.exitPrice ? Number(t.exitPrice) : null,
    pnl: t.pnl ? Number(t.pnl) : null,
    r: t.pnlR ? Number(t.pnlR) : null,
    setup: t.setupType,
    opened: t.openedAt.toISOString(),
    closed: t.closedAt?.toISOString(),
  }));

  const score = await generateTraderScore(summary);
  scoreCache.set(userId, { score, expires: Date.now() + SCORE_TTL_MS });
  log.info('Trader score generated', { userId, overall: score.overall_score });
  return score;
}

// ──────── Stats (cheap, non-AI summary used alongside the score) ────────
export async function getStats(userId: string) {
  const trades = await prisma.trade.findMany({
    where: { userId, closedAt: { not: null } },
    select: { pnl: true, pnlR: true, openedAt: true, closedAt: true },
  });

  if (trades.length === 0) {
    return {
      totalTrades: 0,
      winners: 0,
      losers: 0,
      winRate: 0,
      grossPnl: 0,
      avgR: 0,
      profitFactor: 0,
    };
  }

  let winners = 0,
    losers = 0,
    grossPnl = 0,
    sumR = 0,
    rCount = 0,
    grossWins = 0,
    grossLosses = 0;
  for (const t of trades) {
    const pnl = t.pnl ? Number(t.pnl) : 0;
    grossPnl += pnl;
    if (pnl > 0) {
      winners++;
      grossWins += pnl;
    } else if (pnl < 0) {
      losers++;
      grossLosses += Math.abs(pnl);
    }
    if (t.pnlR) {
      sumR += Number(t.pnlR);
      rCount++;
    }
  }
  return {
    totalTrades: trades.length,
    winners,
    losers,
    winRate: trades.length ? Math.round((winners / trades.length) * 1000) / 10 : 0,
    grossPnl: Math.round(grossPnl * 100) / 100,
    avgR: rCount ? Math.round((sumR / rCount) * 100) / 100 : 0,
    profitFactor: grossLosses > 0 ? Math.round((grossWins / grossLosses) * 100) / 100 : 0,
  };
}
