# Compliance — read before real-money use

This software is a technical platform. It **does not claim, and must not be presented as having, any regulatory approval**. Nothing in it is investment advice.

Before any production deployment that places real orders, the operating business must independently verify — with qualified legal/compliance advisers — at least the following:

- [ ] **SEBI** requirements applicable to the business model (e.g. whether copying a master's trades constitutes investment advice, research analysis or portfolio management, and any registration that follows).
- [ ] **SEBI / exchange rules for algorithmic and API-based trading by retail investors**, including any order-tagging, strategy registration, broker-side approval and static-IP requirements in force at the time of launch.
- [ ] **Broker requirements and API terms** — Zerodha Kite Connect and Angel One SmartAPI developer/partner agreements, permitted use of an app on behalf of multiple end users, rate limits, and whether a platform may place orders on a user's account.
- [ ] **Exchange requirements** (NSE/BSE/MCX) for the instruments offered.
- [ ] **Copy-trading / social-trading specific rules**, including disclosures of master performance and conflicts of interest.
- [ ] **KYC / AML** obligations for platform users and masters.
- [ ] **Data privacy** — the Digital Personal Data Protection Act, 2023 and any rules under it: consent, purpose limitation, retention, breach notification, data residency for personal and financial data.
- [ ] **Partner / API agreements** with brokers and any data vendors.
- [ ] **Consumer protection, risk disclosures and terms of service**, including clear disclosure that trading involves risk of loss.
- [ ] **Record-keeping and audit** obligations (the `AuditLog`, `Order`, `CopyOrder` and `MasterTrade` tables are designed to support this; retention periods must be set accordingly).
- [ ] **Credential handling** — the platform must use broker-authorised login flows only. It must not collect broker passwords, PINs or TOTP secrets unless explicitly required and contractually/legally permitted.

## Hooks for compliance features

The architecture leaves room for compliance requirements to be added without rewriting the engine:

- Per-strategy and per-follower limits already exist in the schema (`Strategy.maxOrderValue`, `StrategyFollower.maxDailyLoss`, …); additional pre-trade checks can be added to the copy-safety validation chain (Phase 2).
- A platform-wide kill switch exists (`/admin/copy-trading/halt`).
- Every security-relevant and trading action is written to an append-only audit log with secrets redacted.
- Paper trading (`PAPER_MODE=true`) is the default and must be validated before enabling live trading.
