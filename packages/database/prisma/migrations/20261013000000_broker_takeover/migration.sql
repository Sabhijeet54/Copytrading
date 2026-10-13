-- Broker account takeover, connect/disconnect reasons, master DATA_ONLY mode, client risk settings, latency.

-- New enum + enum values
CREATE TYPE "BrokerAccountMode" AS ENUM ('TRADING', 'DATA_ONLY');
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BROKER_TAKEN_OVER';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BROKER_TOKEN_EXPIRED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'KILL_SWITCH_ACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'AUTO_SQUARE_OFF';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RISK_LIMIT_HIT';

-- User
ALTER TABLE "User" ADD COLUMN "telegramChatId" TEXT;

-- BrokerAccount
ALTER TABLE "BrokerAccount"
  ADD COLUMN "mode" "BrokerAccountMode" NOT NULL DEFAULT 'TRADING',
  ADD COLUMN "disconnectReason" TEXT,
  ADD COLUMN "disconnectedAt" TIMESTAMP(3);

-- Existing master accounts become data-only feed accounts.
UPDATE "BrokerAccount" b SET "mode" = 'DATA_ONLY'
  FROM "User" u WHERE u."id" = b."userId" AND u."role" = 'MASTER';

-- Replace the full unique (broker, brokerClientId) with a PARTIAL unique on CONNECTED rows only,
-- so a takeover (old row -> DISCONNECTED, new row -> CONNECTED) never hits a duplicate-key error.
DROP INDEX IF EXISTS "BrokerAccount_broker_brokerClientId_key";
CREATE INDEX "BrokerAccount_broker_brokerClientId_idx" ON "BrokerAccount"("broker", "brokerClientId");
CREATE UNIQUE INDEX "BrokerAccount_connected_client_key"
  ON "BrokerAccount"("broker", "brokerClientId")
  WHERE "status" = 'CONNECTED' AND "brokerClientId" IS NOT NULL;

-- StrategyFollower risk settings
ALTER TABLE "StrategyFollower"
  ADD COLUMN "fixedLots" INTEGER,
  ADD COLUMN "maxLots" INTEGER,
  ADD COLUMN "maxTradesPerDay" INTEGER,
  ADD COLUMN "allowedSegments" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CopyOrder latency
ALTER TABLE "CopyOrder" ADD COLUMN "latencyMs" INTEGER;
