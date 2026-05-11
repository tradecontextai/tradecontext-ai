/**
 * Bybit v5 REST integration — READ-ONLY.
 *
 * We never place trades, transfer funds or read account secrets. We only:
 *  - Validate that a user's API key + secret work (wallet-balance call)
 *  - Pull closed P&L for derivatives (linear/inverse perpetuals)
 *  - Pull spot fills (executions) — useful for journaling even if unpaired
 *
 * Auth: HMAC-SHA256 of `timestamp + apiKey + recvWindow + queryString`
 * (https://bybit-exchange.github.io/docs/v5/intro#authentication-1).
 * Bybit's read-only API key has no withdrawal permission — we ask users
 * to disable that explicitly when they generate the key.
 *
 * Environments:
 *   mainnet → https://api.bybit.com
 *   testnet → https://api-testnet.bybit.com
 */
import crypto from 'node:crypto';
import { prisma } from '../config/db';
import { encrypt, decrypt } from '../lib/crypto';
import { HttpError } from '../middleware/error';
import { log } from '../lib/logger';
import type { BrokerConnection } from '@prisma/client';

const HOSTS = {
  mainnet: 'https://api.bybit.com',
  testnet: 'https://api-testnet.bybit.com',
} as const;

export type BybitEnv = keyof typeof HOSTS;
const RECV_WINDOW = '5000';

