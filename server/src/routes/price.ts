import { Router } from 'express';
import { z } from 'zod';
import { getPrice, getPrices } from '../services/price.service';

export const priceRouter = Router();

// ──────── GET /api/price/:symbol ────────
// Public — used by the dashboard to show real prices next to the chart symbol pill.
// URL-encode the slash, e.g. GET /api/price/EUR%2FUSD or /api/price/BTC%2FUSD
priceRouter.get('/:symbol', async (req, res, next) => {
  try {
    const symbol = decodeURIComponent(String(req.params.symbol));
    const tick = await getPrice(symbol);
    res.json({ tick });
  } catch (e) {
    next(e);
  }
});

// ──────── POST /api/price/bulk ────────
// Body: { symbols: ["EUR/USD", "BTC/USD", "SPX", ...] }
const bulkSchema = z.object({
  symbols: z.array(z.string().min(1).max(40)).min(1).max(50),
});

priceRouter.post('/bulk', async (req, res, next) => {
  try {
    const { symbols } = bulkSchema.parse(req.body);
    const ticks = await getPrices(symbols);
    res.json({ ticks });
  } catch (e) {
    next(e);
  }
});
