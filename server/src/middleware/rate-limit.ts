/**
 * Lightweight per-IP token-bucket rate limiter.
 *
 * Why we hand-roll instead of pulling in `express-rate-limit`:
 *   • Zero new dependency, zero attack surface.
 *   • Per-route granularity with one-line wiring.
 *   • Token-bucket (allows burst then steady drip) suits trading workflows
 *     better than fixed-window (which would 429 a fast-paste of 5 questions).
 *
 * Limits below are calibrated for a single-process server. If you scale
 * horizontally swap the in-memory map for Redis (`ioredis-zadd-decr`).
 */
import type { Request, Response, NextFunction } from 'express';

interface Bucket {
  tokens: number;
  last: number;
}

interface LimiterOpts {
  /** Tokens (= requests) added per second */
  ratePerSec: number;
  /** Max tokens the bucket can hold (= max burst) */
  burst: number;
  /** Optional override for the bucket key — defaults to client IP */
  key?: (req: Request) => string;
}

export function rateLimit(opts: LimiterOpts) {
  const buckets = new Map<string, Bucket>();
  const defaultKey = (req: Request) =>
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';

  // Periodic GC so the map doesn't grow unbounded with one-off IPs.
  setInterval(
    () => {
      const cutoff = Date.now() - 10 * 60_000;
      for (const [k, b] of buckets) {
        if (b.last < cutoff) buckets.delete(k);
      }
    },
    5 * 60_000,
  );

  return (req: Request, res: Response, next: NextFunction) => {
    const key = (opts.key || defaultKey)(req);
    const now = Date.now();
    let b = buckets.get(key);
    if (!b) {
      b = { tokens: opts.burst, last: now };
      buckets.set(key, b);
    } else {
      const elapsed = (now - b.last) / 1000;
      b.tokens = Math.min(opts.burst, b.tokens + elapsed * opts.ratePerSec);
      b.last = now;
    }
    if (b.tokens < 1) {
      const wait = Math.ceil((1 - b.tokens) / opts.ratePerSec);
      res.setHeader('Retry-After', String(wait));
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: `Too many requests — try again in ${wait}s.` },
      });
      return;
    }
    b.tokens -= 1;
    next();
  };
}
