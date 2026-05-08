/**
 * Trade idea leaderboard — users post setups (entry, SL, TP, thesis); we
 * track outcomes via price polling so the leaderboard surfaces traders with
 * verifiable win-rates rather than vibes.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db';
import { requireAuth, optionalAuth } from '../middleware/auth';

export const ideasRouter = Router();

const ideaSchema = z.object({
  symbol: z.string().min(1).max(40),
  direction: z.enum(['long', 'short']),
  entry: z.number().positive(),
  stopLoss: z.number().positive(),
  takeProfit: z.number().positive(),
  thesis: z.string().min(10).max(2000),
});

// POST /api/ideas — publish a new idea (auth required)
ideasRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { symbol, direction, entry, stopLoss, takeProfit, thesis } = ideaSchema.parse(req.body);
    const rR = Math.abs((takeProfit - entry) / (entry - stopLoss));
    const idea = await prisma.tradeIdea.create({
      data: {
        userId,
        symbol: symbol.toUpperCase(),
        direction,
        entry,
        stopLoss,
        takeProfit,
        thesis,
        rR: Number.isFinite(rR) ? rR : null,
      },
    });
    res.json({ idea });
  } catch (e) {
    next(e);
  }
});

// GET /api/ideas — list ideas (optional ?symbol filter) — public
ideasRouter.get('/', optionalAuth, async (req, res, next) => {
  try {
    const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : undefined;
    const where: any = {};
    if (symbol) where.symbol = symbol;
    const ideas = await prisma.tradeIdea.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { email: true } } },
    });
    // Mask emails to first letter + domain so privacy stays intact
    const out = ideas.map((i) => ({
      ...i,
      user: undefined,
      userHandle: i.user ? i.user.email.replace(/(^.).*?(@.+$)/, '$1***$2') : 'anon',
    }));
    res.json({ ideas: out });
  } catch (e) {
    next(e);
  }
});

// GET /api/ideas/leaderboard — top 50 traders by win-rate over 30/90/365 days
ideasRouter.get('/leaderboard', async (req, res, next) => {
  try {
    const windowDays = Math.min(365, Math.max(7, parseInt(String(req.query.windowDays || '90'), 10) || 90));
    const since = new Date(Date.now() - windowDays * 24 * 3600 * 1000);
    const closed = await prisma.tradeIdea.findMany({
      where: { closedAt: { gte: since }, outcome: { not: null } },
      include: { user: { select: { email: true } } },
    });
    const byUser: Record<string, { handle: string; total: number; wins: number; rTotal: number }> = {};
    for (const i of closed) {
      const handle = i.user ? i.user.email.replace(/(^.).*?(@.+$)/, '$1***$2') : 'anon';
      byUser[i.userId] ??= { handle, total: 0, wins: 0, rTotal: 0 };
      byUser[i.userId].total += 1;
      if (i.outcome === 'win') {
        byUser[i.userId].wins += 1;
        if (i.rR) byUser[i.userId].rTotal += Number(i.rR);
      } else if (i.outcome === 'loss') {
        byUser[i.userId].rTotal -= 1;
      }
    }
    const board = Object.values(byUser)
      .filter((u) => u.total >= 5)
      .map((u) => ({
        handle: u.handle,
        ideas: u.total,
        winRate: u.wins / u.total,
        avgR: u.rTotal / u.total,
      }))
      .sort((a, b) => b.avgR - a.avgR)
      .slice(0, 50);
    res.json({ windowDays, leaderboard: board });
  } catch (e) {
    next(e);
  }
});
