import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { addToWatchlist, listWatchlist, removeFromWatchlist } from '../services/watchlist.service';

export const watchlistRouter = Router();

watchlistRouter.use(requireAuth);

// ──────── GET /api/watchlist ────────
watchlistRouter.get('/', async (req, res, next) => {
  try {
    const items = await listWatchlist(req.user!.id);
    res.json({ items });
  } catch (e) {
    next(e);
  }
});

// ──────── POST /api/watchlist ────────
const addSchema = z.object({ symbol: z.string().min(1).max(20) });
watchlistRouter.post('/', async (req, res, next) => {
  try {
    const { symbol } = addSchema.parse(req.body);
    const item = await addToWatchlist(req.user!.id, symbol);
    res.status(201).json({ item });
  } catch (e) {
    next(e);
  }
});

// ──────── DELETE /api/watchlist/:symbol ────────
watchlistRouter.delete('/:symbol', async (req, res, next) => {
  try {
    const symbol = decodeURIComponent(String(req.params.symbol));
    await removeFromWatchlist(req.user!.id, symbol);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
