/**
 * Backtest route — POST /api/backtest
 *
 * Body:
 *   {
 *     symbol: "BTC/USD" | "EUR/USD" | "AAPL" | "XAU/USD" | ...
 *     interval: "15m" | "1h" | "4h" | "1d"
 *     strategy: "rsi_mean_reversion" | "ma_crossover" | "breakout"
 *     params?: { ... strategy-specific knobs ... }
 *   }
 *
 * Response: BacktestResult (see service). Includes candles so the UI can
 * render the chart without a second round-trip.
 */
import { Router } from 'express';
import { z } from 'zod';
import { runBacktest } from '../services/backtest.service';
import { rateLimit } from '../middleware/rate-limit';
import { log } from '../lib/logger';

export const backtestRouter = Router();

// Backtests can be expensive (network fetch + math) — protect against hammering.
const limiter = rateLimit({ ratePerSec: 0.5, burst: 6 });

const schema = z.object({
  symbol: z.string().min(1).max(40),
  interval: z.enum(['15m', '1h', '4h', '1d']),
  strategy: z.enum(['rsi_mean_reversion', 'ma_crossover', 'breakout']),
  params: z.record(z.string(), z.number()).optional(),
  maxBarsPerTrade: z.number().int().min(5).max(500).optional(),
});

backtestRouter.post('/', limiter, async (req, res, next) => {
  try {
    const input = schema.parse(req.body);
    const result = await runBacktest(input);
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn('Backtest failed', { err: msg });
    // Surface a structured error so the UI can render something useful.
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: msg } });
    }
    if (msg.includes('Unsupported symbol')) {
      return res.status(400).json({ error: { code: 'UNSUPPORTED_SYMBOL', message: msg } });
    }
    if (msg.includes('Not enough candles')) {
      return res.status(400).json({ error: { code: 'NO_DATA', message: msg } });
    }
    next(e);
  }
});
