import { env } from '../config/env';
import { log } from '../lib/logger';

/**
 * Live price service.
 *
 * Strategy:
 *  - Crypto (BTC/ETH/SOL/...) → Binance public ticker (free, no key, real-time)
 *  - US Stocks/Indices → Finnhub /quote (free tier real-time)
 *  - Forex pairs → Finnhub /forex/rates (free tier supports basic rates)
 *  - Commodities (XAU/XAG/WTI/...) → Finnhub doesn't free-tier these → use Yahoo Finance as a fallback
 *  - Anything else → returns null and the frontend keeps its drift simulator
 *
 * 5-second in-memory cache per symbol — keeps API calls cheap on busy dashboards.
 */
const FH = 'https://finnhub.io/api/v1';
const BINANCE = 'https://api.binance.com/api/v3';
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart';

export interface PriceTick {
  symbol: string;
  price: number;
  change: number;          // absolute change (price - prevClose)
  changePercent: number;   // signed %
  prevClose: number | null;
  source: 'binance' | 'finnhub' | 'yahoo' | 'unsupported';
  ts: number;
}

interface CacheEntry {
  data: PriceTick;
  expires: number;
}
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5_000; // 5 seconds

// ──────── symbol mappers ────────
const CRYPTO_PAIRS: Record<string, string> = {
  'BTC/USD': 'BTCUSDT', 'BTC': 'BTCUSDT',
  'ETH/USD': 'ETHUSDT', 'ETH': 'ETHUSDT',
  'SOL/USD': 'SOLUSDT', 'SOL': 'SOLUSDT',
  'BNB/USD': 'BNBUSDT', 'BNB': 'BNBUSDT',
  'XRP/USD': 'XRPUSDT', 'XRP': 'XRPUSDT',
  'ADA/USD': 'ADAUSDT', 'DOGE/USD': 'DOGEUSDT',
  'AVAX/USD': 'AVAXUSDT', 'LINK/USD': 'LINKUSDT',
  'MATIC/USD': 'MATICUSDT',
};
// Forex via Yahoo (Finnhub free tier doesn't include OANDA forex quotes).
// Yahoo format: PAIRX=X (e.g. EURUSD=X)
const FOREX_PAIRS: Record<string, string> = {
  'EUR/USD': 'EURUSD=X', 'GBP/USD': 'GBPUSD=X', 'USD/JPY': 'JPY=X',
  'AUD/USD': 'AUDUSD=X', 'USD/CAD': 'CAD=X', 'NZD/USD': 'NZDUSD=X',
  'EUR/JPY': 'EURJPY=X', 'GBP/JPY': 'GBPJPY=X', 'EUR/GBP': 'EURGBP=X',
  'USD/CHF': 'CHF=X',
};
const STOCK_INDICES: Record<string, string> = {
  'NASDAQ': '^IXIC', 'NDX': '^NDX', 'NASDAQ 100': '^NDX',
  'S&P 500': '^GSPC', 'SPX': '^GSPC',
  'DOW': '^DJI', 'Dow Jones': '^DJI',
  'FTSE 100': '^FTSE', 'DAX': '^GDAXI',
  'NIKKEI': '^N225', 'Nikkei': '^N225',
  'DXY': 'DX-Y.NYB',
  // Volatility gauges — drive the new Macro Pulse "real fear" widget
  'VIX': '^VIX',
  'MOVE': '^MOVE',
};
const COMMODITIES: Record<string, string> = {
  'XAU/USD': 'GC=F', 'Gold': 'GC=F',
  'XAG/USD': 'SI=F', 'Silver': 'SI=F',
  'WTI': 'CL=F', 'WTI Oil': 'CL=F',
  'Brent': 'BZ=F', 'Nat Gas': 'NG=F',
};

// ──────── adapters ────────
async function fetchBinance(pairCode: string): Promise<PriceTick | null> {
  try {
    const res = await fetch(`${BINANCE}/ticker/24hr?symbol=${pairCode}`);
    if (!res.ok) return null;
    const d = await res.json() as {
      lastPrice: string;
      priceChange: string;
      priceChangePercent: string;
      prevClosePrice: string;
    };
    return {
      symbol: pairCode,
      price: parseFloat(d.lastPrice),
      change: parseFloat(d.priceChange),
      changePercent: parseFloat(d.priceChangePercent),
      prevClose: parseFloat(d.prevClosePrice),
      source: 'binance',
      ts: Date.now(),
    };
  } catch (e) {
    log.warn('Binance price fetch failed', { pairCode, err: e instanceof Error ? e.message : e });
    return null;
  }
}

