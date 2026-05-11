/**
 * Journal AI Coach — POST /api/journal/coach
 *
 * A public, demo-friendly endpoint (no auth) that lets the journal page hit
 * Claude with a snapshot of the user's trades, stats and a question.
 *
 * The coaching style is intentionally different from the dashboard's AI
 * Trading Analyst — this isn't about reading the chart, it's about reading
 * the trader. Claude is told to be specific, look for patterns across the
 * trade list, call out behavioural mistakes, and ask coaching questions
 * rather than spoon-feed answers.
 *
 * Request shape (zod-validated):
 *   {
 *     message: string;            // the user's question / prompt
 *     trades?: Array<{            // optional — page sends last 50
 *       symbol, side, entryPx, exitPx, pnlR, pnlPct,
 *       setupTag, mistakes?: string[], adherence?: number,
 *       emotionBefore?: number, emotionAfter?: number, entryTs
 *     }>;
 *     stats?: {                   // optional aggregate context
 *       totalTrades, winRate, profitFactor, avgR, maxDrawdownPct,
 *       disciplineGrade?, currentStreak?
 *     };
 *     history?: Array<{ role: 'user'|'assistant', content: string }>;
 *   }
 */
import { Router } from 'express';
import { z } from 'zod';
import { anthropic, claudeAvailable } from '../services/claude.service';
import { rateLimit } from '../middleware/rate-limit';
import { log } from '../lib/logger';
import { HttpError } from '../middleware/error';

export const journalCoachRouter = Router();

const COACH_LIMIT = rateLimit({ ratePerSec: 0.5, burst: 8 });

const tradeShape = z.object({
  symbol: z.string().max(40),
  side: z.enum(['long', 'short']),
  entryPx: z.number().optional(),
  exitPx: z.number().optional(),
  pnlR: z.number().optional(),
  pnlPct: z.number().optional(),
  setupTag: z.string().max(60).optional(),
  mistakes: z.array(z.string().max(40)).max(10).optional(),
  adherence: z.number().min(1).max(5).optional(),
  emotionBefore: z.number().min(1).max(5).optional(),
  emotionAfter: z.number().min(1).max(5).optional(),
  entryTs: z.string().or(z.number()).optional(),
}).passthrough();

const schema = z.object({
  message: z.string().min(1).max(2000),
  trades: z.array(tradeShape).max(50).optional(),
  stats: z.record(z.string(), z.any()).optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(4000),
  })).max(20).optional(),
});

const COACH_SYSTEM = `You are a no-nonsense trading performance coach inside the
TradeContext.ai journal. The trader has shared their recent trades, plan-adherence
scores, mistakes they've self-tagged, and aggregate stats. Use it.

Coaching style:
- BE SPECIFIC. Quote exact numbers from their data: "Your win rate on Sweep+OB is
  74% but only 38% on News pop trades — why are you still taking the latter?"
- LOOK FOR PATTERNS. Repeated mistakes, time-of-day correlations, revenge clusters,
  size creep on losers, stop moves. Surface them.
- ASK QUESTIONS more than you state answers. "Walk me through that trade — what
  was the thesis?" lands harder than "you should be more disciplined."
- KEEP IT TIGHT. Under 200 words unless the trader asks for depth. Use **bold**
  and short paragraphs. No fluff, no disclaimers in every reply.
- BE HONEST when the data is too thin: "You've only logged 4 trades — give me 20+
  and I'll spot real patterns. For now, here's what stands out…"
- ALWAYS end with ONE concrete next action: "Before your next trade, write down
  the invalidation level. That's the one thing."

End every coaching reply with:
*Educational guidance — not personal financial advice.*`;

function summariseTrades(trades: z.infer<typeof tradeShape>[]): string {
  if (!trades?.length) return '(no trades shared)';
  return trades.slice(0, 30).map((t, i) => {
    const r = t.pnlR != null ? `${t.pnlR.toFixed(2)}R` : '?R';
    const pct = t.pnlPct != null ? ` (${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%)` : '';
    const setup = t.setupTag ? ` · ${t.setupTag}` : '';
    const adh = t.adherence != null ? ` · adh:${t.adherence}/5` : '';
    const emo = t.emotionAfter != null ? ` · emo:${t.emotionAfter}/5` : '';
    const mis = t.mistakes?.length ? ` · mistakes:[${t.mistakes.join(', ')}]` : '';
    return `${i + 1}. ${t.symbol} ${t.side.toUpperCase()} → ${r}${pct}${setup}${adh}${emo}${mis}`;
  }).join('\n');
}

function summariseStats(stats?: Record<string, unknown>): string {
  if (!stats) return '(no aggregate stats provided)';
  const pick = (k: string) => stats[k];
  const fmt = (v: unknown) => v == null ? '—' : (typeof v === 'number' ? v.toFixed(2) : String(v));
  return [
    `Total trades: ${fmt(pick('totalTrades'))}`,
    `Win rate: ${fmt(pick('winRate'))}`,
    `Profit factor: ${fmt(pick('profitFactor'))}`,
    `Avg R: ${fmt(pick('avgR'))}`,
    `Max drawdown %: ${fmt(pick('maxDrawdownPct'))}`,
    `Discipline grade: ${pick('disciplineGrade') ?? '—'}`,
    `Current streak: ${pick('currentStreak') ?? '—'}`,
  ].join(' · ');
}

journalCoachRouter.post('/', COACH_LIMIT, async (req, res, next) => {
  try {
    const { message, trades, stats, history } = schema.parse(req.body);
    if (!claudeAvailable()) {
      throw new HttpError(503, 'ANTHROPIC_API_KEY not configured', 'CLAUDE_DISABLED');
    }

    const tradeBlock = summariseTrades(trades ?? []);
    const statsBlock = summariseStats(stats);
    const userMsg = `Journal context (last ${trades?.length ?? 0} trades):\n${tradeBlock}\n\nAggregate: ${statsBlock}\n\nTrader asks: ${message}`;

    // Build messages: prior chat history (if any) + this turn's context
    const messages = [
      ...(history ?? []).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: userMsg },
    ];

    const response = await anthropic!.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      system: [{ type: 'text', text: COACH_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages,
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('\n')
      .trim();

    res.json({ message: text });
  } catch (e) {
    if (e instanceof HttpError) {
      res.status(e.status).json({ error: { code: e.code, message: e.message } });
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    log.warn('Journal coach failed', { err: msg });
    if (msg.toLowerCase().includes('credit balance')) {
      res.status(402).json({ error: { code: 'CLAUDE_NO_CREDITS', message: msg } });
      return;
    }
    if (msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('overloaded')) {
      res.status(503).json({ error: { code: 'CLAUDE_RATE_LIMIT', message: msg } });
      return;
    }
    next(e);
  }
});
