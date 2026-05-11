/**
 * Public lifetime-spots counter — GET /api/lifetime-spots
 *
 * Marketing pegs the lifetime tier at 500 founders only. Pages that mention
 * lifetime drop a small counter pill ("237 / 500 spots remaining") that
 * fetches this endpoint on load. No auth, cached for 30s in-process so we
 * don't hammer the DB if the homepage is hot.
 */
import { Router } from 'express';
import { prisma } from '../config/db';

export const lifetimeRouter = Router();

const TOTAL = 500;
let cached: { ts: number; sold: number } | null = null;
const TTL_MS = 30 * 1000;

lifetimeRouter.get('/lifetime-spots', async (_req, res, next) => {
  try {
    let sold: number;
    if (cached && Date.now() - cached.ts < TTL_MS) {
      sold = cached.sold;
    } else {
      sold = await prisma.user.count({ where: { lifetimeRedeemedAt: { not: null } } });
      cached = { ts: Date.now(), sold };
    }
    const remaining = Math.max(0, TOTAL - sold);
    res.json({ total: TOTAL, sold, remaining });
  } catch (e) { next(e); }
});