async function fetchFinnhubQuote(fhSymbol: string): Promise<PriceTick | null> {
  if (!env.FINNHUB_API_KEY) return null;
  try {
    const res = await fetch(`${FH}/quote?symbol=${encodeURIComponent(fhSymbol)}&token=${env.FINNHUB_API_KEY}`);
    if (!res.ok) return null;
    // Finnhub returns: { c: current, d: change, dp: changePercent, h, l, o, pc: prevClose, t }
    const d = await res.json() as { c: number; d: number; dp: number; pc: number };
    if (!d.c || d.c === 0) return null; // empty quote
    return {
      symbol: fhSymbol,
      price: d.c,
      change: d.d,
      changePercent: d.dp,
      prevClose: d.pc ?? null,
      source: 'finnhub',
      ts: Date.now(),
    };
  } catch (e) {
    log.warn('Finnhub quote fetch failed', { fhSymbol, err: e instanceof Error ? e.message : e });
    return null;
  }
}

async function fetchYahoo(yfSymbol: string): Promise<PriceTick | null> {
  try {
    const res = await fetch(`${YAHOO}/${encodeURIComponent(yfSymbol)}?interval=1m&range=1d`, {
      headers: { 'User-Agent': 'Mozilla/5.0 TradeContext/1.0' },
    });
    if (!res.ok) return null;
    const d = await res.json() as {
      chart?: {
        result?: Array<{ meta?: { regularMarketPrice?: number; previousClose?: number; chartPreviousClose?: number } }>;
        error?: unknown;
      };
    };
    const meta = d.chart?.result?.[0]?.meta;
    if (!meta || meta.regularMarketPrice === undefined) return null;
    const price = meta.regularMarketPrice;
    const prevClose = meta.previousClose ?? meta.chartPreviousClose ?? price;
    const change = price - prevClose;
    const changePercent = (change / prevClose) * 100;
    return {
      symbol: yfSymbol,
      price,
      change,
      changePercent,
      prevClose,
      source: 'yahoo',
      ts: Date.now(),
    };
  } catch (e) {
    log.warn('Yahoo quote fetch failed', { yfSymbol, err: e instanceof Error ? e.message : e });
    return null;
  }
}

// ──────── public API ────────
export async function getPrice(rawSymbol: string): Promise<PriceTick> {
  const symbol = rawSymbol.trim();

  // cache hit?
  const c = cache.get(symbol);
  if (c && c.expires > Date.now()) return c.data;

  // dispatch by category
  let tick: PriceTick | null = null;

  if (CRYPTO_PAIRS[symbol]) {
    tick = await fetchBinance(CRYPTO_PAIRS[symbol]);
  } else if (FOREX_PAIRS[symbol]) {
    tick = await fetchYahoo(FOREX_PAIRS[symbol]);
  } else if (STOCK_INDICES[symbol]) {
    tick = await fetchYahoo(STOCK_INDICES[symbol]);
  } else if (COMMODITIES[symbol]) {
    tick = await fetchYahoo(COMMODITIES[symbol]);
  } else if (/^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(symbol)) {
    // Generic stock ticker. Yahoo accepts plain tickers (AAPL, MSFT, TSLA),
    // exchange-suffixed tickers (7203.T for Toyota Tokyo, 005930.KS for
    // Samsung Korea, BMW.DE for BMW Germany, RACE.MI for Ferrari Milan,
    // 0700.HK for Tencent HK, MC.PA for LVMH Paris), and ADRs.
    // Try Yahoo first; if it returns nothing, fall back to Finnhub (which
    // covers US stocks well but not international ones).
    tick = await fetchYahoo(symbol);
    if (!tick || !tick.price) tick = await fetchFinnhubQuote(symbol);
  } else {
    tick = await fetchFinnhubQuote(symbol);
  }

  if (!tick) {
    tick = {
      symbol,
      price: 0,
      change: 0,
      changePercent: 0,
      prevClose: null,
      source: 'unsupported',
      ts: Date.now(),
    };
  } else {
    tick.symbol = symbol; // normalise to caller's symbol form
  }

  cache.set(symbol, { data: tick, expires: Date.now() + TTL_MS });
  return tick;
}

/** Bulk fetch — used by frontend Macro Pulse + KPI ticker. */
export async function getPrices(symbols: string[]): Promise<Record<string, PriceTick>> {
  const results = await Promise.all(symbols.map((s) => getPrice(s)));
  const out: Record<string, PriceTick> = {};
  symbols.forEach((s, i) => { out[s] = results[i]; });
  return out;
}
