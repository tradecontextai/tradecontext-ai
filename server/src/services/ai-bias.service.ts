import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { env } from '../config/env';
import { HttpError } from '../middleware/error';
import { log } from '../lib/logger';
import { getPrice } from './price.service';
import { prisma } from '../config/db';
import { anthropic, claudeAvailable } from './claude.service';

/**
 * AI Bias Engine — generates live fundamental + technical analysis per symbol.
 *
 * Claude is asked for:
 *  - Fundamental analysis bias + 3 bullet points (news, macro drivers)
 *  - Technical analysis bias + 3 bullet points (chart structure, indicators)
 *  - Day-trade verdict (intraday bias)
 *  - Swing-trade verdict (multi-day bias)
 *
 * Each call uses live price + recent news context for the symbol so the
 * analysis is grounded, not hallucinated.
 *
 * Cached 10 min per symbol — TradeContext score uses 1h, but bias evolves
 * faster so we refresh every 10 min or when news arrives that mentions
 * the symbol (cache invalidation hook).
 */
const MODEL = 'claude-sonnet-4-6';
const CACHE_TTL_MS = 10 * 60 * 1000;

const BIAS_SYSTEM = `You are a senior trading desk analyst building a live AI bias dashboard for retail traders. Your job: given a symbol and recent context, produce a 4-part analysis.

Return a single JSON object with this exact shape:

{
  "fundamental": {
    "bias": "bullish" | "bearish" | "neutral",
    "points": ["<short bullet>", "<short bullet>", "<short bullet>"]
  },
  "technical": {
    "bias": "bullish" | "bearish" | "neutral",
    "points": ["<short bullet>", "<short bullet>", "<short bullet>"]
  },
  "dayTrade": {
    "bias": "bullish" | "bearish" | "neutral",
    "rationale": "<one sentence>"
  },
  "swingTrade": {
    "bias": "bullish" | "bearish" | "neutral",
    "rationale": "<one sentence>"
  }
}

Rules:
- "fundamental" = macro drivers, central bank policy, news sentiment, economic data, geopolitical events
- "technical" = price structure, support/resistance, momentum, volume, key MAs, chart patterns
- Each "points" array = exactly 3 bullets, max 14 words each, present tense, specific
- "dayTrade" = intraday (1-24h) — uses technicals + breaking news
- "swingTrade" = multi-day to multi-week — leans more on fundamentals
- "bias" can be "neutral" if conditions genuinely conflict — don't force a direction
- "rationale" = one tight sentence, max 22 words

Be honest about uncertainty. If price + news contradict, say so in a bullet.

Return JSON ONLY. No markdown, no preface, no fences.`;

const BiasSchema = z.object({
  fundamental: z.object({
    bias: z.enum(['bullish', 'bearish', 'neutral']),
    points: z.array(z.string()).min(1).max(5),
  }),
  technical: z.object({
    bias: z.enum(['bullish', 'bearish', 'neutral']),
    points: z.array(z.string()).min(1).max(5),
  }),
  dayTrade: z.object({
    bias: z.enum(['bullish', 'bearish', 'neutral']),
    rationale: z.string().max(280),
  }),
  swingTrade: z.object({
    bias: z.enum(['bullish', 'bearish', 'neutral']),
    rationale: z.string().max(280),
  }),
});

export type AiBias = z.infer<typeof BiasSchema>;

interface CacheEntry {
  data: AiBias;
  generatedAt: number;
  symbol: string;
}
const cache = new Map<string, CacheEntry>();

// Circuit breaker — pauses Claude calls for 30 min after credit-balance error
let _creditCircuitOpenUntil = 0;
function isCreditError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes('credit balance is too low') || msg.includes('insufficient_quota');
}

/** Invalidate the cache for a symbol — called when fresh news arrives mentioning it. */
export function invalidateBiasCache(symbol: string): void {
  cache.delete(symbol.toUpperCase());
}

function getJsonText(msg: Anthropic.Messages.Message): string {
  const block = msg.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('No text block');
  return block.text.trim();
}

function parseJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { /* fall through */ }
  const fenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(fenced); } catch { /* fall through */ }
  const first = fenced.indexOf('{');
  const last = fenced.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(fenced.slice(first, last + 1));
  throw new Error('Claude response was not parseable JSON');
}

/** Build the user message: live price + last 5-10 news items mentioning this symbol. */
async function buildContext(symbol: string): Promise<string> {
  const sym = symbol.toUpperCase();
  // Live price (Binance/Yahoo)
  let priceLine = '';
  try {
    const tick = await getPrice(symbol);
    if (tick.price > 0 && tick.source !== 'unsupported') {
      const dec = tick.price >= 10000 ? 0 : tick.price >= 100 ? 2 : 5;
      priceLine = `Current price: ${tick.price.toFixed(dec)} (${tick.changePercent >= 0 ? '+' : ''}${tick.changePercent.toFixed(2)}% on session)`;
    }
  } catch { /* swallow */ }

  // Recent news mentioning this symbol — last 24h, 8 most relevant
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const news = await prisma.newsStory.findMany({
    where: {
      publishedAt: { gte: since },
      affectedAssets: { has: sym },
    },
    orderBy: [{ isBreaking: 'desc' }, { publishedAt: 'desc' }],
    take: 8,
    select: { headline: true, bias: true, impact: true, isBreaking: true, reasoning: true, publishedAt: true },
  });

  const newsLines = news.map((n, i) => {
    const ageH = Math.round((Date.now() - n.publishedAt.getTime()) / 3_600_000);
    const tag = n.isBreaking ? '⚡' : n.impact === 'high' ? '🔴' : '·';
    return `  ${i + 1}. ${tag} [${n.bias}/${n.impact}] ${n.headline.slice(0, 110)} (${ageH}h ago)${n.reasoning ? ' — ' + n.reasoning.slice(0, 100) : ''}`;
  });

  return [
    `Symbol: ${sym}`,
    priceLine,
    '',
    `Recent news (last 24h, ${news.length} stories mentioning ${sym}):`,
    newsLines.length ? newsLines.join('\n') : '  (no news mentions in 24h — base on price + general macro)',
    '',
    'Generate the 4-part bias JSON. Be specific, current, honest.',
  ].filter(Boolean).join('\n');
}

