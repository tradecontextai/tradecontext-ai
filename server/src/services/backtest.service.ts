/**
 * Backtest service.
 *
 * Pulls historical OHLC for any symbol the live-price service understands,
 * runs one of a small library of well-known strategies, and returns:
 *   - The trade list (entry/exit/side/R-multiple/pct return)
 *   - Aggregate stats (win rate, profit factor, max drawdown, etc.)
 *   - The equity curve (compounded $1)
 *
 * All maths is done in-process — there's no external backtest dependency.
 * Strategies are intentionally simple and educational; this is meant to
 * give traders a quick "would this idea even have worked?" answer, not
 * to be a tick-precise replacement for a real production engine.
 */
import { log } from '../lib/logger';

const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart';
const BINANCE = 'https://api.binance.com/api/v3';

// ──────── public types ────────
export type Interval = '15m' | '1h' | '4h' | '1d';
export type StrategyId = 'rsi_mean_reversion' | 'ma_crossover' | 'breakout';
export type Side = 'long' | 'short';

export interface Candle {
  ts: number;     // ms epoch
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Trade {
  side: Side;
  entryTs: number;
  entryPx: number;
  exitTs: number;
  exitPx: number;
  exitReason: 'target' | 'stop' | 'signal' | 'eod';
  rMultiple: number;       // signed; +2 means 2R winner, -1 means full stop
  pnlPct: number;          // signed % move (price-only, no leverage)
  barsHeld: number;
  // Per-trade context for the UI
  stopPx: number;
  targetPx: number;
}

export interface BacktestStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;          // 0..1
  avgR: number;
  bestR: number;
  worstR: number;
  profitFactor: number;     // sum(wins$) / sum(losses$)
  totalReturnPct: number;   // % return on equity from compounded trades
  maxDrawdownPct: number;
  expectancyR: number;      // (winRate * avgWinR) - (lossRate * |avgLossR|)
  avgBarsHeld: number;
  startTs: number;
  endTs: number;
}

export interface EquityPoint {
  ts: number;
  equity: number;           // starts at 1.0
}

export interface BacktestResult {
  symbol: string;
  interval: Interval;
  strategy: StrategyId;
  params: Record<string, number>;
  candles: Candle[];
  trades: Trade[];
  equity: EquityPoint[];
  stats: BacktestStats;
  source: 'yahoo' | 'binance';
}

// ──────── symbol mapping (mirrors price.service so the user can paste any symbol) ────────
const CRYPTO_PAIRS: Record<string, string> = {
  'BTC/USD': 'BTCUSDT', 'BTC': 'BTCUSDT',
  'ETH/USD': 'ETHUSDT', 'ETH': 'ETHUSDT',
  'SOL/USD': 'SOLUSDT', 'SOL': 'SOLUSDT',
  'BNB/USD': 'BNBUSDT', 'XRP/USD': 'XRPUSDT',
  'ADA/USD': 'ADAUSDT', 'DOGE/USD': 'DOGEUSDT',
  'AVAX/USD': 'AVAXUSDT', 'LINK/USD': 'LINKUSDT',
};
const FOREX_YAHOO: Record<string, string> = {
  'EUR/USD': 'EURUSD=X', 'GBP/USD': 'GBPUSD=X', 'USD/JPY': 'JPY=X',
  'AUD/USD': 'AUDUSD=X', 'USD/CAD': 'CAD=X', 'NZD/USD': 'NZDUSD=X',
  'EUR/JPY': 'EURJPY=X', 'GBP/JPY': 'GBPJPY=X', 'EUR/GBP': 'EURGBP=X',
  'USD/CHF': 'CHF=X',
};
const INDEX_YAHOO: Record<string, string> = {
  'NASDAQ': '^IXIC', 'NDX': '^NDX',
  'S&P 500': '^GSPC', 'SPX': '^GSPC',
  'DOW': '^DJI', 'FTSE 100': '^FTSE',
  'DAX': '^GDAXI', 'NIKKEI': '^N225',
  'DXY': 'DX-Y.NYB', 'VIX': '^VIX',
};
const COMMODITIES_YAHOO: Record<string, string> = {
  'XAU/USD': 'GC=F', 'Gold': 'GC=F',
  'XAG/USD': 'SI=F', 'Silver': 'SI=F',
  'WTI': 'CL=F', 'WTI Oil': 'CL=F',
  'Brent': 'BZ=F', 'Nat Gas': 'NG=F',
};

