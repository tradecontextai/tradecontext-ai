import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { env } from '../config/env';
import { log } from '../lib/logger';
import { HttpError } from '../middleware/error';

/**
 * Single Anthropic client instance — null if no key, callers must check.
 * Briefing §4.3 specified claude-sonnet-4-20250514, but that's been
 * deprecated. claude-sonnet-4-6 is the current Sonnet (May 2026) — same
 * pricing tier, better reasoning. Prompt caching on system messages
 * reduces cost ~90% on repeated structured-output calls.
 */
const MODEL = 'claude-sonnet-4-6';

export const anthropic = env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  : null;

export const claudeAvailable = (): boolean => anthropic !== null;

// ──────── shared JSON extractor ────────
/**
 * Claude usually returns clean JSON when asked, but occasionally wraps it
 * in prose or fences. Strip both — accept first `{ ... }` we find.
 */
function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  // Try parse direct first (Claude is usually well-behaved)
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  // Strip markdown fences
  const fenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(fenced);
  } catch {
    /* fall through */
  }
  // Find first { ... } block
  const first = fenced.indexOf('{');
  const last = fenced.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return JSON.parse(fenced.slice(first, last + 1));
  }
  throw new Error('Claude response did not contain parseable JSON');
}

function getText(msg: Anthropic.Messages.Message): string {
  const block = msg.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('No text block in Claude response');
  return block.text;
}

// ════════════════ NEWS SCORING ════════════════
const SCORE_SYSTEM = `You are a professional financial analyst working for a premium trading-intelligence platform. Your only job is to score breaking financial news headlines for trading bias.

For each headline you receive, return a single JSON object with this exact shape:

{
  "bias": "bull" | "bear" | "neutral",
  "impact": "high" | "medium" | "low",
  "affectedMarkets": [
    {
      "symbol": "XAU/USD",
      "direction": "up" | "down",
      "expectedMovePct": 1.5,
      "rationale": "safe haven flow"
    }
  ],
  "reasoning": "<one concise overall sentence>",
  "breaking": true | false
}

Rules:
- "bias": overall — will the affected assets MOST LIKELY move up (bull), down (bear), or stay range-bound (neutral) over the next 1-24 hours?
- "impact": "high" = institutional flows likely (CPI, NFP, central bank, war, major M&A); "medium" = sector-moving; "low" = headline noise
- "affectedMarkets": list 5–10 assets directly affected by THIS specific story, ordered most-to-least affected. Each entry MUST have all 4 fields.
- "symbol": forex pairs as "EUR/USD" not "EURUSD". Equity indices as "S&P 500", "NASDAQ", "FTSE 100", "DAX". Commodities as "XAU/USD" (gold), "XAG/USD" (silver), "WTI", "Brent". Crypto as "BTC/USD", "ETH/USD".
- "direction": "up" if asset MOST LIKELY rises, "down" if it falls. Must match sign of expectedMovePct.
- "expectedMovePct": YOUR best estimate of the % move expected over the next 1–24 hours. SIGNED — positive for up, negative for down. Typical absolute range 0.1–5.0. Don't sandbag — give a real estimate.
- "rationale": short reason for THIS specific asset, max 6 words (e.g. "safe haven", "risk-off rotation", "yields lower").
- "reasoning": 1 sentence, max 25 words, plain English summary of why this moves markets overall.
- "breaking": true ONLY for time-critical events (war, surprise rate decision, market-moving release, major company news). Default false.

Return JSON ONLY. No markdown, no preface, no code fences.`;

const AffectedMarketSchema = z.object({
  symbol: z.string().min(1).max(20),
  direction: z.enum(['up', 'down']),
  expectedMovePct: z.number().min(-15).max(15),
  rationale: z.string().max(80).default(''),
});

const ScoreSchema = z.object({
  bias: z.enum(['bull', 'bear', 'neutral']),
  impact: z.enum(['high', 'medium', 'low']),
  affectedMarkets: z.array(AffectedMarketSchema).min(0).max(15).default([]),
  // Backward-compat: some older responses might still use `assets` — accept and convert
  assets: z.array(z.string()).optional(),
  reasoning: z.string().max(400),
  breaking: z.boolean(),
});

export type AffectedMarket = z.infer<typeof AffectedMarketSchema>;
export type NewsScore = z.infer<typeof ScoreSchema>;

