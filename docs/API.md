# API reference (Phase 1)

Base URL: `http://localhost:4000` in development. The web app calls the same routes through its own origin as `/api/*` (Next.js rewrite), so browsers never talk to the API origin directly.

## Conventions

- **Auth**: httpOnly cookies `ctp_at` (access JWT, 15 min) and `ctp_rt` (opaque refresh token, 14 days, rotated on every refresh). Tokens are never returned in response bodies.
- **CSRF**: any non-GET request that carries auth cookies must send `X-CTP-Client: web`.
- **Validation**: unknown body/query fields → `400`. Errors always look like:
  ```json
  { "statusCode": 400, "error": "Bad Request", "message": ["..."], "requestId": "..." }
  ```
- **Money/prices** are decimal strings (e.g. `"100000.00"`). Timestamps are ISO-8601 UTC.
- **Pagination**: `?page=1&pageSize=25` (max 100) → `{ items, total, page, pageSize }`.
- **Rate limits**: 120 req/min per IP by default; auth routes are stricter (see below). `429` when exceeded.

## Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | public | `{"status":"ok"\|"degraded","database","redis","worker"}`. `503` if DB or Redis is down; a missing worker heartbeat is `degraded` (still `200`). |

## Auth

| Method | Path | Auth | Limit | Description |
|---|---|---|---|---|
| POST | `/auth/register` | public | 10/min | Body `{ email, password, name, mobile?, role: "MASTER"\|"FOLLOWER" }`. Password: 10–128 chars with a letter and a digit. Returns `{ user, accessTokenExpiresAt }` and sets cookies — or `{ user, verificationRequired: true }` when `REQUIRE_EMAIL_VERIFICATION=true`. `409` if the email exists. |
| POST | `/auth/login` | public | 10/min | Body `{ email, password }`. `401` (same message for unknown email or wrong password), `403` if disabled / unverified. |
| POST | `/auth/refresh` | refresh cookie | 30/min | Rotates the refresh token. Replaying an already-rotated token (after a 30 s concurrency grace window) revokes the whole session family. |
| POST | `/auth/logout` | public | — | Revokes the session family of the presented refresh cookie and clears cookies. `204`. |
| GET | `/auth/me` | user | — | Current user. |
| POST | `/auth/verify-email` | public | 10/min | Body `{ token }` from the emailed link. |
| POST | `/auth/resend-verification` | public | 3/min | Body `{ email }`. Always `202` (no account enumeration). |

`user` shape: `{ id, email, name, mobile, role, status, emailVerified, createdAt }`.

## Users (self-service)

| Method | Path | Auth | Description |
|---|---|---|---|
| PATCH | `/users/me` | user | Body `{ name?, mobile? }` (`mobile: ""` clears it). |
| POST | `/users/me/password` | user (5/min) | Body `{ currentPassword, newPassword }`. Signs out all **other** sessions. `204`. |

