import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requirePlan } from '../middleware/plan';
import { HttpError } from '../middleware/error';
import { prisma } from '../config/db';
import { createTrade } from '../services/journal.service';
import {
  validateToken,
  connectOanda,
  fetchAccountSummary,
  fetchPositions,
  fetchTrades,
  disconnectOanda,
} from '../services/oanda.service';

export const brokerRouter = Router();

// All broker endpoints need auth (Pro+) — broker hub is a paid feature.
// Broker routes used to require a Pro plan. At launch we ship one
// subscription tier, so any authenticated user has access.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _brokerPlanGateRemoved = requirePlan; // import kept for future tiering
brokerRouter.use(requireAuth);

// ──────── GET /api/broker/connections ────────
// Returns the user's broker connections WITHOUT secrets — UI list view.
brokerRouter.get('/connections', async (req, res, next) => {
  try {
    const conns = await prisma.brokerConnection.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        brokerName: true,
        accountId: true,
        environment: true,
        isConnected: true,
        lastSyncedAt: true,
        lastSyncError: true,
        createdAt: true,
      },
    });
    res.json({ connections: conns });
  } catch (e) {
    next(e);
  }
});

// ════════════ OANDA-SPECIFIC ════════════

// ──────── POST /api/broker/oanda/validate ────────
// Step 1 of connect flow — given a token, return the list of accounts so the
// user can pick one. Doesn't store anything yet.
const validateSchema = z.object({
  token: z.string().min(30).max(500),
  environment: z.enum(['live', 'practice']).default('live'),
});

brokerRouter.post('/oanda/validate', async (req, res, next) => {
  try {
    const { token, environment } = validateSchema.parse(req.body);
    const result = await validateToken(token, environment);
    res.json({ accounts: result.accounts, environment });
  } catch (e) {
    next(e);
  }
});

// ──────── POST /api/broker/oanda/connect ────────
// Step 2 of connect flow — store encrypted token + chosen accountId.
const connectSchema = z.object({
  token: z.string().min(30).max(500),
  accountId: z.string().min(1).max(60),
  environment: z.enum(['live', 'practice']).default('live'),
});

brokerRouter.post('/oanda/connect', async (req, res, next) => {
  try {
    const body = connectSchema.parse(req.body);
    const conn = await connectOanda({
      userId: req.user!.id,
      token: body.token,
      accountId: body.accountId,
      environment: body.environment,
    });
    // Don't return the encrypted token in the response
    res.status(201).json({
      connection: {
        id: conn.id,
        brokerName: conn.brokerName,
        accountId: conn.accountId,
        environment: conn.environment,
        isConnected: conn.isConnected,
        createdAt: conn.createdAt,
      },
    });
  } catch (e) {
    next(e);
  }
});

// ──────── GET /api/broker/oanda/summary ────────
brokerRouter.get('/oanda/summary', async (req, res, next) => {
  try {
    const conn = await getOandaConn(req.user!.id);
    const summary = await fetchAccountSummary(conn.id, req.user!.id);
    res.json({ summary });
  } catch (e) {
    next(e);
  }
});

// ──────── GET /api/broker/oanda/positions ────────
brokerRouter.get('/oanda/positions', async (req, res, next) => {
  try {
    const conn = await getOandaConn(req.user!.id);
    const positions = await fetchPositions(conn.id, req.user!.id);
    res.json({ positions });
  } catch (e) {
    next(e);
  }
});

// ──────── GET /api/broker/oanda/trades ────────
brokerRouter.get('/oanda/trades', async (req, res, next) => {
  try {
    const limit = z.coerce.number().int().min(1).max(500).default(50).parse(req.query.limit);
    const conn = await getOandaConn(req.user!.id);
    const trades = await fetchTrades(conn.id, req.user!.id, limit);
    res.json({ trades });
  } catch (e) {
    next(e);
  }
});

// ──────── POST /api/broker/oanda/import ────────
// Pulls trades from OANDA (open + recently closed) and creates Trade rows
// in the user's journal. Closed trades become 'closed' rows with PnL +
// open/close timestamps. Skips trades already imported (matched by the
// OANDA trade id stored in notes).
brokerRouter.post('/oanda/import', async (req, res, next) => {
  try {
    const limit = z.coerce.number().int().min(1).max(500).default(200).parse(req.body?.limit);
    const userId = req.user!.id;
    const conn = await getOandaConn(userId);
    const trades = await fetchTrades(conn.id, userId, limit);

    // Naive dedup: notes contain "oanda:<tradeId>" — only import unseen ones.
    const existing = await prisma.trade.findMany({
      where: { userId },
      select: { notes: true },
    });
    const seen = new Set(
      existing
        .map((t) => (t.notes || '').match(/oanda:(\S+)/)?.[1])
        .filter(Boolean) as string[]
    );

    let imported = 0;
    for (const t of trades) {
      if (seen.has(t.id)) continue;
      try {
        await createTrade(userId, {
          symbol: t.instrument,
          direction: t.direction,
          size: t.units,
          entryPrice: t.price,
          exitPrice: t.closeTime ? t.price + (t.realizedPL / (t.units || 1)) * (t.direction === 'long' ? 1 : -1) : undefined,
          pnl: t.realizedPL,
          stopLoss: t.stopLoss ?? undefined,
          takeProfit: t.takeProfit ?? undefined,
          broker: 'OANDA',
          notes: `oanda:${t.id}`,   // dedup key — never edit
          openedAt: new Date(t.openTime),
          closedAt: t.closeTime ? new Date(t.closeTime) : undefined,
        });
        imported++;
      } catch {
        // Skip failures silently — import should never block the page
      }
    }

    res.json({ ok: true, fetched: trades.length, imported });
  } catch (e) {
    next(e);
  }
});

// ──────── DELETE /api/broker/oanda ────────
brokerRouter.delete('/oanda', async (req, res, next) => {
  try {
    await disconnectOanda(req.user!.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ──────── helpers ────────
async function getOandaConn(userId: string) {
  const conn = await prisma.brokerConnection.findFirst({
    where: { userId, brokerName: 'oanda', isConnected: true },
  });
  if (!conn) {
    throw new HttpError(404, 'No active OANDA connection. Connect at /broker-connect.html.', 'NOT_CONNECTED');
  }
  return conn;
}
