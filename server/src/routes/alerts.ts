import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { createAlert, deleteAlert, listAlerts, resetAlert } from '../services/alert.service';

export const alertsRouter = Router();

alertsRouter.use(requireAuth);

// ──────── GET /api/alerts?activeOnly=true ────────
alertsRouter.get('/', async (req, res, next) => {
  try {
    const activeOnly = z.coerce.boolean().default(false).parse(req.query.activeOnly);
    const alerts = await listAlerts(req.user!.id, { activeOnly });
    res.json({ alerts });
  } catch (e) {
    next(e);
  }
});

// ──────── POST /api/alerts ────────
const createSchema = z.object({
  symbol: z.string().min(1).max(20),
  condition: z.enum(['above', 'below']),
  price: z.number().positive(),
});

alertsRouter.post('/', async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const alert = await createAlert(req.user!.id, body);
    res.status(201).json({ alert });
  } catch (e) {
    next(e);
  }
});

// ──────── DELETE /api/alerts/:id ────────
alertsRouter.delete('/:id', async (req, res, next) => {
  try {
    await deleteAlert(req.user!.id, String(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ──────── POST /api/alerts/:id/reset ────────
alertsRouter.post('/:id/reset', async (req, res, next) => {
  try {
    const alert = await resetAlert(req.user!.id, String(req.params.id));
    res.json({ alert });
  } catch (e) {
    next(e);
  }
});
