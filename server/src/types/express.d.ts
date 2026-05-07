import type { Plan, PlanStatus } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        plan: Plan;
        planStatus: PlanStatus;
        emailVerified: boolean;
      };
    }
  }
}

export {};
