/**
 * AI mistake auto-tagger for the trade journal.
 *
 * Run on demand from POST /api/journal/analyze. Reads the user's recent
 * trades, hands them to Claude, and stores back a structured "leak report"
 * highlighting the pattern of mistakes ("you exit winners early", "you
 * average down on losers", etc.).
 *
 * Also tags each individual trade with one or more "mistake" labels so the
 * journal UI can show inline reds/greens.
 */
import { z } from 'zod';
import { prisma } from '../config/db';
import { anthropic, claudeAvailable } from './claude.service';

const MODEL = 'claude-sonnet-4-6';

const SYSTEM = `You are an elite trading psychology coach embedded in a journal. You receive a trader's recent closed trades (entry, exit, R-multiple, setup type, notes). Output a single JSON object:

{
  "headline": "<one-sentence diagnosis, 12-22 words, plain English>",
  "leaks": [
    { "name": "<short label, e.g. 'Cuts winners early'>", "severity": "low|medium|high",
      "evidence": "<one sentence pointing to specific trades>", "fix": "<one specific habit change>" }
  ],
  "perTradeTags": { "<tradeId>": ["<short tag>", ...] }
}

Rules:
- Up to 5 leaks. Be specific, not generic ("trades too much" is generic; "scalps EUR/USD during NY lunch and loses 60%" is good).
- Severity: high = >40% of trades affected, medium = 20-40%, low = <20%.
- perTradeTags is a map; tags are 1-3 word labels like "early exit", "fomo entry", "no SL", "revenge trade".
- Be honest. If the trader is doing well, headline = "Edge looks solid — here's where to sharpen it."
- JSON ONLY, no markdown fences.`;

const ResultSchema = z.object({
  headline: z.string().min(8).max(220),
  leaks: z.array(z.object({
    name: z.string().min(2).max(80),
    severity: z.enum(['low', 'medium', 'high']),
    evidence: z.string().max(280),
    fix: z.string().max(280),
  })).max(8),
  perTradeTags: z.record(z.array(z.string().max(40)).max(5)),
});

export async function analyzeTradesForUser(userId: string) {
  if (!claudeAvailable() || !anthropic) throw new Error('Claude not configured');

  const trades = await prisma.trade.findMany({
    where: { userId, closedAt: { not: null } },
    orderBy: { closedAt: 'desc' },
    take: 60,
    select: { id: true, symbol: true, direction: true, size: true, entryPrice: true, exitPrice: true, pnl: true, pnlR: true, setupType: true, notes: true, openedAt: true, closedAt: true },
  });
  if (trades.length < 3) {
    return { headline: 'Not enough trades yet — log at least 3 closed trades and rerun.', leaks: [], perTradeTags: {} };
  }

  const lines = trades.map((t) => {
    const dur = t.openedAt && t.closedAt ? Math.round((t.closedAt.getTime() - t.openedAt.getTime()) / 60000) : null;
    return `${t.id} | ${t.symbol} ${t.direction} ${t.size} | entry ${t.entryPrice} → exit ${t.exitPrice ?? '?'} | pnl ${t.pnl ?? '?'} (${t.pnlR ?? '?'}R) | setup ${t.setupType ?? '?'} | ${dur ?? '?'}min | notes: ${(t.notes ?? '').slice(0, 80)}`;
  });

  const userMsg = `Last ${trades.length} closed trades:\n\n${lines.join('\n')}\n\nProduce the JSON leak report.`;
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMsg }],
  });
  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('No text from Claude');
  let raw = block.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const parsed = ResultSchema.parse(JSON.parse(raw));
  return parsed;
}
