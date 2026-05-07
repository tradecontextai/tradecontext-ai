# TradeContext.ai — Backend

Node.js + Express + TypeScript + Prisma + PostgreSQL + Stripe + Claude.

## Local setup

```bash
# 1. Install deps
npm install

# 2. Copy env template and fill in keys
cp .env.example .env
# (edit .env — fill DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY at minimum)

# 3. Push the Prisma schema to your database
npm run db:push

# 4. Run dev server (auto-reloads on changes)
npm run dev
```

Server boots on `http://localhost:3000`.

## Generating secrets

```bash
# JWT_SECRET (64 bytes hex)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# ENCRYPTION_KEY (32 bytes hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Folder structure

```
src/
├── config/        # env validation, db client
├── middleware/    # auth (JWT), error handler, plan gating
├── routes/        # auth, stripe, news, journal, broker, etc.
├── services/      # business logic (auth, stripe, claude, finnhub)
├── lib/           # jwt helpers, AES crypto, logger
└── index.ts       # Express entry point
prisma/
└── schema.prisma  # full DB schema (10 tables)
```

## Routes implemented (Phase 1)

```
POST   /api/auth/signup           Create account, send verify email
POST   /api/auth/login            Email + password → JWT cookie
POST   /api/auth/logout           Clear cookie
GET    /api/auth/me               Current user (auth required)

POST   /api/stripe/checkout       Create Stripe Checkout session
POST   /api/stripe/webhook        Stripe webhook (raw body)
GET    /api/stripe/portal         Customer portal link (auth required)

GET    /api/health                Healthcheck
```

## Plan gating

`requirePlan('pro' | 'elite')` middleware blocks endpoints from users below that tier.
Elite features: AI Trading Journal, Funded Account Tracker.
