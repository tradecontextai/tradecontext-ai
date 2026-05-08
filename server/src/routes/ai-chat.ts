/**
 * AI chat per chart — POST /api/ai/chat
 *
 * The user can ask anything about the active symbol ("why is gold dumping?",
 * "what's the next FOMC?") and Claude answers using:
 *  - Live price + change% (via getPrice)
 *  - Last 8 news stories tagged with this symbol (via prisma.newsStory)
 *  - The user's profile (style, account size) when signed in
 *  - The chat history for this symbol (last 10 messages)
 *
 * Compliance: prompt is hard-pinned to "explain market context, never give
 * personal financial advice or trade instructions." Each response ends with
 * a disclaimer line which the frontend renders as a footer.
 */
import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import { anthropic, claudeAvailable } from '../services/claude.service';
import { prisma } from '../config/db';
import { getPrice } from '../services/price.service';
import { log } from '../lib/logger';

export const aiChatRouter = Router();

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `You are TradeContext.ai, an AI trading desk analyst answering live questions for retail traders inside a dashboard sidebar. Style:

- Concise, direct, plain-English answers (max 180 words).
- Always reason from the live context provided: current price, latest news, macro flow.
- When you reference a news story, name the headline.
- Never give "buy this / sell this at price X" trade instructions — you explain WHY the market is moving, not what to do.
- Never claim certainty. "It looks like X because Y" is fine; "X is going to happen" is not.
- If the user asks for a personal recommendation, say: "I can't tell you what to trade — your circumstances are unique. Here's the context I'd weigh." Then continue.
- If you don't have enough context, say so. Don't hallucinate news.
- End every answer with a single italicised line: *Educational analysis only — not personal financial advice.*

Format: plain text, no markdown headings, occasional **bold** is fine, occasional emoji 📈 is fine. No code blocks.`;

const chatSchema = z.object({
  symbol: z.string().min(1).max(40),
  message: z.string().min(1).max(2000),
});

aiChatRouter.post('/chat', optionalAuth, async (req, res, next) => {
  try {
    if (!claudeAvailable() || !anthropic) {
      throw new HttpError(503, 'Claude not configured', 'CLAUDE_DISABLED');
    }
    const { symbol, message } = chatSchema.parse(req.body);
    const userId = (req as any).user?.id ?? null;
    const sym = symbol.toUpperCase();

    // ──── Build context block ────
    let priceLine = '';
    try {
      const tick = await getPrice(symbol);
      if (tick.price > 0 && tick.source !== 'unsupported') {
        const dec = tick.price >= 10000 ? 0 : tick.price >= 100 ? 2 : 5;
        priceLine = `Current ${sym}: ${tick.price.toFixed(dec)} (${tick.changePercent >= 0 ? '+' : ''}${tick.changePercent.toFixed(2)}% on session, source: ${tick.source})`;
      }
    } catch { /* swallow */ }

    const since = new Date(Date.now() - 36 * 60 * 60 * 1000);
    const news = await prisma.newsStory.findMany({
      where: { publishedAt: { gte: since }, affectedAssets: { has: sym } },
      orderBy: [{ isBreaking: 'desc' }, { publishedAt: 'desc' }],
      take: 8,
      select: { id: true, headline: true, bias: true, impact: true, isBreaking: true, reasoning: true, publishedAt: true },
    });
    const newsLines = news.map((n, i) => {
      const ageH = Math.round((Date.now() - n.publishedAt.getTime()) / 3_600_000);
      const tag = n.isBreaking ? '⚡ BREAKING' : n.impact === 'high' ? '🔴 HIGH' : '·';
      return `  ${i + 1}. ${tag} [${n.bias}] "${n.headline.slice(0, 130)}" (${ageH}h ago)${n.reasoning ? ' — ' + n.reasoning.slice(0, 120) : ''}`;
    });

    let profileLine = '';
    if (userId) {
      const profile = await prisma.userProfile.findUnique({ where: { userId } });
      if (profile) {
        profileLine = `User profile: style=${profile.style ?? '?'}, account=$${profile.accountSize ?? '?'}, risk=${profile.riskPctPerTrade ?? '?'}%, propFirm=${profile.propFirm ?? 'no'}`;
      }
    }

    // Last few turns scoped to this symbol so the conversation feels continuous
    const history = userId
      ? await prisma.aiChatMessage.findMany({
          where: { userId, symbol: sym },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { role: true, content: true },
        })
      : [];
    history.reverse();

    const contextBlock = [
      `Symbol: ${sym}`,
      priceLine,
      profileLine,
      '',
      `Recent news (last 36h, ${news.length} stories tagged ${sym}):`,
      newsLines.length ? newsLines.join('\n') : '  (no recent news for this asset)',
    ].filter(Boolean).join('\n');

    // ──── Call Claude ────
    const userMessage = `Live context:\n${contextBlock}\n\nUser asks: ${message}`;
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [
        ...history.map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
        { role: 'user', content: userMessage },
      ],
    });

    const block = response.content.find((b) => b.type === 'text');
    const text = block && block.type === 'text' ? block.text.trim() : '';
    if (!text) throw new HttpError(500, 'Empty response from Claude', 'CLAUDE_EMPTY');

    // Persist both turns when the user is signed in (anonymous chats are
    // ephemeral — no point bloating the table).
    if (userId) {
      await prisma.aiChatMessage.createMany({
        data: [
          { userId, symbol: sym, role: 'user', content: message, ctxNewsIds: news.map((n) => n.id) },
          { userId, symbol: sym, role: 'assistant', content: text, ctxNewsIds: [] },
        ],
      });
    }

    res.json({
      symbol: sym,
      message: text,
      contextNews: news.map((n) => ({ id: n.id, headline: n.headline, bias: n.bias, impact: n.impact })),
      grounded: news.length > 0 || !!priceLine,
    });
  } catch (e) {
    log.warn('ai chat error', { err: (e as Error)?.message });
    next(e);
  }
});

aiChatRouter.get('/chat/history', optionalAuth, async (req, res, next) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.json({ messages: [] });
      return;
    }
    const symbol = String(req.query.symbol || '').toUpperCase();
    if (!symbol) {
      res.json({ messages: [] });
      return;
    }
    const messages = await prisma.aiChatMessage.findMany({
      where: { userId, symbol },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: { id: true, role: true, content: true, createdAt: true },
    });
    res.json({ messages });
  } catch (e) {
    next(e);
  }
});
