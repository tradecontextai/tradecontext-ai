/**
 * Public AI Bias track record — single most-credibility-lifting page.
 *
 * Every time the AI bias engine produces a verdict for a symbol we snapshot
 * it (symbol, bias direction, current price, source = fundamental|technical
 * |dayTrade|swingTrade) into BiasOutcome. A scheduled job then revisits each
 * snapshot 1h, 4h and 24h later, fetches the price at that time, and stamps
 * a hit/miss flag. The /api/track-record/summary endpoint aggregates that
 * into a public hit-rate dashboard.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db';

export const trackRecordRouter = Router();

const querySchema = z.object({
  symbol: z.string().optional(),
  windowDays: z.coerce.number().int().min(1).max(365).default(90),
});

trackRecordRouter.get('/summary', async (req, res, next) => {
  try {
    const { symbol, windowDays } = querySchema.parse(req.query);
    const since = new Date(Date.now() - windowDays * 24 * 3600 * 1000);

    const where: any = { generatedAt: { gte: since } };
    if (symbol) where.symbol = symbol.toUpperCase();

    // Fetch all settled outcomes (24h hit recorded) — that's the gold-standard
    // hit metric. The 1h / 4h flavors are bonus.
    const settled = await prisma.biasOutcome.findMany({
      where: { ...where, hit24h: { not: null } },
      select: { symbol: true, bias: true, source: true, hit1h: true, hit4h: true, hit24h: true, generatedAt: true },
      orderBy: { generatedAt: 'desc' },
      take: 5000,
    });

    // Aggregate by source (fundamental/technical/dayTrade/swingTrade) + by symbol
    const bySource: Record<string, { total: number; wins: number; w1h: number; t1h: number; w4h: number; t4h: number }> = {};
    const bySymbol: Record<string, { total: number; wins: number }> = {};
    let total = 0,
      wins = 0;
    for (const o of settled) {
      total += 1;
      if (o.hit24h) wins += 1;
      const k = o.source;
      bySource[k] ??= { total: 0, wins: 0, w1h: 0, t1h: 0, w4h: 0, t4h: 0 };
      bySource[k].total += 1;
      if (o.hit24h) bySource[k].wins += 1;
      if (o.hit1h !== null && o.hit1h !== undefined) {
        bySource[k].t1h += 1;
        if (o.hit1h) bySource[k].w1h += 1;
      }
      if (o.hit4h !== null && o.hit4h !== undefined) {
        bySource[k].t4h += 1;
        if (o.hit4h) bySource[k].w4h += 1;
      }
      bySymbol[o.symbol] ??= { total: 0, wins: 0 };
      bySymbol[o.symbol].total += 1;
      if (o.hit24h) bySymbol[o.symbol].wins += 1;
    }

    // Last 30 settled calls, newest first — for the "recent calls" table
    const recent = settled.slice(0, 30);

    res.json({
      windowDays,
      symbol: symbol ? symbol.toUpperCase() : null,
      total,
      wins,
      hitRate: total > 0 ? wins / total : null,
      bySource: Object.entries(bySource).map(([source, s]) => ({
        source,
        total: s.total,
        hitRate24h: s.total ? s.wins / s.total : null,
        hitRate1h: s.t1h ? s.w1h / s.t1h : null,
        hitRate4h: s.t4h ? s.w4h / s.t4h : null,
      })),
      bySymbol: Object.entries(bySymbol)
        .map(([sym, s]) => ({ symbol: sym, total: s.total, hitRate: s.total ? s.wins / s.total : null }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 20),
      recent: recent.map((r) => ({ symbol: r.symbol, bias: r.bias, source: r.source, hit24h: r.hit24h, generatedAt: r.generatedAt })),
    });
  } catch (e) {
    next(e);
  }
});
