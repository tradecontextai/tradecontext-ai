import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requirePlan } from '../middleware/plan';
import { HttpError } from '../middleware/error';
import {
  createPlaybook,
  getPlaybookById,
  getPlaybooksForUser,
} from '../services/playbook.service';

export const playbooksRouter = Router();

// ──────── GET /api/playbooks ────────
playbooksRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const playbooks = await getPlaybooksForUser(req.user!.id);
    res.json({ playbooks });
  } catch (e) {
    next(e);
  }
});

// ──────── GET /api/playbooks/:id ────────
playbooksRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const pb = await getPlaybookById(id);
    if (!pb) throw new HttpError(404, 'Playbook not found', 'NOT_FOUND');
    // Only allow user to read their own or system-generated (userId null)
    if (pb.userId && pb.userId !== req.user!.id) {
      throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
    }
    res.json({ playbook: pb });
  } catch (e) {
    next(e);
  }
});

// ──────── POST /api/playbook ────────
// Pro+ only — generate ad-hoc playbook (no specific news story).
const generateSchema = z.object({
  symbol: z.string().min(1).max(20),
  newsContext: z.string().min(1).max(2000).optional(),
  currentPrice: z.number().positive().optional(),
});

playbooksRouter.post('/', requireAuth, requirePlan('pro'), async (req, res, next) => {
  try {
    const body = generateSchema.parse(req.body);
    const playbook = await createPlaybook({
      userId: req.user!.id,
      symbol: body.symbol,
      newsContext: body.newsContext,
      currentPrice: body.currentPrice,
    });
    res.status(201).json({ playbook });
  } catch (e) {
    next(e);
  }
});