/**
 * Get the live AI bias for a symbol. Caches per symbol for 10 min.
 *
 * Error handling:
 *  - 503 CLAUDE_DISABLED   → no API key configured
 *  - 503 CLAUDE_NO_CREDITS → user needs to top up Anthropic credits
 *                            (circuit breaker also opens for 30 min so
 *                             we don't hammer the API while exhausted)
 */
export async function getBias(symbol: string, opts?: { force?: boolean }): Promise<{ bias: AiBias; generatedAt: number; cached: boolean }> {
  if (!claudeAvailable() || !anthropic) {
    throw new HttpError(503, 'Claude API not configured', 'CLAUDE_DISABLED');
  }
  const key = symbol.toUpperCase();

  if (!opts?.force) {
    const c = cache.get(key);
    if (c && Date.now() - c.generatedAt < CACHE_TTL_MS) {
      return { bias: c.data, generatedAt: c.generatedAt, cached: true };
    }
  }

  // Circuit breaker — if Claude credits ran out recently, fail fast with a
  // clear message instead of hitting the API again. Frontend uses this code
  // to show a "top up credits" prompt instead of a generic error.
  if (Date.now() < _creditCircuitOpenUntil) {
    const minsLeft = Math.ceil((_creditCircuitOpenUntil - Date.now()) / 60_000);
    // If we have stale cached data, return it with a "stale" flag rather than nothing
    const stale = cache.get(key);
    if (stale) {
      return { bias: stale.data, generatedAt: stale.generatedAt, cached: true };
    }
    throw new HttpError(
      503,
      `Anthropic API credits exhausted. Top up at console.anthropic.com/settings/billing. Auto-retry in ${minsLeft} min.`,
      'CLAUDE_NO_CREDITS',
    );
  }

  const userMsg = await buildContext(symbol);

  let response;
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: [{ type: 'text', text: BIAS_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMsg }],
    });
  } catch (e) {
    if (isCreditError(e)) {
      _creditCircuitOpenUntil = Date.now() + 30 * 60 * 1000;
      log.error('AI Bias: Anthropic credits exhausted — circuit breaker open for 30min. Top up at https://console.anthropic.com/settings/billing');
      // Return stale cache if we have it, otherwise throw the helpful error
      const stale = cache.get(key);
      if (stale) {
        return { bias: stale.data, generatedAt: stale.generatedAt, cached: true };
      }
      throw new HttpError(
        503,
        'Anthropic API credits exhausted. Top up at console.anthropic.com/settings/billing to resume AI bias generation.',
        'CLAUDE_NO_CREDITS',
      );
    }
    throw e;
  }

  const raw = getJsonText(response);
  const bias = BiasSchema.parse(parseJson(raw));

  const generatedAt = Date.now();
  cache.set(key, { data: bias, generatedAt, symbol: key });
  log.info('AI Bias generated', {
    symbol: key,
    fundamental: bias.fundamental.bias,
    technical: bias.technical.bias,
    day: bias.dayTrade.bias,
    swing: bias.swingTrade.bias,
  });

  // Snapshot every component bias as a BiasOutcome row so the cron verifier
  // can later mark hit/miss vs actual price. Fire-and-forget — don't block
  // the user's bias call on the price-fetch + DB insert.
  void (async () => {
    try {
      const tick = await getPrice(symbol);
      if (!tick.price || tick.source === 'unsupported') return;
      const sources: Array<{ src: string; b: string; rationale?: string }> = [
        { src: 'fundamental', b: bias.fundamental.bias, rationale: bias.fundamental.points.join(' · ') },
        { src: 'technical', b: bias.technical.bias, rationale: bias.technical.points.join(' · ') },
        { src: 'dayTrade', b: bias.dayTrade.bias, rationale: bias.dayTrade.rationale },
        { src: 'swingTrade', b: bias.swingTrade.bias, rationale: bias.swingTrade.rationale },
      ];
      await prisma.biasOutcome.createMany({
        data: sources.map((s) => ({
          symbol: key,
          bias: s.b,
          source: s.src,
          generatedAt: new Date(generatedAt),
          priceAtGen: tick.price,
          rationale: s.rationale ?? null,
        })),
      });
    } catch (e) {
      log.debug('AI Bias outcome snapshot failed', { err: (e as Error)?.message });
    }
  })();

  return { bias, generatedAt, cached: false };
}

/** Manually clear the credit circuit breaker — call when you've topped up. */
export function resetCreditCircuit(): void {
  _creditCircuitOpenUntil = 0;
  log.info('AI Bias credit circuit breaker reset');
}