// ──────── signed GET helper ────────
async function bybitGet<T>(
  env: BybitEnv,
  apiKey: string,
  apiSecret: string,
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const ts = Date.now().toString();
  // Bybit v5 wants params alphabetically sorted in the query string
  const qs = Object.keys(params).sort().map((k) => `${k}=${encodeURIComponent(String(params[k]))}`).join('&');
  const payload = ts + apiKey + RECV_WINDOW + qs;
  const sign = crypto.createHmac('sha256', apiSecret).update(payload).digest('hex');

  const url = `${HOSTS[env]}${path}${qs ? '?' + qs : ''}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-TIMESTAMP': ts,
      'X-BAPI-RECV-WINDOW': RECV_WINDOW,
      'X-BAPI-SIGN': sign,
      'X-BAPI-SIGN-TYPE': '2',
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new HttpError(
      res.status === 401 ? 401 : 502,
      `Bybit ${path} → ${res.status}: ${body.slice(0, 200)}`,
      res.status === 401 ? 'BYBIT_INVALID_CREDS' : 'BYBIT_FETCH_FAILED',
    );
  }

  const json = await res.json() as { retCode: number; retMsg: string; result: T };
  if (json.retCode !== 0) {
    // 10003 / 10004 / 10005 cover bad signature / bad permissions / IP locked
    const isAuth = [10003, 10004, 10005, 10017, 10018].includes(json.retCode);
    throw new HttpError(
      isAuth ? 401 : 502,
      `Bybit ${path} retCode ${json.retCode}: ${json.retMsg}`,
      isAuth ? 'BYBIT_INVALID_CREDS' : 'BYBIT_API_ERROR',
    );
  }
  return json.result;
}

// ──────── Bybit response shapes (only fields we use) ────────
interface BybitWalletResp {
  list: Array<{ accountType: string; totalEquity: string; coin?: Array<{ coin: string; equity: string }> }>;
}

interface BybitClosedPnl {
  symbol: string;
  side: 'Buy' | 'Sell';
  qty: string;
  avgEntryPrice: string;
  avgExitPrice: string;
  closedPnl: string;
  cumEntryValue: string;
  cumExitValue: string;
  orderId: string;
  execType: string;
  createdTime: string;
  updatedTime: string;
}
interface BybitClosedPnlResp { list: BybitClosedPnl[]; nextPageCursor?: string; }

interface BybitExecution {
  symbol: string;
  side: 'Buy' | 'Sell';
  execId: string;
  orderId: string;
  execQty: string;
  execPrice: string;
  execFee: string;
  execTime: string;
  category: string;
  closedSize?: string;
}
interface BybitExecutionsResp { list: BybitExecution[]; nextPageCursor?: string; }

// ──────── public API ────────

/** Quick check that creds work — returns whatever account info we got. */
export async function validateBybitCreds(apiKey: string, apiSecret: string, env: BybitEnv): Promise<{ accountType: string; totalEquity: string }> {
  const r = await bybitGet<BybitWalletResp>(env, apiKey, apiSecret, '/v5/account/wallet-balance', { accountType: 'UNIFIED' });
  const acct = r.list[0] || { accountType: 'UNIFIED', totalEquity: '0' };
  return { accountType: acct.accountType, totalEquity: acct.totalEquity };
}

/** Stores encrypted creds + creates / updates the BrokerConnection row. */
export async function connectBybit(opts: { userId: string; apiKey: string; apiSecret: string; environment: BybitEnv }): Promise<BrokerConnection> {
  await validateBybitCreds(opts.apiKey, opts.apiSecret, opts.environment);
  // Replace any existing connection for this user (one Bybit conn per user)
  await prisma.brokerConnection.deleteMany({ where: { userId: opts.userId, brokerName: 'bybit' } });
  return prisma.brokerConnection.create({
    data: {
      userId: opts.userId,
      brokerName: 'bybit',
      apiKeyEncrypted: encrypt(opts.apiKey),
      apiSecretEncrypted: encrypt(opts.apiSecret),
      environment: opts.environment,
      isConnected: true,
    },
  });
}

async function getConnection(connId: string, userId: string): Promise<BrokerConnection> {
  const conn = await prisma.brokerConnection.findFirst({ where: { id: connId, userId, brokerName: 'bybit' } });
  if (!conn) throw new HttpError(404, 'No active Bybit connection', 'NOT_CONNECTED');
  return conn;
}

async function markSynced(connId: string) {
  await prisma.brokerConnection.update({ where: { id: connId }, data: { lastSyncedAt: new Date() } });
}

export interface NormalisedTrade {
  externalId: string;
  symbol: string;
  direction: 'long' | 'short';
  size: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  openedAt: Date;
  closedAt: Date;
  broker: 'Bybit';
  source: 'closed_pnl' | 'spot_exec';
}

/** Pull closed P&L for linear (USDT perpetual) and inverse perpetuals. */
export async function fetchClosedTrades(connId: string, userId: string, limit = 200): Promise<NormalisedTrade[]> {
  const conn = await getConnection(connId, userId);
  const env = (conn.environment as BybitEnv) || 'mainnet';
  const apiKey = decrypt(conn.apiKeyEncrypted!);
  const apiSecret = decrypt(conn.apiSecretEncrypted!);

  const out: NormalisedTrade[] = [];

  // Both linear (USDT-margined) and inverse (coin-margined) perpetuals
  for (const category of ['linear', 'inverse'] as const) {
    try {
      const data = await bybitGet<BybitClosedPnlResp>(env, apiKey, apiSecret, '/v5/position/closed-pnl', {
        category,
        limit: Math.min(200, limit),
      });
      for (const t of data.list) {
        // Closed P&L records the *closing* side. If side==Sell, position was Long (you sold to close).
        const direction: 'long' | 'short' = t.side === 'Sell' ? 'long' : 'short';
        out.push({
          externalId: `bybit:${category}:${t.orderId}`,
          symbol: formatSymbol(t.symbol),
          direction,
          size: parseFloat(t.qty),
          entryPrice: parseFloat(t.avgEntryPrice),
          exitPrice: parseFloat(t.avgExitPrice),
          pnl: parseFloat(t.closedPnl),
          openedAt: new Date(parseInt(t.createdTime, 10)),
          closedAt: new Date(parseInt(t.updatedTime, 10)),
          broker: 'Bybit',
          source: 'closed_pnl',
        });
      }
    } catch (e) {
      // Don't fail the whole import if one category has no data
      log.warn('Bybit closed-pnl partial failure', { category, err: e instanceof Error ? e.message : e });
    }
  }

  // Spot executions — Bybit doesn't pair them so we surface each fill
  try {
    const data = await bybitGet<BybitExecutionsResp>(env, apiKey, apiSecret, '/v5/execution/list', {
      category: 'spot',
      limit: Math.min(100, limit),
    });
    for (const e of data.list) {
      const direction: 'long' | 'short' = e.side === 'Buy' ? 'long' : 'short';
      const px = parseFloat(e.execPrice);
      out.push({
        externalId: `bybit:spot:${e.execId}`,
        symbol: formatSymbol(e.symbol),
        direction,
        size: parseFloat(e.execQty),
        entryPrice: px,
        exitPrice: px,                        // spot exec = single fill
        pnl: -parseFloat(e.execFee || '0'),  // only fee impact at the moment of execution
        openedAt: new Date(parseInt(e.execTime, 10)),
        closedAt: new Date(parseInt(e.execTime, 10)),
        broker: 'Bybit',
        source: 'spot_exec',
      });
    }
  } catch (e) {
    log.warn('Bybit spot exec partial failure', { err: e instanceof Error ? e.message : e });
  }

  await markSynced(conn.id);
  return out;
}

export async function disconnectBybit(userId: string): Promise<void> {
  await prisma.brokerConnection.deleteMany({ where: { userId, brokerName: 'bybit' } });
}

// Pretty up Bybit symbols: BTCUSDT → BTC/USDT, ETHUSD → ETH/USD
function formatSymbol(s: string): string {
  const m = s.match(/^([A-Z0-9]+?)(USDT|USDC|USD|EUR|BTC|ETH)$/);
  return m ? `${m[1]}/${m[2]}` : s;
}
