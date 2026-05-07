import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth } from '../middleware/auth';
import { getBias, resetCreditCircuit } from '../services/ai-bias.service';

export const aiBiasRouter = Router();

// ──────── GET /api/ai/bias?symbol=XAU%2FUSD&force=false ────────
// Public read — same preview-then-paywall pattern as news/calendar/price.
const querySchema = z.object({
  symbol: z.string().min(1).max(40),
  force: z.coerce.boolean().default(false),
});

aiBiasRouter.get('/bias', optionalAuth, async (req, res, next) => {
  try {
    const { symbol, force } = querySchema.parse(req.query);
    const result = await getBias(symbol, { force });
    res.json({
      symbol: symbol.toUpperCase(),
      ...result.bias,
      generatedAt: new Date(result.generatedAt).toISOString(),
      cached: result.cached,
    });
  } catch (e) {
    next(e);
  }
});

// ──────── POST /api/ai/bias/reset-circuit ────────
// Admin: clear the credit-exhausted circuit breaker after topping up.
aiBiasRouter.post('/bias/reset-circuit', (_req, res) => {
  resetCreditCircuit();
  res.json({ ok: true, message: 'Circuit breaker reset. Next /api/ai/bias call will hit Anthropic.' });
});
