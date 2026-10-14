-- Phase 2 copy reliability: mirrored SL/target orders, exit flag, trigger price on copy orders.
ALTER TABLE "CopyOrder"
  ADD COLUMN "mirrored" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isExit" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "triggerPrice" DECIMAL(18,4);
