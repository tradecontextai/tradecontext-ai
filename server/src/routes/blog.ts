/**
 * Daily AI market wrap — Claude generates a fresh post each weekday at 06:00
 * UTC (kicked off by services/blog-generator.service.ts cron). This file only
 * exposes the public read API used by blog.html and blog-post.html.
 *
 * The cron is intentionally separate so the API stays cheap (DB read only).
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db';
import { generateMarketWrap } from '../services/blog-generator.service';
import { requireAuth } from '../middleware/auth';

export const blogRouter = Router();

const listSchema = z.object({
  kind: z.enum(['market-wrap', 'analysis', 'education']).optional(),
  symbol: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

// GET /api/blog/posts — list posts (newest first), optional kind/symbol filter
blogRouter.get('/posts', async (req, res, next) => {
  try {
    const { kind, symbol, limit } = listSchema.parse(req.query);
    const where: any = { published: true };
    if (kind) where.kind = kind;
    if (symbol) where.symbols = { has: symbol.toUpperCase() };
    const posts = await prisma.blogPost.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      take: limit,
      select: { id: true, slug: true, title: true, description: true, tags: true, symbols: true, kind: true, publishedAt: true },
    });
    res.json({ posts });
  } catch (e) {
    next(e);
  }
});

// GET /api/blog/post/:slug — single post body
blogRouter.get('/post/:slug', async (req, res, next) => {
  try {
    const slug = String(req.params.slug);
    const post = await prisma.blogPost.findUnique({ where: { slug } });
    if (!post || !post.published) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Post not found' } });
      return;
    }
    res.json({ post });
  } catch (e) {
    next(e);
  }
});

// POST /api/blog/generate — admin trigger to manually run the wrap (also wired
// to a cron job at 06:00 UTC daily). Auth-gated so randos can't burn credits.
blogRouter.post('/generate', requireAuth, async (_req, res, next) => {
  try {
    const post = await generateMarketWrap();
    res.json({ ok: true, post });
  } catch (e) {
    next(e);
  }
});
