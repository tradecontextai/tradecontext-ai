/**
 * Daily AI market wrap generator.
 *
 * Called by:
 *  - cron at 06:00 UTC every weekday (services/cron.service.ts)
 *  - POST /api/blog/generate when an admin clicks "publish now"
 *
 * Inputs the AI sees:
 *  - Previous calendar day's news (top 30 by impact)
 *  - Today's economic calendar (next 24h)
 *  - Last 5 risk/macro snapshots (price + change %)
 *
 * Output: a BlogPost row with kind='market-wrap', SEO-tuned slug, and
 * cross-linked symbol tags so /blog filters can route by asset.
 */
import { z } from 'zod';
import { prisma } from '../config/db';
import { anthropic, claudeAvailable } from './claude.service';
import { getPrice } from './price.service';
import { log } from '../lib/logger';

const MODEL = 'claude-sonnet-4-6';

const SYSTEM = `You are a senior trading desk analyst writing the day-ahead market wrap for TradeContext.ai. Output a single JSON object with these fields:

{
  "title": "<headline, max 70 chars, include date>",
  "description": "<one paragraph hook, 30-50 words, no fluff>",
  "body": "<Markdown body, 600-900 words. Sections: ## Overnight movers / ## Key data today / ## What we're watching. Use plain English. Cite specific symbols with % moves where you have them. End with: \\"_Educational analysis only — not personal financial advice._\\"",
  "symbols": ["EUR/USD", "XAU/USD", ...],   // 3-8 symbols mentioned in body
  "tags": ["macro", "fomc", ...]            // 2-4 short tags
}

Rules:
- Honest about uncertainty. No ramp predictions.
- Tight, specific, present-tense.
- No "in this article…" preamble.
- Return ONLY the JSON. No markdown fences, no commentary before/after.`;

const BlogSchema = z.object({
  title: z.string().min(8).max(140),
  description: z.string().min(20).max(500),
  body: z.string().min(200).max(8000),
  symbols: z.array(z.string()).min(0).max(20),
  tags: z.array(z.string()).min(0).max(10),
});

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export async function generateMarketWrap() {
  if (!claudeAvailable() || !anthropic) {
    throw new Error('Claude not configured');
  }

  // News context — top 30 by impact in the last 24h
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const news = await prisma.newsStory.findMany({
    where: { publishedAt: { gte: since } },
    orderBy: [{ isBreaking: 'desc' }, { impact: 'desc' }, { publishedAt: 'desc' }],
    take: 30,
    select: { headline: true, bias: true, impact: true, isBreaking: true, reasoning: true, affectedAssets: true, publishedAt: true },
  });

  // Quick price snapshot of the bellwether basket
  const bellwether = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'XAU/USD', 'BTC/USD', 'SPX', 'WTI Oil'];
  const prices: Array<{ symbol: string; price: number; pct: number }> = [];
  for (const s of bellwether) {
    try {
      const t = await getPrice(s);
      if (t.price > 0 && t.source !== 'unsupported') prices.push({ symbol: s, price: t.price, pct: t.changePercent });
    } catch { /* swallow */ }
  }

  const newsBlock = news
    .map((n, i) => `  ${i + 1}. ${n.isBreaking ? '⚡ BREAKING' : '·'} [${n.bias}/${n.impact}] ${n.headline.slice(0, 130)}`)
    .join('\n');
  const priceBlock = prices.map((p) => `  ${p.symbol}: ${p.price.toFixed(p.price >= 100 ? 2 : 5)} (${p.pct >= 0 ? '+' : ''}${p.pct.toFixed(2)}%)`).join('\n');

  const today = new Date();
  const ymd = today.toISOString().slice(0, 10);
  const userMsg = `Date: ${today.toUTCString()}\n\nBellwether prices (last close vs prev close):\n${priceBlock}\n\nNews (last 24h, top 30):\n${newsBlock}\n\nWrite the market wrap.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMsg }],
  });
  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('No text from Claude');
  let raw = block.text.trim();
  // Defensive — strip code fences if Claude ignored the rule
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const parsed = BlogSchema.parse(JSON.parse(raw));

  const slug = `market-wrap-${ymd}-${slugify(parsed.title).slice(0, 40)}`;
  const post = await prisma.blogPost.upsert({
    where: { slug },
    update: { title: parsed.title, description: parsed.description, body: parsed.body, symbols: parsed.symbols, tags: parsed.tags, kind: 'market-wrap', published: true },
    create: { slug, title: parsed.title, description: parsed.description, body: parsed.body, symbols: parsed.symbols.map((s) => s.toUpperCase()), tags: parsed.tags, kind: 'market-wrap' },
  });
  log.info('Blog wrap generated', { slug, title: parsed.title });
  return post;
}
