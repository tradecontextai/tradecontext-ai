import * as dotenv from 'dotenv';
import { z } from 'zod';

// override:true so .env values win over inherited shell env (e.g. parent
// processes that set ANTHROPIC_API_KEY="" would otherwise blank our key).
dotenv.config({ override: true });

/**
 * Validate environment variables on boot. Crashes with a readable error
 * if anything required is missing.
 *
 * Empty-string env vars (e.g. unset Stripe keys in dev) are normalised to
 * undefined before validation, so optional vars don't trip startsWith().
 */
const optionalString = (prefix?: string) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    prefix ? z.string().startsWith(prefix).optional() : z.string().optional(),
  );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  CLIENT_URL: z.string().url().default('http://localhost:8765'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  ENCRYPTION_KEY: z
    .string()
    .min(64, 'ENCRYPTION_KEY must be 32 bytes hex (64 chars)')
    .max(64, 'ENCRYPTION_KEY must be 32 bytes hex (64 chars)'),

  DATABASE_URL: z.string().url(),

  STRIPE_SECRET_KEY: optionalString('sk_'),
  STRIPE_WEBHOOK_SECRET: optionalString('whsec_'),
  STRIPE_PRO_MONTHLY_PRICE_ID: optionalString('price_'),
  STRIPE_PRO_ANNUAL_PRICE_ID: optionalString('price_'),
  STRIPE_ELITE_MONTHLY_PRICE_ID: optionalString('price_'),
  STRIPE_ELITE_ANNUAL_PRICE_ID: optionalString('price_'),

  ANTHROPIC_API_KEY: optionalString(),
  FINNHUB_API_KEY: optionalString(),
  RESEND_API_KEY: optionalString(),
  FROM_EMAIL: z.string().email().default('hello@tradecontext.ai'),
  OANDA_API_URL: z.string().url().default('https://api-fxtrade.oanda.com'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('\n❌ Invalid environment variables:\n');
  for (const issue of parsed.error.issues) {
    console.error(`  • ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\nCopy .env.example → .env and fill in the required values.\n');
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
