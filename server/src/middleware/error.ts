import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { log } from '../lib/logger';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

/**
 * Centralised error handler. Always returns a JSON envelope:
 *   { error: { message, code? } }
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        issues: err.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
    });
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: { message: err.message, code: err.code },
    });
  }

  log.error('Unhandled error', {
    path: req.path,
    method: req.method,
    err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
  });

  return res.status(500).json({
    error: { message: 'Internal server error', code: 'INTERNAL' },
  });
}

/** 404 fallthrough — must be registered after all routes. */
export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: { message: 'Not found', code: 'NOT_FOUND' } });
}
