# TradeContext.ai

> The world's most powerful AI-driven trading intelligence platform.

**Live news bias scoring · AI trade playbooks · multi-broker hub · funded-account tracking · economic calendar · macro pulse — all in one terminal-grade dashboard.**

---

## What it is

TradeContext.ai is a premium retail trading dashboard that turns breaking financial news into actionable trade ideas in real time. Every headline that hits the wires is scored by Claude Sonnet 4.6 within seconds — bias (bull / bear / neutral), impact (high / medium / low), and a list of affected markets with predicted % moves. Click any market to load it on the chart instantly.

The platform combines:

- **Live news bias intelligence** — Finnhub feed → Claude scoring → WebSocket push
- **AI trade playbooks** — bull and bear cases generated per story with entry / TP / SL / R:R
- **TradingView chart** — 10 toggleable indicators + custom theme/palette settings panel + autosave
- **Real-time prices** — Binance for crypto, Yahoo for FX/commodities/indices, all via a backend proxy
- **Macro Pulse** — currency strength meter, risk-on/off thermometer, AI mood heatmap, animated world map with session-aware heat sensors
- **Economic Calendar** — live Finnhub data with today/week toggle + impact filter
- **Broker Hub** (read-only) — OANDA, Binance, MT4/5, IBKR
- **Funded Account Tracker** — FTMO, The5%ers, TopStep, MyForexFunds
- **AI Trading Journal** — TradeContext Score (0-100) computed by Claude from your trade history

---

## Project structure

```
.
├── dashboard.html              ← The main dashboard (full-width, premium)
├── index.html                  ← Landing page
├── TradeContext-AI/            ← Other site pages (broker, journal, markets, news-bias, signup, ToS, etc.)
├── server/                     ← Node 20 + Express + TypeScript + Prisma backend
│   ├── prisma/schema.prisma    ← 10-table Postgres schema (users, news, playbooks, trades, ...)
│   └── src/
│       ├── config/             ← env validation (zod), Prisma client
│       ├── routes/             ← /auth /stripe /news /playbooks /calendar /price /health
│       ├── services/           ← Claude · Finnhub · price (Binance/Yahoo) · stripe · auth · calendar
│       ├── jobs/news-poller.ts ← 60-second news scoring loop
│       ├── ws/                 ← /ws/news WebSocket fan-out
│       └── lib/                ← jwt · crypto (AES-256-GCM) · logger
└── .claude/
    └── skills/
        └── ui-animations/      ← Emil Kowalski's animation principles, packaged as a Claude Code skill
```

---

## Tech stack

| Layer | Stack |
|---|---|
| **Frontend** | Static HTML/CSS/JS (no framework). DM Mono + Outfit fonts. TradingView widget. |
| **Backend** | Node 20 · Express 4 · TypeScript · tsx watch dev |
| **Database** | PostgreSQL via Supabase, Prisma 6 ORM |
| **Auth** | bcrypt + JWT in httpOnly cookies, password reset, plan gating |
| **Payments** | Stripe — 4 plans (Pro/Elite × Monthly/Annual), webhook signature verified |
| **AI** | Anthropic Claude Sonnet 4.6 — news scoring, playbooks, trader score |
| **News** | Finnhub `/news` (4 categories, 60s poll, deduped) |
| **Prices** | Binance public API (crypto) + Yahoo Finance (FX/commodities/indices) |
| **Calendar** | Finnhub `/calendar/economic` (cached 1 hour, refreshed every 10 min) |
| **Real-time** | `ws` package, WebSocket at `/ws/news` with heartbeat |
| **Hosting (planned)** | Vercel (frontend) + Railway (backend + Prisma) |

---

## Local development

### Prerequisites

- Node 20+
- A Supabase project (free tier works)
- Anthropic API key with credits
- Finnhub API key (free)

### Setup

```bash
# 1. Clone
git clone https://github.com/tradecontextai/tradecontext-ai.git
cd tradecontext-ai

# 2. Install backend deps
cd server
npm install

# 3. Configure env
cp .env.example .env
# fill in:
#  DATABASE_URL    (Supabase Session pooler URI)
#  JWT_SECRET      (generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
#  ENCRYPTION_KEY  (generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
#  ANTHROPIC_API_KEY
#  FINNHUB_API_KEY

# 4. Push schema to DB
npm run db:push

# 5. Start backend (auto-reload)
npm run dev          # → http://localhost:3000

# 6. In another terminal, serve the frontend
cd ..
python3 -m http.server 8765   # → http://localhost:8765/dashboard.html
```

Open `http://localhost:8765/dashboard.html` and the news poller will start scoring real headlines within 60 seconds.

---

## API

All endpoints documented in `server/README.md`. Key ones:

| Method | Route | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/health` | — | Liveness check |
| `POST` | `/api/auth/signup` | — | bcrypt + JWT cookie |
| `POST` | `/api/auth/login` | — | |
| `GET` | `/api/news?limit=50` | optional | Last N scored stories |
| `GET` | `/api/news/breaking` | optional | Breaking + high impact only |
| `POST` | `/api/news/:id/playbook` | Pro+ | Generate playbook from story |
| `GET` | `/api/calendar?impact=high` | — | Finnhub economic events |
| `GET` | `/api/price/:symbol` | — | Real prices via Binance/Yahoo |
| `WS` | `/ws/news` | open | Real-time push of new scored stories |

---

## Claude Code skills

This repo ships with a custom skill at `.claude/skills/ui-animations/` that captures Emil Kowalski's "good vs great animations" principles. Future Claude Code sessions in this repo can invoke `/ui-animations` to apply origin-aware transforms, easing curves, spring physics, and right-property selection automatically.

---

## Roadmap

- [x] Phase 1 — Auth + Stripe scaffold
- [x] Phase 2 — Live news bias feed + AI playbooks + WebSocket push
- [x] Phase 3 — Frontend wiring (dashboard, calendar, prices, macro pulse, world map)
- [ ] Phase 4 — Trading Journal endpoints + TradeContext Score routes
- [ ] Phase 5 — Broker connections (OANDA REST, Binance, MT5 EA bridge, IBKR)
- [ ] Phase 6 — Stripe products live + email notifications via Resend
- [ ] Phase 7 — Watchlist + price alerts (Finnhub WebSocket)
- [ ] Launch — May 13, 2026

---

## License

Private. All rights reserved.

For inquiries: hello@tradecontext.ai
