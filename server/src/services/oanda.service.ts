import { prisma } from '../config/db';
import { encrypt, decrypt } from '../lib/crypto';
import { HttpError } from '../middleware/error';
import { log } from '../lib/logger';
import type { BrokerConnection } from '@prisma/client';

/**
 * OANDA REST integration — READ-ONLY.
 *
 * We never place orders or move funds. We only:
 *  - Validate that a user-supplied API token works
 *  - Fetch open positions, account summary, and recent trade history
 *
 * OANDA has two environments:
 *   live      → https://api-fxtrade.oanda.com
 *   practice  → https://api-fxpractice.oanda.com
 *
 * Auth: Bearer token (user generates one in their OANDA account →
 * Manage API Access → Personal Access Token).
 */

const OANDA_HOSTS = {
  live: 'https://api-fxtrade.oanda.com',
  practice: 'https://api-fxpractice.oanda.com',
} as const;

type Env = keyof typeof OANDA_HOSTS;

// ──────── HTTP helpers ────────
async function oandaFetch<T>(env: Env, token: string, path: string): Promise<T> {
  const res = await fetch(`${OANDA_HOSTS[env]}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept-Datetime-Format': 'RFC3339',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new HttpError(
      res.status === 401 ? 401 : res.status === 403 ? 403 : 502,
      `OANDA ${path} → ${res.status}: ${body.slice(0, 200)}`,
      res.status === 401 ? 'OANDA_INVALID_TOKEN' : 'OANDA_FETCH_FAILED',
    );
  }
  return res.json() as Promise<T>;
}

// ──────── OANDA API response shapes ────────
interface OandaAccountListResp {
  accounts: Array<{ id: string; tags?: string[] }>;
}
interface OandaAccountSummary {
  account: {
    id: string;
    alias?: string;
    currency: string;
    balance: string;
    NAV: string;
    unrealizedPL: string;
    pl: string;
    marginUsed: string;
    marginAvailable: string;
    openTradeCount: number;
    openPositionCount: number;
    pendingOrderCount: number;
    lastTransactionID: string;
  };
}
interface OandaPosition {
  instrument: string;
  long: { units: string; averagePrice?: string; unrealizedPL: string; pl: string };
  short: { units: string; averagePrice?: string; unrealizedPL: string; pl: string };
  pl: string;
  unrealizedPL: string;
}
interface OandaPositionsResp {
  positions: OandaPosition[];
}
interface OandaTrade {
  id: string;
  instrument: string;
  price: string;
  openTime: string;
  closeTime?: string;
  initialUnits: string;
  currentUnits: string;
  realizedPL: string;
  unrealizedPL?: string;
  state: 'OPEN' | 'CLOSED' | 'CLOSE_WHEN_TRADEABLE';
  takeProfitOrder?: { price: string };
  stopLossOrder?: { price: string };
}
interface OandaTradesResp {
  trades: OandaTrade[];
}

// ──────── Public API ────────

/**
 * Validate a user-supplied OANDA token by calling /v3/accounts.
 * Returns the list of available account IDs so the user can pick one.
 */
export async function validateToken(token: string, env: Env): Promise<{ accounts: Array<{ id: string; tags?: string[] }> }> {
  if (!token || token.length < 30) {
    throw new HttpError(400, 'Invalid OANDA token format', 'OANDA_BAD_TOKEN');
  }
  const data = await oandaFetch<OandaAccountListResp>(env, token, '/v3/accounts');
  if (!data.accounts || !data.accounts.length) {
    throw new HttpError(404, 'No OANDA accounts found for this token', 'OANDA_NO_ACCOUNTS');
  }
  return { accounts: data.accounts };
}

/**
 * Persist (encrypted) OANDA credentials against a user.
 * Replaces any previous OANDA connection for that user.
 */
export async function connectOanda(opts: {
  userId: string;
  token: string;
  accountId: string;
  environment: Env;
}): Promise<BrokerConnection> {
  // Validate first — fail fast if token doesn't work
  const { accounts } = await validateToken(opts.token, opts.environment);
  const found = accounts.find((a) => a.id === opts.accountId);
  if (!found) {
    throw new HttpError(404, `Account ${opts.accountId} not found in this OANDA token's available accounts`, 'OANDA_ACCOUNT_MISMATCH');
  }

  // Replace any existing OANDA connection for this user
  await prisma.brokerConnection.deleteMany({
    where: { userId: opts.userId, brokerName: 'oanda' },
  });

  const conn = await prisma.brokerConnection.create({
    data: {
      userId: opts.userId,
      brokerName: 'oanda',
      apiKeyEncrypted: encrypt(opts.token),
      accountId: opts.accountId,
      environment: opts.environment,
      isConnected: true,
      lastSyncedAt: new Date(),
    },
  });

  log.info('OANDA connection stored', { userId: opts.userId, accountId: opts.accountId, env: opts.environment });
  return conn;
}

