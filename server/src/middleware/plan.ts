import type { Request, Response, NextFunction } from 'express';
import type { Plan } from '@prisma/client';
import { HttpError } from './error';

const RANK: Record<Plan, number> = { free: 0, pro: 1, elite: 2 };

/**
 * Gate a route by plan tier.
 *   requirePlan('pro')   — Pro or Elite
 *   requirePlan('elite') — Elite only
 *
 * Must be used AFTER requireAuth.
 */
export function requirePlan(min: Exclude<Plan, 'free'>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Not authenticated'));

    const userRank = RANK[req.user.plan];
    const minRank = RANK[min];
    if (userRank < minRank) {
      return next(
        new HttpError(
          403,
          `${min === 'elite' ? 'Elite' : 'Pro'} plan required`,
          'PLAN_REQUIRED',
        ),
      );
    }
    if (req.user.planStatus !== 'active' && req.user.planStatus !== 'trialing') {
      return next(
        new HttpError(403, 'Subscription is not active', 'PLAN_INACTIVE'),
      );
    }
    next();
  };
}