// Yahoo's range parameter — we want enough history to get statistically meaningful
// trade counts even on the daily chart.
const YAHOO_RANGE_BY_INTERVAL: Record<Interval, string> = {
  '15m': '60d',   // Yahoo caps 15m at 60d
  '1h': '730d',   // 2 years of hourly
  '4h': '730d',   // we'll resample 1h → 4h client-side
  '1d': '10y',    // 10 years daily
};

// Yahoo's interval parameter; "4h" doesn't exist, so we fetch 1h and resample.
const YAHOO_INTERVAL: Record<Interval, string> = {
  '15m': '15m',
  '1h': '60m',
  '4h': '60m',
  '1d': '1d',
};

const BINANCE_INTERVAL: Record<Interval, string> = {
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
};

// ──────── data fetchers ────────
async function fetchYahooCandles(yfSymbol: string, interval: Interval): Promise<Candle[]> {
  const range = YAHOO_RANGE_BY_INTERVAL[interval];
  const yfInt = YAHOO_INTERVAL[interval];
  const url = `${YAHOO}/${encodeURIComponent(yfSymbol)}?interval=${yfInt}&range=${range}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 TradeContext/1.0' } });
  if (!res.ok) throw new Error(`Yahoo ${res.status}`);
  const j = await res.json() as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ open?: number[]; high?: number[]; low?: number[]; close?: number[]; volume?: number[] }> };
      }>;
    };
  };
  const r = j.chart?.result?.[0];
  const ts = r?.timestamp;
  const q = r?.indicators?.quote?.[0];
  if (!ts || !q?.close) throw new Error('Yahoo: no candles');
  const out: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], v = q.volume?.[i];
    if (o == null || h == null || l == null || c == null) continue; // skip incomplete bars
    out.push({ ts: ts[i] * 1000, o, h, l, c, v: v ?? 0 });
  }
  return interval === '4h' ? resampleTo4h(out) : out;
}

async function fetchBinanceCandles(pair: string, interval: Interval): Promise<Candle[]> {
  // Binance kline limit is 1000 per call — fine for the windows we care about.
  const bi = BINANCE_INTERVAL[interval];
  const limit = 1000;
  const url = `${BINANCE}/klines?symbol=${pair}&interval=${bi}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance ${res.status}`);
  const arr = await res.json() as Array<[number, string, string, string, string, string, number, ...unknown[]]>;
  return arr.map((k) => ({
    ts: k[0],
    o: parseFloat(k[1]),
    h: parseFloat(k[2]),
    l: parseFloat(k[3]),
    c: parseFloat(k[4]),
    v: parseFloat(k[5]),
  }));
}

// Resample 60m → 4h. We bucket by floor(ts / 4h).
function resampleTo4h(c: Candle[]): Candle[] {
  const BUCKET = 4 * 60 * 60 * 1000;
  const map = new Map<number, Candle>();
  for (const bar of c) {
    const key = Math.floor(bar.ts / BUCKET) * BUCKET;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, { ts: key, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v });
    } else {
      cur.h = Math.max(cur.h, bar.h);
      cur.l = Math.min(cur.l, bar.l);
      cur.c = bar.c;
      cur.v += bar.v;
    }
  }
  return Array.from(map.values()).sort((a, b) => a.ts - b.ts);
}

// ──────── dispatcher: any symbol → candles ────────
async function loadCandles(symbol: string, interval: Interval): Promise<{ candles: Candle[]; source: 'yahoo' | 'binance' }> {
  const sym = symbol.trim();
  if (CRYPTO_PAIRS[sym]) {
    const candles = await fetchBinanceCandles(CRYPTO_PAIRS[sym], interval);
    return { candles, source: 'binance' };
  }
  let yf: string | undefined;
  if (FOREX_YAHOO[sym]) yf = FOREX_YAHOO[sym];
  else if (INDEX_YAHOO[sym]) yf = INDEX_YAHOO[sym];
  else if (COMMODITIES_YAHOO[sym]) yf = COMMODITIES_YAHOO[sym];
  else if (/^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(sym)) yf = sym; // generic stock ticker
  if (!yf) throw new Error(`Unsupported symbol: ${symbol}`);
  const candles = await fetchYahooCandles(yf, interval);
  return { candles, source: 'yahoo' };
}

// ──────── indicators ────────
function rsi(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) avgGain += ch; else avgLoss -= ch;
  }
  avgGain /= period; avgLoss /= period;
  out[period] = 100 - 100 / (1 + (avgLoss === 0 ? 1e9 : avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = ch >= 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = 100 - 100 / (1 + (avgLoss === 0 ? 1e9 : avgGain / avgLoss));
  }
  return out;
}

function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    sum += values[i] - values[i - period];
    out[i] = sum / period;
  }
  return out;
}

function rollingHigh(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period; i < values.length; i++) {
    let hi = -Infinity;
    for (let j = i - period; j < i; j++) if (values[j] > hi) hi = values[j];
    out[i] = hi;
  }
  return out;
}
function rollingLow(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period; i < values.length; i++) {
    let lo = Infinity;
    for (let j = i - period; j < i; j++) if (values[j] < lo) lo = values[j];
    out[i] = lo;
  }
  return out;
}

// ──────── trade simulator ────────
// Common engine: given a desired entry on bar i, build the trade by walking forward
// bar-by-bar checking whether stop or target gets hit first. Conservative tie-break:
// if a single bar's range hits both stop and target, assume stop hit (worst-case).
interface OpenIntent {
  side: Side;
  entryPx: number;
  stopPx: number;
  targetPx: number;
  entryIdx: number;
}
function simulateTrade(candles: Candle[], intent: OpenIntent, maxBars: number): Trade {
  const { side, entryPx, stopPx, targetPx, entryIdx } = intent;
  const initialRisk = Math.abs(entryPx - stopPx);
  for (let i = entryIdx + 1; i < Math.min(entryIdx + 1 + maxBars, candles.length); i++) {
    const bar = candles[i];
    if (side === 'long') {
      const hitStop = bar.l <= stopPx;
      const hitTgt = bar.h >= targetPx;
      if (hitStop) {
        return makeTrade(side, entryPx, stopPx, candles[entryIdx].ts, bar.ts, 'stop', i - entryIdx, stopPx, targetPx);
      }
      if (hitTgt) {
        return makeTrade(side, entryPx, targetPx, candles[entryIdx].ts, bar.ts, 'target', i - entryIdx, stopPx, targetPx);
      }
    } else {
      const hitStop = bar.h >= stopPx;
      const hitTgt = bar.l <= targetPx;
      if (hitStop) {
        return makeTrade(side, entryPx, stopPx, candles[entryIdx].ts, bar.ts, 'stop', i - entryIdx, stopPx, targetPx);
      }
      if (hitTgt) {
        return makeTrade(side, entryPx, targetPx, candles[entryIdx].ts, bar.ts, 'target', i - entryIdx, stopPx, targetPx);
      }
    }
  }
  // Ran out of room — close at the last close as 'eod'.
  const lastIdx = Math.min(entryIdx + maxBars, candles.length - 1);
  const last = candles[lastIdx];
  return makeTrade(side, entryPx, last.c, candles[entryIdx].ts, last.ts, 'eod', lastIdx - entryIdx, stopPx, targetPx);

  function makeTrade(
    s: Side, ePx: number, xPx: number, eTs: number, xTs: number,
    reason: Trade['exitReason'], bars: number, sPx: number, tPx: number,
  ): Trade {
    const move = s === 'long' ? (xPx - ePx) : (ePx - xPx);
    const r = initialRisk === 0 ? 0 : move / initialRisk;
    const pnlPct = (move / ePx) * 100;
    return {
      side: s, entryTs: eTs, entryPx: ePx, exitTs: xTs, exitPx: xPx,
      exitReason: reason, rMultiple: r, pnlPct, barsHeld: bars,
      stopPx: sPx, targetPx: tPx,
    };
  }
}

// ──────── strategies ────────
// Each strategy returns the list of OpenIntent signals; the engine then walks
// each one forward to a trade outcome.

function strategyRsi(candles: Candle[], p: { period: number; oversold: number; overbought: number; rrRatio: number; stopAtrMult: number }): OpenIntent[] {
  const closes = candles.map((c) => c.c);
  const r = rsi(closes, p.period);
  const intents: OpenIntent[] = [];
  // 14-period ATR proxy: simple range mean
  const atr = sma(candles.map((c) => c.h - c.l), 14);
  for (let i = p.period + 1; i < candles.length - 1; i++) {
    const prev = r[i - 1];
    const cur = r[i];
    const at = atr[i] ?? null;
    if (prev == null || cur == null || at == null) continue;
    // Long: RSI crosses *up* through oversold
    if (prev <= p.oversold && cur > p.oversold) {
      const entryPx = candles[i].c;
      const stopPx = entryPx - at * p.stopAtrMult;
      const risk = entryPx - stopPx;
      const targetPx = entryPx + risk * p.rrRatio;
      intents.push({ side: 'long', entryPx, stopPx, targetPx, entryIdx: i });
    }
    // Short: RSI crosses *down* through overbought
    if (prev >= p.overbought && cur < p.overbought) {
      const entryPx = candles[i].c;
      const stopPx = entryPx + at * p.stopAtrMult;
      const risk = stopPx - entryPx;
      const targetPx = entryPx - risk * p.rrRatio;
      intents.push({ side: 'short', entryPx, stopPx, targetPx, entryIdx: i });
    }
  }
  return intents;
}

function strategyMaCross(candles: Candle[], p: { fast: number; slow: number; rrRatio: number; stopAtrMult: number }): OpenIntent[] {
  const closes = candles.map((c) => c.c);
  const fast = sma(closes, p.fast);
  const slow = sma(closes, p.slow);
  const atr = sma(candles.map((c) => c.h - c.l), 14);
  const intents: OpenIntent[] = [];
  for (let i = p.slow + 1; i < candles.length - 1; i++) {
    const f0 = fast[i - 1], f1 = fast[i], s0 = slow[i - 1], s1 = slow[i], at = atr[i];
    if (f0 == null || f1 == null || s0 == null || s1 == null || at == null) continue;
    // Bullish cross
    if (f0 <= s0 && f1 > s1) {
      const entryPx = candles[i].c;
      const stopPx = entryPx - at * p.stopAtrMult;
      const risk = entryPx - stopPx;
      const targetPx = entryPx + risk * p.rrRatio;
      intents.push({ side: 'long', entryPx, stopPx, targetPx, entryIdx: i });
    }
    // Bearish cross
    if (f0 >= s0 && f1 < s1) {
      const entryPx = candles[i].c;
      const stopPx = entryPx + at * p.stopAtrMult;
      const risk = stopPx - entryPx;
      const targetPx = entryPx - risk * p.rrRatio;
      intents.push({ side: 'short', entryPx, stopPx, targetPx, entryIdx: i });
    }
  }
  return intents;
}

function strategyBreakout(candles: Candle[], p: { lookback: number; rrRatio: number; stopAtrMult: number }): OpenIntent[] {
  const closes = candles.map((c) => c.c);
  const hi = rollingHigh(closes, p.lookback);
  const lo = rollingLow(closes, p.lookback);
  const atr = sma(candles.map((c) => c.h - c.l), 14);
  const intents: OpenIntent[] = [];
  for (let i = p.lookback + 1; i < candles.length - 1; i++) {
    const prevHi = hi[i], prevLo = lo[i], at = atr[i];
    if (prevHi == null || prevLo == null || at == null) continue;
    const c = candles[i].c;
    if (c > prevHi) {
      const entryPx = c;
      const stopPx = entryPx - at * p.stopAtrMult;
      const risk = entryPx - stopPx;
      const targetPx = entryPx + risk * p.rrRatio;
      intents.push({ side: 'long', entryPx, stopPx, targetPx, entryIdx: i });
    } else if (c < prevLo) {
      const entryPx = c;
      const stopPx = entryPx + at * p.stopAtrMult;
      const risk = stopPx - entryPx;
      const targetPx = entryPx - risk * p.rrRatio;
      intents.push({ side: 'short', entryPx, stopPx, targetPx, entryIdx: i });
    }
  }
  return intents;
}

// ──────── stats + equity curve ────────
function buildStatsAndEquity(trades: Trade[]): { stats: BacktestStats; equity: EquityPoint[] } {
  if (!trades.length) {
    return {
      stats: {
        totalTrades: 0, wins: 0, losses: 0, winRate: 0, avgR: 0, bestR: 0, worstR: 0,
        profitFactor: 0, totalReturnPct: 0, maxDrawdownPct: 0, expectancyR: 0, avgBarsHeld: 0,
        startTs: 0, endTs: 0,
      },
      equity: [],
    };
  }
  let wins = 0, losses = 0;
  let sumWinPct = 0, sumLossPct = 0;
  let bestR = -Infinity, worstR = Infinity;
  let sumR = 0, sumBars = 0;
  for (const t of trades) {
    if (t.pnlPct > 0) { wins++; sumWinPct += t.pnlPct; }
    else if (t.pnlPct < 0) { losses++; sumLossPct += Math.abs(t.pnlPct); }
    if (t.rMultiple > bestR) bestR = t.rMultiple;
    if (t.rMultiple < worstR) worstR = t.rMultiple;
    sumR += t.rMultiple;
    sumBars += t.barsHeld;
  }
  // Build compounded equity curve. We treat each trade as a sequential bet
  // sized so the stop = 1% of equity (a "1R" of equity). PnL is just the R
  // multiple × 0.01. This is more intuitive for traders than raw price-pct.
  const RISK_PER_TRADE = 0.01;
  let equity = 1;
  let peak = 1;
  let maxDD = 0;
  const eq: EquityPoint[] = [{ ts: trades[0].entryTs, equity: 1 }];
  for (const t of trades) {
    equity = equity * (1 + t.rMultiple * RISK_PER_TRADE);
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;
    eq.push({ ts: t.exitTs, equity });
  }
  const winRate = wins / trades.length;
  const profitFactor = sumLossPct === 0 ? (sumWinPct > 0 ? Infinity : 0) : sumWinPct / sumLossPct;
  const avgR = sumR / trades.length;
  const avgWinR = wins ? trades.filter((t) => t.rMultiple > 0).reduce((s, t) => s + t.rMultiple, 0) / wins : 0;
  const avgLossR = losses ? trades.filter((t) => t.rMultiple < 0).reduce((s, t) => s + t.rMultiple, 0) / losses : 0;
  const expectancyR = winRate * avgWinR + (1 - winRate) * avgLossR;
  return {
    stats: {
      totalTrades: trades.length,
      wins, losses, winRate,
      avgR, bestR, worstR,
      profitFactor,
      totalReturnPct: (equity - 1) * 100,
      maxDrawdownPct: maxDD * 100,
      expectancyR,
      avgBarsHeld: sumBars / trades.length,
      startTs: trades[0].entryTs,
      endTs: trades[trades.length - 1].exitTs,
    },
    equity: eq,
  };
}

// ──────── public entry point ────────
export interface RunBacktestInput {
  symbol: string;
  interval: Interval;
  strategy: StrategyId;
  params?: Record<string, number>;
  maxBarsPerTrade?: number;
}

export async function runBacktest(input: RunBacktestInput): Promise<BacktestResult> {
  const { symbol, interval, strategy } = input;
  const maxBars = input.maxBarsPerTrade ?? 100;
  const t0 = Date.now();
  const { candles, source } = await loadCandles(symbol, interval);
  if (candles.length < 60) throw new Error(`Not enough candles (got ${candles.length})`);

  let intents: OpenIntent[];
  const usedParams: Record<string, number> = {};

  if (strategy === 'rsi_mean_reversion') {
    const p = {
      period: input.params?.period ?? 14,
      oversold: input.params?.oversold ?? 30,
      overbought: input.params?.overbought ?? 70,
      rrRatio: input.params?.rrRatio ?? 2,
      stopAtrMult: input.params?.stopAtrMult ?? 1.5,
    };
    Object.assign(usedParams, p);
    intents = strategyRsi(candles, p);
  } else if (strategy === 'ma_crossover') {
    const p = {
      fast: input.params?.fast ?? 20,
      slow: input.params?.slow ?? 50,
      rrRatio: input.params?.rrRatio ?? 2,
      stopAtrMult: input.params?.stopAtrMult ?? 2,
    };
    Object.assign(usedParams, p);
    intents = strategyMaCross(candles, p);
  } else {
    const p = {
      lookback: input.params?.lookback ?? 20,
      rrRatio: input.params?.rrRatio ?? 2,
      stopAtrMult: input.params?.stopAtrMult ?? 1.5,
    };
    Object.assign(usedParams, p);
    intents = strategyBreakout(candles, p);
  }

  // Walk every signal forward into a real trade outcome. Cap concurrent trades
  // to 1 — if a trade is open, skip any new intents until it closes.
  const trades: Trade[] = [];
  let nextOpenIdx = 0;
  for (const intent of intents) {
    if (intent.entryIdx < nextOpenIdx) continue;
    const trade = simulateTrade(candles, intent, maxBars);
    trades.push(trade);
    // Mark the bar AFTER exit as the first eligible new entry
    const exitIdx = candles.findIndex((c) => c.ts === trade.exitTs);
    nextOpenIdx = exitIdx >= 0 ? exitIdx + 1 : intent.entryIdx + 1;
  }

  const { stats, equity } = buildStatsAndEquity(trades);
  const out: BacktestResult = {
    symbol, interval, strategy, params: usedParams,
    candles, trades, equity, stats, source,
  };
  log.info('Backtest run', {
    symbol, interval, strategy,
    candles: candles.length, trades: trades.length,
    ms: Date.now() - t0,
  });
  return out;
}
