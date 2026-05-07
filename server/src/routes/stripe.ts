import express, { Router } from 'express';
import { z } from 'zod';
import type Stripe from 'stripe';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import {
  createCheckoutSession,
  createPortalSession,
  handleStripeEvent,
  stripe,
} from '../services/stripe.service';
import { log } from '../lib/logger';

export const stripeRouter = Router();

// ──────── POST /api/stripe/checkout ────────
const checkoutSchema = z.object({
  plan: z.enum(['pro', 'elite']),
  billing: z.enum(['monthly', 'annual']),
});

stripeRouter.post('/checkout', requireAuth, async (req, res, next) => {
  try {
    const { plan, billing } = checkoutSchema.parse(req.body);
    const session = await createCheckoutSession({
      userId: req.user!.id,
      plan,
      billing,
    });
    res.json(session);
  } catch (e) {
    next(e);
  }
});

// ──────── GET /api/stripe/portal ────────
stripeRouter.get('/portal', requireAuth, async (req, res, next) => {
  try {
    const portal = await createPortalSession(req.user!.id);
    res.json(portal);
  } catch (e) {
    next(e);
  }
});

/**
 * ──────── POST /api/stripe/webhook ────────
 * Mounted with raw body in index.ts so Stripe signature can be verified.
 */
export const stripeWebhookHandler = express.raw({ type: 'application/json' });

export async function stripeWebhookRoute(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  try {
    if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
      throw new HttpError(500, 'Stripe webhook not configured', 'STRIPE_DISABLED');
    }
    const sig = req.headers['stripe-signature'];
    if (!sig) throw new HttpError(400, 'Missing stripe-signature', 'MISSING_SIGNATURE');

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      log.error('Stripe signature verification failed', {
        err: err instanceof Error ? err.message : err,
      });
      res.status(400).send('Webhook Error: invalid signature');
      return;
    }

    await handleStripeEvent(event);
    res.json({ received: true });
  } catch (e) {
    next(e);
  }
}
