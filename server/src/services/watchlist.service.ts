import { prisma } from '../config/db';
import { HttpError } from '../middleware/error';
import type { WatchlistItem } from '@prisma/client';

export async function listWatchlist(userId: string): Promise<WatchlistItem[]> {
  return prisma.watchlistItem.findMany({
    where: { userId },
    orderBy: { addedAt: 'desc' },
  });
}

export async function addToWatchlist(userId: string, symbol: string): Promise<WatchlistItem> {
  const normalized = symbol.trim().toUpperCase();
  // Unique constraint on (userId, symbol) — handle conflict cleanly
  const existing = await prisma.watchlistItem.findUnique({
    where: { userId_symbol: { userId, symbol: normalized } },
  });
  if (existing) return existing;

  return prisma.watchlistItem.create({
    data: { userId, symbol: normalized },
  });
}

export async function removeFromWatchlist(userId: string, symbol: string): Promise<void> {
  const normalized = symbol.trim().toUpperCase();
  const result = await prisma.watchlistItem.deleteMany({
    where: { userId, symbol: normalized },
  });
  if (result.count === 0) {
    throw new HttpError(404, `${symbol} not in watchlist`, 'NOT_IN_WATCHLIST');
  }
}
