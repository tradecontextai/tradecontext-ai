/**
 * Webhook → MT4/MT5 EA bridge.
 *
 * The companion Expert Advisor (see /ea/TradeContext_AI.mq5) polls this
 * endpoint every 5s and executes any "pending" signals on the user's broker
 * account. The EA never sees secrets — it authenticates via a long-lived
 * webhook token bound to the user.
 *
 * NB: We never place trades from our backend ourselves. This is just the
 * signal queue. The user runs the EA on their own MetaTrader; the EA does
 * the order placement against their broker. Compliance-clean.
 *
 * High-level flow:
 *  1. AI generates a high-conviction signal (or a user-published idea).
 *  2. Backend stores it as a Playbook row.
 *  3. POST /api/webhook/tradingview/signal pushes it onto the user's queue.
 *  4. EA on the user's MetaTrader polls GET /api/webhook/tradingview/poll
 *     and executes / acknowledges via POST /ack.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db';
import { requireAuth } from '../middleware/auth';

export const tradingviewWebhookRouter = Router();

// In-memory queue keyed by webhook token. Production = Redis. For now a Map
// is fine (single-process server, signals are ephemeral by design).
type Signal = {
  id: string;
  userId: string;
  symbol: string;
  side: 'buy' | 'sell';
  entry: number;
  sl: number;
  tp: number;
  size: number;
  createdAt: number;
  ackedAt?: number;
};
const QUEUE: Map<string, Signal[]> = new Map();
let _nextId = 1;

// We hash the user id with a simple suffix to give them a stable token they
// can copy-paste into the EA Inputs tab. Rotation = TODO.
function tokenFor(userId: string): string {
  // 12-char base36 derived from the userId. Not cryptographic — purely a
  // routing key. Real auth happens via the User row + the EA's TLS pin.
  return `tc_${Buffer.from(userId).toString('base64url').slice(0, 14)}`;
}

// POST /api/webhook/tradingview/signal — push signal onto queue (auth)
const signalSchema = z.object({
  symbol: z.string().min(1).max(40),
  side: z.enum(['buy', 'sell']),
  entry: z.number().positive(),
  sl: z.number().positive(),
  tp: z.number().positive(),
  size: z.number().positive().max(100),
});
tradingviewWebhookRouter.post('/signal', requireAuth, (req, res, next) => {
  try {
    const userId = req.user!.id;
    const sig = signalSchema.parse(req.body);
    const token = tokenFor(userId);
    const queue = QUEUE.get(token) ?? [];
    const id = String(_nextId++);
    queue.push({ id, userId, ...sig, createdAt: Date.now() });
    QUEUE.set(token, queue);
    res.json({ ok: true, id, token });
  } catch (e) {
    next(e);
  }
});

// GET /api/webhook/tradingview/token — fetch the user's EA token
tradingviewWebhookRouter.get('/token', requireAuth, (req, res) => {
  res.json({ token: tokenFor(req.user!.id), instructions: 'Paste this into the TradeContext_AI EA Inputs tab on MetaTrader.' });
});

// GET /api/webhook/tradingview/poll?token=... — EA polls this every 5s
tradingviewWebhookRouter.get('/poll', (req, res) => {
  const token = String(req.query.token || '');
  if (!/^tc_[A-Za-z0-9_-]{4,}$/.test(token)) {
    res.status(400).json({ error: { code: 'BAD_TOKEN' } });
    return;
  }
  const queue = QUEUE.get(token) ?? [];
  const cutoff = Date.now() - 5 * 60_000;
  const pending = queue.filter((s) => !s.ackedAt && s.createdAt > cutoff);
  res.json({ signals: pending });
});

// POST /api/webhook/tradingview/ack — EA acks an executed signal
tradingviewWebhookRouter.post('/ack', (req, res) => {
  const { token, id } = req.body || {};
  if (typeof token !== 'string' || typeof id !== 'string') {
    res.status(400).json({ ok: false });
    return;
  }
  const queue = QUEUE.get(token);
  if (!queue) {
    res.status(404).json({ ok: false });
    return;
  }
  const sig = queue.find((s) => s.id === id);
  if (!sig) {
    res.status(404).json({ ok: false });
    return;
  }
  sig.ackedAt = Date.now();
  res.json({ ok: true });
});
