import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requirePlan } from '../middleware/plan';
import {
  createTrade,
  listTrades,
  updateTrade,
  deleteTrade,
  createEntry,
  listEntries,
  getTraderScore,
  getStats,
} from '../services/journal.service';

export const journalRouter = Router();

// All journal endpoints require Elite plan (briefing §4.5)
journalRouter.use(requireAuth, requirePlan('elite'));

// ──────── Trades ────────
const tradeBodySchema = z.object({
  symbol: z.string().min(1).max(20),
  direction: z.enum(['long', 'short']),
  size: z.number().positive(),
  entryPrice: z.number().positive(),
  exitPrice: z.number().positive().optional(),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  pnl: z.number().optional(),
  pnlR: z.number().optional(),
  setupType: z.string().max(100).optional(),
  broker: z.string().max(50).optional(),
  notes: z.string().max(5000).optional(),
  openedAt: z.coerce.date(),
  closedAt: z.coerce.date().optional(),
});

journalRouter.get('/trades', async (req, res, next) => {
  try {
    const { limit, closedOnly } = z
      .object({ limit: z.coerce.number().int().min(1).max(500).default(100), closedOnly: z.coerce.boolean().default(false) })
      .parse(req.query);
    const trades = await listTrades(req.user!.id, { limit, closedOnly });
    res.json({ trades });
  } catch (e) {
    next(e);
  }
});

journalRouter.post('/trades', async (req, res, next) => {
  try {
    const input = tradeBodySchema.parse(req.body);
    const trade = await createTrade(req.user!.id, input);
    res.status(201).json({ trade });
  } catch (e) {
    next(e);
  }
});

journalRouter.put('/trades/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const input = tradeBodySchema.partial().parse(req.body);
    const trade = await updateTrade(req.user!.id, id, input);
    res.json({ trade });
  } catch (e) {
    next(e);
  }
});

journalRouter.delete('/trades/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id);
    await deleteTrade(req.user!.id, id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ──────── Entries (notes/reflections/mistake logs) ────────
const entryBodySchema = z.object({
  entryType: z.enum(['trade', 'note', 'mistake', 'reflection']),
  content: z.string().min(1).max(10_000),
  tradeId: z.string().uuid().optional(),
});

journalRouter.get('/entries', async (req, res, next) => {
  try {
    const { limit, type } = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        type: z.enum(['trade', 'note', 'mistake', 'reflection']).optional(),
      })
      .parse(req.query);
    const entries = await listEntries(req.user!.id, { limit, type });
    res.json({ entries });
  } catch (e) {
    next(e);
  }
});

journalRouter.post('/entries', async (req, res, next) => {
  try {
    const body = entryBodySchema.parse(req.body);
    const entry = await createEntry({
      userId: req.user!.id,
      entryType: body.entryType,
      content: body.content,
      tradeId: body.tradeId,
    });
    res.status(201).json({ entry });
  } catch (e) {
    next(e);
  }
});

// ──────── TradeContext Score (Claude-generated) ────────
journalRouter.get('/score', async (req, res, next) => {
  try {
    const force = z.coerce.boolean().default(false).parse(req.query.force);
    const score = await getTraderScore(req.user!.id, { force });
    res.json({ score });
  } catch (e) {
    next(e);
  }
});

// ──────── Stats (deterministic, cheap to compute) ────────
journalRouter.get('/stats', async (req, res, next) => {
  try {
    const stats = await getStats(req.user!.id);
    res.json({ stats });
  } catch (e) {
    next(e);
  }
});
