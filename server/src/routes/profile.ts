/**
 * User profile (set by the onboarding wizard) — drives personalised Claude
 * prompts (style, account size, prop-firm stage) and the leaderboard filters.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db';
import { requireAuth } from '../middleware/auth';

export const profileRouter = Router();

const profileSchema = z.object({
  experience: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  style: z.enum(['scalper', 'day-trader', 'swing', 'position']).optional(),
  accountSize: z.number().min(0).max(10_000_000).optional(),
  riskPctPerTrade: z.number().min(0).max(10).optional(),
  primaryAssets: z.array(z.string().min(1).max(40)).max(20).optional(),
  sessions: z.array(z.enum(['sydney', 'tokyo', 'london', 'ny'])).max(4).optional(),
  goals: z.enum(['pass-prop-firm', 'income', 'wealth', 'learn']).optional(),
  propFirm: z.enum(['ftmo', 'topstep', 'the5ers', 'mff', 'fundednext', 'true-forex-funds', 'other']).nullable().optional(),
});

profileRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const profile = await prisma.userProfile.findUnique({ where: { userId } });
    res.json({ profile });
  } catch (e) {
    next(e);
  }
});

profileRouter.put('/', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const data = profileSchema.parse(req.body);
    const updated = await prisma.userProfile.upsert({
      where: { userId },
      create: { userId, ...data, completedAt: new Date() },
      update: { ...data, completedAt: new Date() },
    });
    res.json({ profile: updated });
  } catch (e) {
    next(e);
  }
});
