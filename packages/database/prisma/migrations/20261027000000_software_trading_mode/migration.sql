-- Software-level Paper / Live trading mode per user (independent of any broker connection).
ALTER TABLE "User" ADD COLUMN "tradingMode" TEXT NOT NULL DEFAULT 'PAPER';

-- Keep today's behaviour: a client whose real trading account is on Live stays on Live.
UPDATE "User" u SET "tradingMode" = 'LIVE'
WHERE u."demo" = false
  AND EXISTS (
    SELECT 1 FROM "BrokerAccount" b
    WHERE b."userId" = u."id" AND b."mode" = 'TRADING' AND b."broker" <> 'MOCK' AND b."isPaper" = false
  );
