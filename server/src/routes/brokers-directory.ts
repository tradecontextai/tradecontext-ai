import { Router } from 'express';
import { z } from 'zod';
import { BROKER_DIRECTORY, filterByAssetClass } from '../services/broker-directory.service';
import { getBrokerOutboundUrl, getDirectoryWithAffiliateUrls, affiliateCoverage } from '../services/affiliate.service';
import { prisma } from '../config/db';
import { optionalAuth } from '../middleware/auth';
import { log } from '../lib/logger';

export const brokersDirectoryRouter = Router();

// ──────── GET /api/brokers/directory ────────
// Public — lists all regulated brokers for the "Open in Broker" dropdown.
// Each broker now carries an `outboundUrl` that includes our affiliate ref
// (when configured via env vars — see services/affiliate.service.ts).
const querySchema = z.object({
  symbol: z.string().min(1).max(40).optional(),
});

brokersDirectoryRouter.get('/directory', (req, res, next) => {
  try {
    const { symbol } = querySchema.parse(req.query);
    const baseList = symbol ? filterByAssetClass(symbol) : BROKER_DIRECTORY;
    // Decorate every broker with its outbound (affiliate-aware) URL so the
    // frontend opens the tracked link without needing affiliate codes itself.
    const brokers = baseList.map((b) => {
      const out = getBrokerOutboundUrl(b);
      return { ...b, outboundUrl: out.url, affiliated: out.affiliated };
    });
    res.json({
      brokers,
      count: brokers.length,
      symbol: symbol ? symbol.toUpperCase() : null,
    });
  } catch (e) {
    next(e);
  }
});

// ──────── POST /api/brokers/click ────────
// Logs an outbound click + returns the affiliate-aware redirect URL. The
// dashboard calls this when the user picks a broker from the dropdown or
// hits the MT4/MT5 launcher. The redirect happens client-side so we keep
// the dashboard SPA-feel.
const clickSchema = z.object({
  brokerId: z.string().min(1).max(40),
  symbol: z.string().min(1).max(40).optional(),
  surface: z.enum(['dropdown', 'mt-launcher', 'prop-page', 'inline-cta', 'unknown']).default('unknown'),
});

brokersDirectoryRouter.post('/click', optionalAuth, async (req, res, next) => {
  try {
    const { brokerId, symbol, surface } = clickSchema.parse(req.body);
    const broker = BROKER_DIRECTORY.find((b) => b.id === brokerId);
    // Even if it's not in our directory (mt4/mt5/web-terminal launcher) we
    // still log the click — affiliate URL just won't be available.
    const out = broker ? getBrokerOutboundUrl(broker) : { url: '', affiliated: false, ref: null };

    const userId = (req as any).user?.id ?? null;
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null;
    const userAgent = req.headers['user-agent']?.slice(0, 280) ?? null;

    // Fire-and-forget — don't block the redirect on DB latency
    prisma.brokerClick
      .create({
        data: { brokerId, userId: userId || null, symbol: symbol || null, surface, affiliateRef: out.ref || null, ip, userAgent },
      })
      .catch((err) => log.warn('broker click insert failed', { err: err?.message }));

    res.json({
      ok: true,
      url: out.url || (broker?.url ?? null),
      affiliated: out.affiliated,
    });
  } catch (e) {
    next(e);
  }
});

// ──────── GET /api/brokers/affiliate-coverage ────────
// Admin-ish (public for now) diagnostic — shows which brokers still need an
// IB code added to env. Lets you see at a glance how much revenue is being
// left on the table.
brokersDirectoryRouter.get('/affiliate-coverage', (_req, res) => {
  res.json(affiliateCoverage());
});
