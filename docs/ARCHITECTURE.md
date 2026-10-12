# Architecture

```
            Browser
               │  HTTPS (same origin)
      ┌────────▼─────────┐
      │  Next.js (web)   │  /api/* rewrite → API (server-side; API URL never exposed)
      └────────┬─────────┘
               │
      ┌────────▼─────────┐        ┌────────────┐
      │  NestJS (api)    ├───────►│ PostgreSQL │
      │  REST (+WS P3)   │        └─────▲──────┘
      └────────┬─────────┘              │
               │ Redis (rate limits, kill switch, heartbeat; BullMQ from P3)
      ┌────────▼─────────┐              │
      │      Redis       │◄─────┐       │
      └──────────────────┘      │       │
                         ┌──────┴───────┴─┐
                         │ Worker (persistent) │──► Broker APIs (P4/P5)
                         └─────────────────┘
```

## Principles carried through every phase

1. **The trigger is a master execution, never a price tick.** Market data (Kite Ticker / SmartAPI WebSocket) is a separate `MarketDataAdapter` used for valuation only.
2. **Broker-specific code is isolated** under `apps/api/src/brokers/{mock,zerodha,angel-one}` (and the worker equivalents) behind a single `BrokerAdapter` interface. The copy engine only sees `NormalizedTrade`.
3. **Idempotency at the database.** `MasterTrade @@unique([brokerAccountId, brokerOrderId])` and `CopyOrder @@unique([masterTradeId, followerUserId])` (+ `idempotencyKey`) make duplicate follower orders impossible even under retries, restarts or replayed events.
4. **Never assume submission = execution.** Copy orders move `PENDING → SUBMITTED → OPEN/PARTIALLY_FILLED → FILLED` only on broker-confirmed state; `UNKNOWN` triggers reconciliation, never a blind retry.
5. **Fail safe.** `PAPER_MODE=true` by default; a Redis kill switch (`ctp:copy:halted`) halts all copying; copying never starts automatically.
6. **No long-running work in the API or in serverless functions.** Order processing runs in the persistent worker via BullMQ (Phase 3).

## Auth design

- **Access token**: HS256 JWT (`iss=ctp-api`, `aud=ctp-web`, 15 min) carrying `sub`, `sid` (session id) and `role`, in httpOnly cookie `ctp_at`.
- **Refresh token**: 48 random bytes, only its SHA-256 is stored (`Session.tokenHash`). Rotation is atomic (`updateMany … where revokedAt is null`), so a token can be consumed once. Sessions form a `familyId`; replaying a rotated token after a 30 s grace window revokes the family and is audited as `REFRESH_TOKEN_REUSE_DETECTED`.
- **Every request** checks the session row (not revoked, not expired) and that the user is `ACTIVE` — logout, password change and admin disable take effect immediately rather than when the JWT expires.
- **Cookies** are `HttpOnly`, `SameSite=Lax`, `Secure` outside development (enforced by config validation). Because the browser reaches the API through the Next.js origin, cookies are first-party.
- **CSRF**: SameSite plus a required `X-CTP-Client` header on cookie-bearing mutations.
- **Passwords**: argon2id (19 MiB, t=2, p=1). Login runs a dummy verification for unknown emails to equalise timing.
- **Rate limiting**: `@nestjs/throttler` with a Redis Lua storage, so limits hold across API replicas.

## Secrets

- Broker tokens are stored only in `BrokerCredential` as AES-256-GCM ciphertext (`SecretBox`, key id prefix for rotation, the broker account id bound as additional authenticated data).
- `ENCRYPTION_KEY`, `JWT_SECRET` and broker API secrets exist only in API/worker environment variables. The web service needs only `API_INTERNAL_URL`.
- Logs record method + path only (no query strings — broker callbacks carry one-time request tokens), never bodies or headers. Audit metadata is redacted by key name.
- The seed refuses to run in production; `.env` is git-ignored.

## Database

PostgreSQL via Prisma 6 using the Rust-free client (`engineType = "client"` + `@prisma/adapter-pg`): no native query-engine binary is needed at runtime, which keeps Railway images small and identical across macOS/Linux. Money and prices are `Decimal`, never float.

## Worker

A long-lived Node process (its own Railway service). Phase 1: config validation, DB + Redis connections, heartbeat (`ctp:worker:heartbeat`, TTL 3× interval) consumed by `/health`, graceful SIGTERM shutdown. Phases 2–3 add `copy-engine/`, `order-worker/`, `reconciliation/`, `broker-events/` and `jobs/`.