## Brokers

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/brokers/accounts` | user | The caller's broker accounts — status, client id, token status/expiry. Never credentials. |

| GET | `/brokers/available` | user | Which brokers are configured on the server. |
| GET | `/brokers/zerodha/connect` | user | Returns `{ loginUrl }` (Kite login, carries a one-time `state`, 10 min TTL). |
| GET | `/brokers/zerodha/callback` | public | Kite redirect target. Exchanges `request_token`, stores encrypted token, redirects to `/dashboard?broker=zerodha&result=connected|error`. Token expires ~06:00 IST. |
| POST | `/brokers/angel-one/login` | user | Body `{ clientCode, pin, totp }`. SmartAPI loginByPassword; PIN/TOTP never stored. 5/min. Session expires at midnight IST. |
| GET | `/brokers/angel-one/connect` | user | Publisher-login `{ loginUrl }` (only when `ANGEL_REDIRECT_URL` is set). |
| GET | `/brokers/angel-one/callback` | public | Publisher-login redirect target (`auth_token`, `feed_token`, `refresh_token`, `state`). |
| POST | `/brokers/accounts/:id/disconnect` | user | Logs out at the broker (best effort), deletes credentials, sets `DISCONNECTED`. |

Broker HTTP calls can be routed through a static-IP proxy via `ZERODHA_PROXY_URL` / `ANGEL_PROXY_URL`.

## Admin (role `ADMIN` only — others get `403`)

| Method | Path | Description |
|---|---|---|
| GET | `/admin/dashboard` | Totals: users, connected accounts, active masters/followers/strategies, today's (IST) master trades, filled and failed copy orders, `paperMode`. |
| GET | `/admin/users` | Filters: `search` (name/email/mobile), `role`, `status`, `broker`. |
| GET | `/admin/users/:id` | Profile, broker accounts (no secrets), follows, strategies. |
| PATCH | `/admin/users/:id/status` | Body `{ status: "ACTIVE"\|"DISABLED", reason? }` (reason required to disable). Disabling revokes all sessions, turns copy trading OFF for all the user's subscriptions and pauses their ACTIVE strategies. Re-enabling never restarts copying. Admins cannot change their own status. |
| GET | `/admin/broker-accounts` | Filters: `broker`, `status`, `userId`. |
| POST | `/admin/broker-accounts/:id/disconnect` | Body `{ reason }`. Deletes encrypted credentials, sets `DISCONNECTED`, stops copy subscriptions using that account. |
| GET | `/admin/strategies` | Filters: `status`, `masterUserId`, `search`. Includes total and active follower counts. |
| GET | `/admin/strategies/:id/followers` | Subscriptions of a strategy. |
| POST | `/admin/strategies/:id/pause` | Body `{ reason }`. ACTIVE → PAUSED. |
| POST | `/admin/strategy-followers/:id/stop` | Body `{ reason }`. Copy status → OFF. |
| GET | `/admin/copy-trading/status` | `{ halted, halt? }` |
| POST | `/admin/copy-trading/halt` | Body `{ reason }`. Platform-wide kill switch (Redis `ctp:copy:halted`); the copy engine must check it before creating or submitting any order. |
| POST | `/admin/copy-trading/resume` | Body `{ reason }`. |
| GET | `/admin/master-trades` | Filters: `broker`, `userId`, `strategyId`, `status`, `symbol`, `from`, `to`. |
| GET | `/admin/copy-orders` | Filters: `broker`, `userId`, `strategyId`, `masterTradeId`, `status`, `from`, `to`. |
| GET | `/admin/positions` | Filters: `userId`, `broker`, `scope=open\|all` (default open). |
| GET | `/admin/audit-logs` | Filters: `action`, `userId`, `from`, `to`. |
| GET | `/admin/system-events` | Filter: `severity`. |
| GET | `/admin/system-health` | Health + API uptime/version/env/paper mode, worker heartbeat, copy-halt state, recent system events. Queue and broker-stream stats are populated from Phase 3. |

All admin mutations write an `AuditLog` row in the same database transaction as the change.

## Audit actions

`USER_REGISTERED, USER_LOGIN, USER_LOGIN_FAILED, USER_LOGOUT, EMAIL_VERIFIED, PASSWORD_CHANGED, PROFILE_UPDATED, REFRESH_TOKEN_REUSE_DETECTED, BROKER_CONNECTED, BROKER_DISCONNECTED, STRATEGY_CREATED, STRATEGY_UPDATED, STRATEGY_STARTED, STRATEGY_STOPPED, COPY_STARTED, COPY_STOPPED, MASTER_TRADE_DETECTED, COPY_ORDER_CREATED, COPY_ORDER_SUBMITTED, COPY_ORDER_FILLED, COPY_ORDER_FAILED, ADMIN_DISABLED_USER, ADMIN_ENABLED_USER, ADMIN_STOPPED_COPY, ADMIN_RESUMED_COPY, ADMIN_DISCONNECTED_BROKER`

Audit metadata passes through `redact()` (passwords, secrets, access/refresh/request tokens, TOTP, PINs, API keys, cookies are replaced with `[REDACTED]`).

## WebSocket events (names reserved; gateway ships in Phase 3)

`master.trade.detected`, `copy.order.created`, `copy.order.submitted`, `copy.order.filled`, `copy.order.failed`, `broker.connected`, `broker.disconnected`, `broker.token.expiring`, `position.updated`, `pnl.updated`, `notification.created` — defined in `packages/types/src/events.ts`.

## Master desk (role MASTER)

| Method | Path | Notes |
|---|---|---|
| GET | `/master/strategies` | Own strategies with follower / copying counts. |
| POST | `/master/strategies` | Create. Body: name, description, riskLevel, allowedExchanges[], allowedInstruments[] (`NIFTY*` wildcards), masterCapital, maxFollowers, maxOrderValue, maxQuantityPerOrder. |
| PATCH | `/master/strategies/:id` | Update (same body). |
| POST | `/master/strategies/:id/status` | `{ status: ACTIVE \| PAUSED \| ARCHIVED }`. Activating re-baselines order-book polling. |
| GET | `/master/strategies/:id/followers` | Clients, allocation, broker status, paper P&L. |
| GET | `/master/clients/:userId/live` | Live broker data of a client following one of your strategies. |
| POST | `/master/orders` | Place a trade on the master account (or simulate in paper mode) and copy it to all followers with copying ON. |
| GET | `/master/trades`, `/master/trades/:id` | Master trades with per-client copy results. |
| GET | `/master/live` | Funds, positions, holdings, today's orders from the master's brokers. |
| GET | `/master/ltp?exchange=&symbol=` | Last price (Angel One; Kite Personal has no quotes). |

Trades the master places directly in Kite / Angel One are detected by polling the order book every `COPY_POLL_INTERVAL_MS` and copied when the master has exactly one ACTIVE strategy.

## Client (role FOLLOWER)

| Method | Path | Notes |
|---|---|---|
| GET | `/follow/strategies` | Active strategies + my subscription. |
| POST | `/follow/strategies/:id` | Follow / update allocation: brokerAccountId, allocationMode (CAPITAL_PERCENTAGE \| PROPORTIONAL \| FIXED_QUANTITY), allocationPercent / allocationAmount / fixedQuantity, maxQuantity, maxTradeValue. |
| POST | `/follow/subscriptions/:id/start` \| `/stop` | Start / stop copying. Start requires a connected broker. |
| GET | `/follow/portfolio` | Live broker positions/holdings/orders, paper positions, copied trades. |
