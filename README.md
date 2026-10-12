# Copy Trading Platform

A web platform where a **master trader** keeps trading in their own broker app (Zerodha / Angel One) and the platform copies their **actual executions** into **followers'** own broker accounts — within each follower's allocation and risk limits.

```
Master broker → Backend (detect) → Normalize → Copy engine → Follower broker APIs → Copied orders
```

> ⚠️ This software does not claim any regulatory approval. Read [docs/COMPLIANCE.md](docs/COMPLIANCE.md) before any real-money use.

## Status

| Phase | Scope | Status |
|---|---|---|
| **1** | Monorepo, Next.js, NestJS, PostgreSQL/Prisma, Redis, auth, RBAC, admin, basic UI | ✅ **Done** |
| 2 | MockBrokerAdapter, master/follower flows, strategies, paper trading, copy engine | ⏳ Next |
| 3 | BullMQ, worker processors, WebSockets, real-time events, reconciliation | — |
| 4 | Zerodha Kite Connect integration | — |
| 5 | Angel One SmartAPI integration | — |
| 6 | Railway deployment | — |
| 7 | Security hardening, tests, monitoring, production readiness | — |

## Tech stack

- **Web** — Next.js 16 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui components, TanStack Query
- **API** — NestJS 11, REST, class-validator DTOs, global auth + RBAC guards, Redis-backed rate limiting
- **Worker** — persistent Node.js process (never serverless); BullMQ processors arrive in Phase 3
- **Data** — PostgreSQL 16 + Prisma 6 (Rust-free client via `@prisma/adapter-pg`), Redis 7

## Repository layout

```
apps/
  web/        Next.js app — browser only talks to /api/* (proxied to the API)
  api/        NestJS REST API (+ WebSocket gateway in Phase 3)
  worker/     Persistent background worker
packages/
  types/      Frontend-safe shared types, enums, WebSocket event names
  config/     Environment loading + validation (zod) for api/worker
  shared/     Node-only utilities: AES-256-GCM SecretBox, argon2id hashing, log redaction
  database/   Prisma schema, migrations, client factory, seed
docs/         Architecture, API reference, compliance
```

## Local setup

**Prerequisites:** Node.js ≥ 20.11 (22 recommended — see `.nvmrc`), npm 10, Docker Desktop (for Postgres + Redis).

```bash
# 1. Install (also builds the shared packages and generates the Prisma client)
npm install

# 2. Environment
cp .env.example .env
#   then set two secrets in .env:
#   JWT_SECRET=$(openssl rand -base64 48)
#   ENCRYPTION_KEY=$(openssl rand -base64 32)

# 3. Infrastructure
docker compose up -d

# 4. Database
npm run prisma:generate
npm run prisma:migrate        # applies packages/database/prisma/migrations
npm run db:seed               # demo users, paper broker accounts, sample strategy

# 5. Run (two terminals)
npm run dev                   # API on :4000, web on :3000 (+ package watcher)
npm run worker                # persistent worker (heartbeat → /health)
```

Open http://localhost:3000.

> No Docker? Install `postgresql@16` and `redis` with Homebrew, create the `ctp` user/database from `docker-compose.yml`, and keep the same `DATABASE_URL` / `REDIS_URL`.

You can also run Prisma directly from the repo root, e.g. `npx prisma migrate dev` or `npx prisma studio` (configured by `prisma.config.ts`).

### Seed users (development only)

| Role | Email | Password |
|---|---|---|
| Admin | `admin@example.com` | `Admin@12345` |
| Master | `master@example.com` | `Master@12345` |
| Follower A | `follower@example.com` | `Follower@12345` |
| Follower B | `follower2@example.com` | `Follower@12345` |

Override with `SEED_ADMIN_PASSWORD` / `SEED_MASTER_PASSWORD` / `SEED_FOLLOWER_PASSWORD`. The seed refuses to run when `APP_ENV=production`.

The seed also creates **paper (MOCK) broker accounts** for the master and both followers, the **NIFTY Intraday Strategy** (₹10,00,000 master capital) and both followers' subscriptions (₹1,00,000 @ 20% and ₹5,00,000 @ 50%) — with **copy trading OFF**, because it must always be started explicitly.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API (watch) + web (dev) + shared-package watcher |
| `npm run worker` | Worker in watch mode |
| `npm run build` | Build packages, API, worker and web |
| `npm run typecheck` | Type-check every workspace |
| `npm test` | API unit tests (no DB needed) |
| `npm run test:e2e` | API integration tests against your local Postgres + Redis |
| `npm run prisma:migrate` / `prisma:deploy` / `prisma:studio` | Prisma workflows |
| `npm run db:seed` / `db:reset` | Seed / drop-recreate-migrate-seed the dev database |

## What Phase 1 delivers

**Authentication** — register, login, logout, `GET /auth/me`, refresh-token rotation with reuse detection, argon2id password hashing, email-verification flow (SMTP or dev log), httpOnly SameSite cookies (tokens never reach JavaScript), CSRF header check, Redis-backed rate limiting (stricter on auth routes), timing-safe login.

**Authorization** — global `AuthGuard` (every route is private unless `@Public()`), session-revocation checks on every request, `RolesGuard` with `@Roles('ADMIN')`. Disabling a user or changing a password takes effect immediately.

**Admin** — dashboard metrics, users (filters, detail, disable/re-enable), broker accounts (disconnect), strategies (pause, followers, stop a follower's copying), master trades, copy orders, positions, audit logs, system events, system health, and a **platform-wide copy-trading kill switch**.

**Data model** — the complete schema for all phases: `User`, `Session`, `EmailVerificationToken`, `BrokerAccount`, `BrokerCredential` (encrypted), `Instrument`, `Strategy`, `StrategyFollower`, `MasterTrade`, `CopyOrder`, `Order`, `Position`, `Transaction`, `Notification`, `AuditLog`, `SystemEvent`. Duplicate prevention is enforced by unique constraints, including `CopyOrder(masterTradeId, followerUserId)` and `MasterTrade(brokerAccountId, brokerOrderId)`.

**Worker** — persistent process with validated config, DB/Redis connections, Redis heartbeat (reported by `/health`) and graceful shutdown.

**Web** — landing, login, register, email verification, dashboard (trading account + profile), settings (profile, password), full admin console. Responsive down to phone width.

See [docs/API.md](docs/API.md) for every endpoint and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design decisions.

## Known limitations (Phase 1)

- No broker connect flow, strategy management or copy engine yet (Phases 2–5). Admin trade/order/position screens are wired to the real tables and will populate once those exist.
- Email delivery requires SMTP settings; without them, development mode writes verification links to the API log.
# Copytrading