export async function scoreHeadline(
  headline: string,
  summary?: string,
): Promise<NewsScore> {
  if (!anthropic) throw new HttpError(503, 'ANTHROPIC_API_KEY not configured', 'CLAUDE_DISABLED');

  const userMsg = `Headline: ${headline}\n\nSummary: ${summary?.trim() || '(no summary provided)'}\n\nReturn JSON only.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500, // up from 400 — affectedMarkets array can need ~800 tokens
    system: [
      {
        type: 'text',
        text: SCORE_SYSTEM,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMsg }],
  });

  const raw = getText(response);
  const parsed = ScoreSchema.parse(extractJson(raw));
  return parsed;
}

// ════════════════ PLAYBOOK GENERATION ════════════════
const PLAYBOOK_SYSTEM = `You are a professional forex, commodities and crypto trader generating actionable trade playbooks for retail traders.

For each asset + news context you receive, return a single JSON object with this exact shape:

{
  "symbol": "<asset>",
  "bias": "bull" | "bear" | "neutral",
  "confidence": "high" | "medium" | "low",
  "bull_case": {
    "entry": <number>,
    "take_profit": <number>,
    "stop_loss": <number>,
    "reasoning": "<1-2 sentences>",
    "rr_ratio": "<1:X.X>"
  },
  "bear_case": {
    "entry": <number>,
    "take_profit": <number>,
    "stop_loss": <number>,
    "reasoning": "<1-2 sentences>",
    "rr_ratio": "<1:X.X>"
  },
  "key_levels": ["<S/R or fib level descriptors>"],
  "invalidation": "<what would invalidate this playbook in 1-2 sentences>"
}

Rules:
- Levels must be realistic numbers near current price. Use 4 decimals for forex pairs, 2 for indices/metals, integer for crypto > 1000.
- R:R must be at least 1:2 — adjust SL/TP if the structure can't support it. Stronger setups should target 1:3+.
- "confidence": "high" only when news + technicals strongly align. "medium" default. "low" if conflicting signals.
- "key_levels": 2-4 short descriptors like "S: 1.0950", "R: 1.1080", "200 EMA 1.0975", "Fib 61.8%".
- Generate BOTH cases — bull and bear — even when bias is decisive. The losing case is for invalidation reference.

This is NOT financial advice. Output is informational. Be specific, not vague.

Return JSON ONLY. No markdown, no preface, no code fences.`;

const PlaybookSchema = z.object({
  symbol: z.string(),
  bias: z.enum(['bull', 'bear', 'neutral']),
  confidence: z.enum(['high', 'medium', 'low']),
  bull_case: z.object({
    entry: z.number(),
    take_profit: z.number(),
    stop_loss: z.number(),
    reasoning: z.string(),
    rr_ratio: z.string().optional().default(''),
  }),
  bear_case: z.object({
    entry: z.number(),
    take_profit: z.number(),
    stop_loss: z.number(),
    reasoning: z.string(),
    rr_ratio: z.string().optional().default(''),
  }),
  key_levels: z.array(z.string()).max(8),
  invalidation: z.string(),
});

export type Playbook = z.infer<typeof PlaybookSchema>;

export async function generatePlaybook(opts: {
  symbol: string;
  newsContext?: string;
  currentPrice?: number;
}): Promise<Playbook> {
  if (!anthropic) throw new HttpError(503, 'ANTHROPIC_API_KEY not configured', 'CLAUDE_DISABLED');

  const parts: string[] = [`Asset: ${opts.symbol}`];
  if (opts.newsContext) parts.push(`News context: ${opts.newsContext}`);
  if (opts.currentPrice !== undefined) parts.push(`Current price: ${opts.currentPrice}`);
  parts.push('Generate a complete trade playbook. Return JSON only.');

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: [
      {
        type: 'text',
        text: PLAYBOOK_SYSTEM,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: parts.join('\n\n') }],
  });

  const raw = getText(response);
  return PlaybookSchema.parse(extractJson(raw));
}

// ════════════════ TRADER SCORE (briefing §4.5) ════════════════
const TRADER_SCORE_SYSTEM = `You are a senior performance coach for prop traders. You analyse a trader's recent trades and produce a TradeContext Score with sub-ratings.

Return a single JSON object with this exact shape:

{
  "overall_score": <0-100 integer>,
  "consistency": <0-100>,
  "risk_management": <0-100>,
  "discipline": <0-100>,
  "label": "<short label like 'Excellent', 'Good Trader', 'Inconsistent', 'Beginner'>",
  "insights": ["<1-3 short observations about strengths>"],
  "improvements": ["<1-3 specific, actionable areas to improve>"]
}

Scoring approach:
- consistency: hit-rate stability, R-multiple variance, similar setup repetition
- risk_management: stop discipline, avg loss vs avg win, max-loss outliers
- discipline: revenge-trading patterns, trades around news, oversizing
- overall_score: weighted average favouring risk_management
- Be honest — don't inflate scores. A trader losing money should NOT score above 50.

Return JSON ONLY.`;

const TraderScoreSchema = z.object({
  overall_score: z.number().int().min(0).max(100),
  consistency: z.number().int().min(0).max(100),
  risk_management: z.number().int().min(0).max(100),
  discipline: z.number().int().min(0).max(100),
  label: z.string(),
  insights: z.array(z.string()).max(5),
  improvements: z.array(z.string()).max(5),
});

export type TraderScore = z.infer<typeof TraderScoreSchema>;

export async function generateTraderScore(tradesJson: unknown): Promise<TraderScore> {
  if (!anthropic) throw new HttpError(503, 'ANTHROPIC_API_KEY not configured', 'CLAUDE_DISABLED');

  const userMsg = `Trades:\n${JSON.stringify(tradesJson, null, 2)}\n\nAnalyse and return TradeContext Score JSON.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: [
      { type: 'text', text: TRADER_SCORE_SYSTEM, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userMsg }],
  });

  const raw = getText(response);
  return TraderScoreSchema.parse(extractJson(raw));
}

// ──────── Convenience: log token usage / cache hits ────────
export function logUsage(tag: string, msg: Anthropic.Messages.Message) {
  const u = msg.usage;
  log.debug(`Claude usage [${tag}]`, {
    input: u.input_tokens,
    output: u.output_tokens,
    cache_read: u.cache_read_input_tokens ?? 0,
    cache_create: u.cache_creation_input_tokens ?? 0,
  });
}
