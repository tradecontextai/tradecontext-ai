import http from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { apiRouter } from './routes';
import { stripeWebhookHandler, stripeWebhookRoute } from './routes/stripe';
import { errorHandler, notFound } from './middleware/error';
import { attachNewsWs } from './ws/news-broadcast';
import { attachAlertWs } from './ws/alert-broadcast';
import { startNewsPoller, stopNewsPoller } from './jobs/news-poller';
import { startAlertMonitor, stopAlertMonitor } from './jobs/alert-monitor';
import { startCron } from './services/cron.service';
import { log } from './lib/logger';

const app = express();

// ──────── Stripe webhook FIRST — needs raw body before json parser ────────
app.post('/api/stripe/webhook', stripeWebhookHandler, stripeWebhookRoute);

// ──────── Standard middleware ────────
app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled — frontend uses CDN scripts
// CLIENT_URL accepts a comma-separated list of allowed origins so the same
// backend can serve staging + prod + a custom domain without redeploys.
const ALLOWED_ORIGINS = env.CLIENT_URL.split(',').map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => {
      // Same-origin / curl / SSR requests have no Origin header — let them through.
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) return cb(null, true);
      // In dev, also accept localhost on any port to make iteration painless.
      if (env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return cb(null, true);
      }
      cb(new Error('CORS: origin not allowed: ' + origin));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ──────── API routes ────────
app.use('/api', apiRouter);

// ──────── Errors ────────
app.use(notFound);
app.use(errorHandler);

// ──────── HTTP server (so we can attach WebSocket) ────────
const server = http.createServer(app);

// WebSocket: ws://host/ws/news (news bias broadcast)
attachNewsWs(server);
// WebSocket: ws://host/ws/alerts?userId=<id> (private alert push)
attachAlertWs(server);

// ──────── Boot ────────
server.listen(env.PORT, () => {
  log.info(`🚀 TradeContext server listening on http://localhost:${env.PORT}`);
  log.info(`   WebSocket: ws://localhost:${env.PORT}/ws/news`);
  log.info(`   CORS allowing: ${env.CLIENT_URL}`);
  log.info(`   Env: ${env.NODE_ENV}`);

  // Start the news poller (skips silently if Finnhub or Claude key missing)
  startNewsPoller();
  // Start the alert monitor (cheap — does nothing when no alerts are active)
  startAlertMonitor();
  // Start the recurring jobs (daily wrap + bias-outcome verifier)
  startCron();
});

// ──────── Graceful shutdown ────────
const shutdown = (signal: string) => {
  log.info(`Received ${signal} — shutting down`);
  stopNewsPoller();
  stopAlertMonitor();
  server.close(() => {
    log.info('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
