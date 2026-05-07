import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/db';
import { verifyToken, cookieName } from '../lib/jwt';
import { HttpError } from './error';

/**
 * Authenticate request — populates req.user from JWT cookie.
 * Throws 401 if no valid session.
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const token = req.cookies?.[cookieName];
    if (!token) throw new HttpError(401, 'Not authenticated', 'NOT_AUTHENTICATED');

    const payload = verifyToken(token);
    if (!payload) throw new HttpError(401, 'Invalid session', 'INVALID_SESSION');

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        plan: true,
        planStatus: true,
        emailVerified: true,
      },
    });

    if (!user) throw new HttpError(401, 'User not found', 'USER_NOT_FOUND');

    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Soft auth — populates req.user if cookie is present, but doesn't fail.
 * Use for endpoints that have a free preview + paywall.
 */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const token = req.cookies?.[cookieName];
  if (!token) return next();

  const payload = verifyToken(token);
  if (!payload) return next();

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      email: true,
      plan: true,
      planStatus: true,
      emailVerified: true,
    },
  });
  if (user) req.user = user;
  next();
}
