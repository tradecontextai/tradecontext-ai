import Stripe from 'stripe';
import { env } from '../config/env';
import { prisma } from '../config/db';
import { HttpError } from '../middleware/error';
import { log } from '../lib/logger';
import { sendPaymentConfirmation, sendPaymentFailed } from './email.service';
import type { Plan, PlanStatus } from '@prisma/client';

if (!env.STRIPE_SECRET_KEY) {
  log.warn('STRIPE_SECRET_KEY not set — Stripe routes will return 500');
}

export const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion })
  : null;

// ──────── Price ID mapping ────────
export type PlanTier = Exclude<Plan, 'free'>;
export type Billing = 'monthly' | 'annual';

export function priceIdFor(plan: PlanTier, billing: Billing): string {
  const map: Record<PlanTier, Record<Billing, string | undefined>> = {
    pro: {
      monthly: env.STRIPE_PRO_MONTHLY_PRICE_ID,
      annual: env.STRIPE_PRO_ANNUAL_PRICE_ID,
    },
    elite: {
      monthly: env.STRIPE_ELITE_MONTHLY_PRICE_ID,
      annual: env.STRIPE_ELITE_ANNUAL_PRICE_ID,
    },
  };
  const id = map[plan][billing];
  if (!id) {
    throw new HttpError(
      500,
      `Stripe price ID not configured for ${plan}-${billing}`,
      'STRIPE_PRICE_MISSING',
    );
  }
  return id;
}

/** Find or create a Stripe customer for a user. */
export async function ensureStripeCustomer(userId: string): Promise<string> {
  if (!stripe) throw new HttpError(500, 'Stripe not configured', 'STRIPE_DISABLED');

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, stripeCustomerId: true },
  });
  if (!user) throw new HttpError(404, 'User not found', 'USER_NOT_FOUND');

  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: user.email,
    metadata: { userId: user.id },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: customer.id },
  });
  return customer.id;
}

/** Create a Checkout session for a plan + billing cycle. */
export async function createCheckoutSession(opts: {
  userId: string;
  plan: PlanTier;
  billing: Billing;
}) {
  if (!stripe) throw new HttpError(500, 'Stripe not configured', 'STRIPE_DISABLED');

  const customerId = await ensureStripeCustomer(opts.userId);
  const priceId = priceIdFor(opts.plan, opts.billing);

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${env.CLIENT_URL}/dashboard.html?checkout=success`,
    cancel_url: `${env.CLIENT_URL}/signup.html?checkout=cancelled`,
    allow_promotion_codes: true,
    subscription_data: {
      metadata: { userId: opts.userId, plan: opts.plan, billing: opts.billing },
    },
    metadata: { userId: opts.userId, plan: opts.plan, billing: opts.billing },
  });

  return { url: session.url, id: session.id };
}

/** Create a customer portal session — for the user to manage billing. */
export async function createPortalSession(userId: string) {
  if (!stripe) throw new HttpError(500, 'Stripe not configured', 'STRIPE_DISABLED');
  const customerId = await ensureStripeCustomer(userId);
  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${env.CLIENT_URL}/dashboard.html`,
  });
  return { url: portal.url };
}

// ──────── Webhook event handling ────────
function planFromPriceId(priceId: string): PlanTier | null {
  if (priceId === env.STRIPE_PRO_MONTHLY_PRICE_ID || priceId === env.STRIPE_PRO_ANNUAL_PRICE_ID)
    return 'pro';
  if (priceId === env.STRIPE_ELITE_MONTHLY_PRICE_ID || priceId === env.STRIPE_ELITE_ANNUAL_PRICE_ID)
    return 'elite';
  return null;
}

function statusFromStripe(s: Stripe.Subscription.Status): PlanStatus {
  switch (s) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
      return 'cancelled';
    case 'incomplete':
    case 'incomplete_expired':
      return 'incomplete';
    default:
      return 'active';
  }
}

/**
 * Reflect a subscription's state into our DB.
 * Called by checkout.session.completed AND customer.subscription.updated.
 */
async function syncSubscription(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const user = await prisma.user.findUnique({ where: { stripeCustomerId: customerId } });
  if (!user) {
    log.warn('Webhook for unknown customer', { customerId });
    return;
  }

  const item = sub.items.data[0];
  const priceId = item?.price.id;
  const plan = priceId ? planFromPriceId(priceId) : null;

  const wasFree = user.plan === 'free';
  await prisma.user.update({
    where: { id: user.id },
    data: {
      stripeSubscriptionId: sub.id,
      plan: plan ?? user.plan,
      planStatus: statusFromStripe(sub.status),
    },
  });
  log.info('Subscription synced', { userId: user.id, plan, status: sub.status });

  // Send payment confirmation only when transitioning into a paid plan + active
  if (wasFree && plan && sub.status === 'active') {
    const meta = sub.metadata as { billing?: 'monthly' | 'annual' };
    void sendPaymentConfirmation({
      to: user.email,
      plan,
      billing: meta.billing === 'annual' ? 'annual' : 'monthly',
    });
  }
}

export async function handleStripeEvent(event: Stripe.Event) {
  if (!stripe) throw new HttpError(500, 'Stripe not configured', 'STRIPE_DISABLED');

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.subscription) {
        const sub = await stripe.subscriptions.retrieve(session.subscription as string);
        await syncSubscription(sub);
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      await syncSubscription(sub);
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      const user = await prisma.user.findUnique({ where: { stripeCustomerId: customerId } });
      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: { plan: 'free', planStatus: 'cancelled', stripeSubscriptionId: null },
        });
        log.info('Subscription cancelled', { userId: user.id });
      }
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
      if (!customerId) break;
      const user = await prisma.user.findUnique({ where: { stripeCustomerId: customerId } });
      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: { planStatus: 'past_due' },
        });
        // Build customer portal URL so the user can update their card
        let updateUrl = `${env.CLIENT_URL}/dashboard.html`;
        try {
          const portal = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: `${env.CLIENT_URL}/dashboard.html`,
          });
          updateUrl = portal.url;
        } catch (e) {
          log.warn('Failed to create portal session for failed-payment email', { err: e instanceof Error ? e.message : e });
        }
        void sendPaymentFailed({ to: user.email, updatePaymentUrl: updateUrl });
        log.warn('Payment failed — grace period', { userId: user.id });
      }
      break;
    }
    default:
      log.debug('Unhandled Stripe event', { type: event.type });
  }
}