/** Fetch live account summary (balance, NAV, unrealized PnL). */
export async function fetchAccountSummary(connId: string, userId: string) {
  const conn = await getConnection(connId, userId);
  const env = (conn.environment as Env) || 'live';
  const token = decrypt(conn.apiKeyEncrypted!);
  const data = await oandaFetch<OandaAccountSummary>(env, token, `/v3/accounts/${conn.accountId}/summary`);

  await markSynced(conn.id);

  const a = data.account;
  return {
    accountId: a.id,
    alias: a.alias,
    currency: a.currency,
    balance: parseFloat(a.balance),
    nav: parseFloat(a.NAV),
    unrealizedPL: parseFloat(a.unrealizedPL),
    realizedPL: parseFloat(a.pl),
    marginUsed: parseFloat(a.marginUsed),
    marginAvailable: parseFloat(a.marginAvailable),
    openTradeCount: a.openTradeCount,
    openPositionCount: a.openPositionCount,
    pendingOrderCount: a.pendingOrderCount,
    environment: env,
  };
}

/** Fetch live open positions. Returns simplified objects ready for the UI. */
export async function fetchPositions(connId: string, userId: string) {
  const conn = await getConnection(connId, userId);
  const env = (conn.environment as Env) || 'live';
  const token = decrypt(conn.apiKeyEncrypted!);
  const data = await oandaFetch<OandaPositionsResp>(env, token, `/v3/accounts/${conn.accountId}/openPositions`);

  await markSynced(conn.id);

  // OANDA returns long+short side for every instrument; flatten to direction-aware rows
  const positions = data.positions
    .map((p) => {
      const longU = parseFloat(p.long.units);
      const shortU = parseFloat(p.short.units);
      if (longU > 0) {
        return {
          instrument: formatInstrument(p.instrument),
          rawInstrument: p.instrument,
          direction: 'long' as const,
          units: longU,
          averagePrice: p.long.averagePrice ? parseFloat(p.long.averagePrice) : null,
          unrealizedPL: parseFloat(p.long.unrealizedPL),
          realizedPL: parseFloat(p.long.pl),
        };
      }
      if (shortU < 0) {
        return {
          instrument: formatInstrument(p.instrument),
          rawInstrument: p.instrument,
          direction: 'short' as const,
          units: Math.abs(shortU),
          averagePrice: p.short.averagePrice ? parseFloat(p.short.averagePrice) : null,
          unrealizedPL: parseFloat(p.short.unrealizedPL),
          realizedPL: parseFloat(p.short.pl),
        };
      }
      return null;
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  return positions;
}

/** Fetch recent trade history (open + recently closed). */
export async function fetchTrades(connId: string, userId: string, limit = 50) {
  const conn = await getConnection(connId, userId);
  const env = (conn.environment as Env) || 'live';
  const token = decrypt(conn.apiKeyEncrypted!);
  const data = await oandaFetch<OandaTradesResp>(
    env,
    token,
    `/v3/accounts/${conn.accountId}/trades?count=${Math.min(500, limit)}`,
  );

  await markSynced(conn.id);

  return data.trades.map((t) => {
    const units = parseFloat(t.initialUnits);
    return {
      id: t.id,
      instrument: formatInstrument(t.instrument),
      direction: units >= 0 ? ('long' as const) : ('short' as const),
      units: Math.abs(units),
      price: parseFloat(t.price),
      openTime: t.openTime,
      closeTime: t.closeTime ?? null,
      realizedPL: parseFloat(t.realizedPL),
      unrealizedPL: t.unrealizedPL ? parseFloat(t.unrealizedPL) : null,
      stopLoss: t.stopLossOrder ? parseFloat(t.stopLossOrder.price) : null,
      takeProfit: t.takeProfitOrder ? parseFloat(t.takeProfitOrder.price) : null,
      state: t.state,
    };
  });
}

/** Disconnect — deletes the encrypted credentials. */
export async function disconnectOanda(userId: string): Promise<void> {
  const result = await prisma.brokerConnection.deleteMany({
    where: { userId, brokerName: 'oanda' },
  });
  if (result.count === 0) {
    throw new HttpError(404, 'No OANDA connection to disconnect', 'NOT_CONNECTED');
  }
  log.info('OANDA disconnected', { userId });
}

// ──────── helpers ────────
async function getConnection(connId: string, userId: string): Promise<BrokerConnection> {
  const conn = await prisma.brokerConnection.findUnique({ where: { id: connId } });
  if (!conn) throw new HttpError(404, 'Broker connection not found', 'NOT_FOUND');
  if (conn.userId !== userId) throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
  if (!conn.apiKeyEncrypted || !conn.accountId) {
    throw new HttpError(400, 'Connection missing credentials', 'BAD_CONNECTION');
  }
  return conn;
}

async function markSynced(connId: string): Promise<void> {
  await prisma.brokerConnection.update({
    where: { id: connId },
    data: { lastSyncedAt: new Date(), lastSyncError: null },
  });
}

/** OANDA returns instruments like "EUR_USD" — convert to "EUR/USD". */
function formatInstrument(raw: string): string {
  return raw.includes('_') ? raw.replace('_', '/') : raw;
}
