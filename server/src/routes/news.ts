import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { requirePlan } from '../middleware/plan';
import { HttpError } from '../middleware/error';
import {
  getBreakingNews,
  getNewsById,
  getRecentNews,
  pollAndScore,
} from '../services/news.service';
import { createPlaybook } from '../services/playbook.service';

export const newsRouter = Router();

// ──────── GET /api/news ────────
// Public read — frontend Dashboard previews news to logged-out users (briefing §4.1).
const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

newsRouter.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { limit } = listSchema.parse(req.query);
    const stories = await getRecentNews(limit);
    res.json({ stories });
  } catch (e) {
    next(e);
  }
});

// ──────── GET /api/news/breaking ────────
newsRouter.get('/breaking', optionalAuth, async (_req, res, next) => {
  try {
    const stories = await getBreakingNews(20);
    res.json({ stories });
  } catch (e) {
    next(e);
  }
});

// ──────── GET /api/news/:id ────────
newsRouter.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const story = await getNewsById(id);
    if (!story) throw new HttpError(404, 'News story not found', 'NOT_FOUND');
    res.json({ story });
  } catch (e) {
    next(e);
  }
});

// ──────── POST /api/news/:id/playbook ────────
// Pro+ only — generate an AI playbook for a specific story.
const playbookBodySchema = z.object({
  symbol: z.string().min(1).max(20),
  currentPrice: z.number().positive().optional(),
});

newsRouter.post(
  '/:id/playbook',
  requireAuth,
  requirePlan('pro'),
  async (req, res, next) => {
    try {
      const { symbol, currentPrice } = playbookBodySchema.parse(req.body);
      const newsId = String(req.params.id);
      const playbook = await createPlaybook({
        userId: req.user!.id,
        symbol,
        newsId,
        currentPrice,
      });
      res.status(201).json({ playbook });
    } catch (e) {
      next(e);
    }
  },
);

// ──────── POST /api/news/refresh ────────
// Manual poll trigger for dev / admin. Auth required to prevent abuse.
newsRouter.post('/refresh', requireAuth, async (_req, res, next) => {
  try {
    const result = await pollAndScore();
    res.json(result);
  } catch (e) {
    next(e);
  }
});
