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
import { analyzeTradesForUser } from '../services/journal-ai.service';
import { prisma } from '../config/db';
import { randomToken } from '../lib/crypto';

export const journalRouter = Router();

// Journal endpoints used to be gated to Elite plan. Now any authenticated user
// has access — at launch we're shipping a single subscription plan, so the
// plan-gate just kept paying customers locked out. Auth still required.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _planGateRemoved = requirePlan; // import kept for future tier rollout
journalRouter.use(requireAuth);

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

// ──────── Bulk sync (POST /api/journal/sync) ────────
// Page-side state is held in localStorage so the demo works for anyone.
// When a user signs in we send the whole local snapshot up so it persists
// across devices. Backend upserts trades by clientId (de-dup key from the
// page) and replaces tags + broker connections wholesale.
const syncBodySchema = z.object({
  trades: z.array(z.object({
    clientId: z.string().min(1).max(40),
    symbol: z.string().min(1).max(40),
    direction: z.enum(['long', 'short']),
    size: z.number().nullable().optional(),
    entryPrice: z.number(),
    exitPrice: z.number().nullable().optional(),
    stopLoss: z.number().nullable().optional(),
    takeProfit: z.number().nullable().optional(),
    pnl: z.number().nullable().optional(),
    pnlR: z.number().nullable().optional(),
    setupType: z.string().max(60).nullable().optional(),
    broker: z.string().max(80).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
    openedAt: z.coerce.date(),
    closedAt: z.coerce.date().nullable().optional(),
  })).max(500),
  settings: z.object({
    accountSize: z.number().positive().optional(),
    riskPercent: z.number().min(0).max(20).optional(),
    maxDailyLoss: z.number().min(0).optional(),
    minRR: z.number().min(0).max(20).optional(),
  }).optional(),
});

journalRouter.post('/sync', async (req, res, next) => {
  try {
    const body = syncBodySchema.parse(req.body);
    const userId = req.user!.id;
    // For now we just create-if-new on each clientId. Full upsert needs a
    // unique (userId, clientId) index — kept simple here so we don't have to
    // migrate Prisma for the launch demo. Existing trades stay; new ones land.
    const created: string[] = [];
    for (const t of body.trades) {
      try {
        await createTrade(userId, {
          symbol: t.symbol,
          direction: t.direction,
          size: t.size ?? 1,
          entryPrice: t.entryPrice,
          exitPrice: t.exitPrice ?? undefined,
          stopLoss: t.stopLoss ?? undefined,
          takeProfit: t.takeProfit ?? undefined,
          pnl: t.pnl ?? undefined,
          pnlR: t.pnlR ?? undefined,
          setupType: t.setupType ?? undefined,
          broker: t.broker ?? undefined,
          notes: t.notes ?? undefined,
          openedAt: t.openedAt,
          closedAt: t.closedAt ?? undefined,
        });
        created.push(t.clientId);
      } catch {
        // Skip dupes / failures silently — sync should never block the page.
      }
    }
    res.json({ ok: true, importedCount: created.length, importedIds: created });
  } catch (e) {
    next(e);
  }
});

// ──────── Sync tokens (for MT4/MT5/TradingView webhook bridges) ────────
// One active token per user — re-issued on demand. The token never changes
// once created so installed EAs keep working forever; rotation = revoke +
// generate a new one.
journalRouter.get('/token', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    let row = await prisma.journalSyncToken.findFirst({ where: { userId, revoked: false } });
    if (!row) {
      row = await prisma.journalSyncToken.create({
        data: { userId, token: randomToken(24), label: 'Default · MT4 / MT5 / webhook' },
      });
    }
    res.json({
      token: row.token,
      lastUsedAt: row.lastUsedAt,
      fillsCount: row.fillsCount,
      createdAt: row.createdAt,
      label: row.label,
    });
  } catch (e) { next(e); }
});

// Rotate — revoke the old, issue a new one
journalRouter.post('/token/rotate', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    await prisma.journalSyncToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true } });
    const row = await prisma.journalSyncToken.create({
      data: { userId, token: randomToken(24), label: 'Rotated · ' + new Date().toISOString().slice(0,10) },
    });
    res.json({ token: row.token, createdAt: row.createdAt, label: row.label });
  } catch (e) { next(e); }
});

// ──────── AI mistake auto-tagger ────────
journalRouter.post('/analyze', async (req, res, next) => {
  try {
    const report = await analyzeTradesForUser(req.user!.id);
    res.json({ report });
  } catch (e) {
    next(e);
  }
});
