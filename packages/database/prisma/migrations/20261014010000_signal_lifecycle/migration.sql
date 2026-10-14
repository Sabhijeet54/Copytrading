-- Signal lifecycle: per-signal target / stop loss, exit tracking and P&L.
ALTER TABLE "MasterTrade"
  ADD COLUMN "signalStatus" TEXT,
  ADD COLUMN "targetPrice" DECIMAL(18,4),
  ADD COLUMN "stopLossPrice" DECIMAL(18,4),
  ADD COLUMN "closedQuantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "exitPrice" DECIMAL(18,4),
  ADD COLUMN "exitedAt" TIMESTAMP(3),
  ADD COLUMN "exitReason" TEXT,
  ADD COLUMN "realizedPnl" DECIMAL(18,4);

CREATE INDEX "MasterTrade_signalStatus_idx" ON "MasterTrade"("signalStatus");
