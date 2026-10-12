-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MASTER', 'FOLLOWER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "BrokerName" AS ENUM ('ZERODHA', 'ANGEL_ONE', 'MOCK');

-- CreateEnum
CREATE TYPE "BrokerAccountStatus" AS ENUM ('PENDING', 'CONNECTED', 'EXPIRED', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "StrategyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AllocationMode" AS ENUM ('FIXED_QUANTITY', 'CAPITAL_PERCENTAGE', 'PROPORTIONAL');

-- CreateEnum
CREATE TYPE "CopyStatus" AS ENUM ('OFF', 'ON', 'PAUSED');

-- CreateEnum
CREATE TYPE "Exchange" AS ENUM ('NSE', 'BSE', 'NFO', 'BFO', 'MCX', 'CDS', 'BCD');

-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('MARKET', 'LIMIT', 'SL', 'SL_M');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('DELIVERY', 'INTRADAY', 'CARRY_FORWARD');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'SUBMITTED', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('MASTER', 'COPY', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('REALIZED_PNL', 'CHARGES', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "SystemEventSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('USER_REGISTERED', 'USER_LOGIN', 'USER_LOGIN_FAILED', 'USER_LOGOUT', 'EMAIL_VERIFIED', 'PASSWORD_CHANGED', 'PROFILE_UPDATED', 'REFRESH_TOKEN_REUSE_DETECTED', 'BROKER_CONNECTED', 'BROKER_DISCONNECTED', 'STRATEGY_CREATED', 'STRATEGY_UPDATED', 'STRATEGY_STARTED', 'STRATEGY_STOPPED', 'COPY_STARTED', 'COPY_STOPPED', 'MASTER_TRADE_DETECTED', 'COPY_ORDER_CREATED', 'COPY_ORDER_SUBMITTED', 'COPY_ORDER_FILLED', 'COPY_ORDER_FAILED', 'ADMIN_DISABLED_USER', 'ADMIN_ENABLED_USER', 'ADMIN_STOPPED_COPY', 'ADMIN_RESUMED_COPY', 'ADMIN_DISCONNECTED_BROKER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT,
    "role" "Role" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "emailVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "disabledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrokerAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "broker" "BrokerName" NOT NULL,
    "brokerClientId" TEXT,
    "status" "BrokerAccountStatus" NOT NULL DEFAULT 'PENDING',
    "isPaper" BOOLEAN NOT NULL DEFAULT false,
    "tokenExpiresAt" TIMESTAMP(3),
    "lastConnectedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrokerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrokerCredential" (
    "id" TEXT NOT NULL,
    "brokerAccountId" TEXT NOT NULL,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT,
    "encryptedExtra" TEXT,
    "keyId" TEXT NOT NULL DEFAULT 'k1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrokerCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instrument" (
    "id" TEXT NOT NULL,
    "exchange" "Exchange" NOT NULL,
    "tradingSymbol" TEXT NOT NULL,
    "name" TEXT,
    "segment" TEXT,
    "instrumentType" TEXT,
    "lotSize" INTEGER NOT NULL DEFAULT 1,
    "tickSize" DECIMAL(18,4) NOT NULL DEFAULT 0.05,
    "expiry" TIMESTAMP(3),
    "strike" DECIMAL(18,4),
    "zerodhaToken" TEXT,
    "angelToken" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Instrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Strategy" (
    "id" TEXT NOT NULL,
    "masterUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "status" "StrategyStatus" NOT NULL DEFAULT 'DRAFT',
    "allowedExchanges" "Exchange"[],
    "allowedInstruments" TEXT[],
    "maxFollowers" INTEGER,
    "masterCapital" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "maxOrderValue" DECIMAL(18,2),
    "maxQuantityPerOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Strategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyFollower" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "followerUserId" TEXT NOT NULL,
    "brokerAccountId" TEXT,
    "allocationMode" "AllocationMode" NOT NULL DEFAULT 'CAPITAL_PERCENTAGE',
    "allocationAmount" DECIMAL(18,2),
    "allocationPercent" DECIMAL(5,2),
    "fixedQuantity" INTEGER,
    "riskLevel" "RiskLevel",
    "maxTradeValue" DECIMAL(18,2),
    "maxDailyLoss" DECIMAL(18,2),
    "maxQuantity" INTEGER,
    "maxOpenPositions" INTEGER,
    "copyStatus" "CopyStatus" NOT NULL DEFAULT 'OFF',
    "startedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "stoppedReason" TEXT,
    "stoppedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategyFollower_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MasterTrade" (
    "id" TEXT NOT NULL,
    "masterUserId" TEXT NOT NULL,
    "strategyId" TEXT,
    "brokerAccountId" TEXT NOT NULL,
    "broker" "BrokerName" NOT NULL,
    "brokerOrderId" TEXT NOT NULL,
    "exchange" "Exchange" NOT NULL,
    "symbol" TEXT NOT NULL,
    "instrumentToken" TEXT,
    "side" "OrderSide" NOT NULL,
    "orderType" "OrderType" NOT NULL,
    "productType" "ProductType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "filledQuantity" INTEGER NOT NULL DEFAULT 0,
    "price" DECIMAL(18,4),
    "averagePrice" DECIMAL(18,4),
    "status" "OrderStatus" NOT NULL,
    "eventTimestamp" TIMESTAMP(3) NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasterTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopyOrder" (
    "id" TEXT NOT NULL,
    "masterTradeId" TEXT NOT NULL,
    "strategyFollowerId" TEXT NOT NULL,
    "followerUserId" TEXT NOT NULL,
    "brokerAccountId" TEXT NOT NULL,
    "broker" "BrokerName" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "exchange" "Exchange" NOT NULL,
    "symbol" TEXT NOT NULL,
    "instrumentToken" TEXT,
    "side" "OrderSide" NOT NULL,
    "orderType" "OrderType" NOT NULL,
    "productType" "ProductType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "filledQuantity" INTEGER NOT NULL DEFAULT 0,
    "price" DECIMAL(18,4),
    "averagePrice" DECIMAL(18,4),
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "brokerOrderId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "filledAt" TIMESTAMP(3),
    "isPaper" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CopyOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brokerAccountId" TEXT NOT NULL,
    "broker" "BrokerName" NOT NULL,
    "brokerOrderId" TEXT NOT NULL,
    "source" "OrderSource" NOT NULL,
    "exchange" "Exchange" NOT NULL,
    "symbol" TEXT NOT NULL,
    "instrumentToken" TEXT,
    "side" "OrderSide" NOT NULL,
    "orderType" "OrderType" NOT NULL,
    "productType" "ProductType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "filledQuantity" INTEGER NOT NULL DEFAULT 0,
    "pendingQuantity" INTEGER NOT NULL DEFAULT 0,
    "price" DECIMAL(18,4),
    "triggerPrice" DECIMAL(18,4),
    "averagePrice" DECIMAL(18,4),
    "status" "OrderStatus" NOT NULL,
    "statusMessage" TEXT,
    "brokerTimestamp" TIMESTAMP(3),
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brokerAccountId" TEXT NOT NULL,
    "exchange" "Exchange" NOT NULL,
    "symbol" TEXT NOT NULL,
    "instrumentToken" TEXT,
    "productType" "ProductType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "averagePrice" DECIMAL(18,4) NOT NULL,
    "lastPrice" DECIMAL(18,4),
    "realizedPnl" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unrealizedPnl" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "isPaper" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brokerAccountId" TEXT,
    "copyOrderId" TEXT,
    "type" "TransactionType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "description" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" "AuditAction" NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemEvent" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "SystemEventSeverity" NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "context" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_familyId_idx" ON "Session"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- CreateIndex
CREATE INDEX "BrokerAccount_status_idx" ON "BrokerAccount"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BrokerAccount_userId_broker_key" ON "BrokerAccount"("userId", "broker");

-- CreateIndex
CREATE UNIQUE INDEX "BrokerAccount_broker_brokerClientId_key" ON "BrokerAccount"("broker", "brokerClientId");

-- CreateIndex
CREATE UNIQUE INDEX "BrokerCredential_brokerAccountId_key" ON "BrokerCredential"("brokerAccountId");

-- CreateIndex
CREATE INDEX "Instrument_zerodhaToken_idx" ON "Instrument"("zerodhaToken");

-- CreateIndex
CREATE INDEX "Instrument_angelToken_idx" ON "Instrument"("angelToken");

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_exchange_tradingSymbol_key" ON "Instrument"("exchange", "tradingSymbol");

-- CreateIndex
CREATE INDEX "Strategy_masterUserId_idx" ON "Strategy"("masterUserId");

-- CreateIndex
CREATE INDEX "Strategy_status_idx" ON "Strategy"("status");

-- CreateIndex
CREATE INDEX "StrategyFollower_followerUserId_idx" ON "StrategyFollower"("followerUserId");

-- CreateIndex
CREATE INDEX "StrategyFollower_copyStatus_idx" ON "StrategyFollower"("copyStatus");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyFollower_strategyId_followerUserId_key" ON "StrategyFollower"("strategyId", "followerUserId");

-- CreateIndex
CREATE INDEX "MasterTrade_masterUserId_createdAt_idx" ON "MasterTrade"("masterUserId", "createdAt");

-- CreateIndex
CREATE INDEX "MasterTrade_strategyId_idx" ON "MasterTrade"("strategyId");

-- CreateIndex
CREATE INDEX "MasterTrade_createdAt_idx" ON "MasterTrade"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MasterTrade_brokerAccountId_brokerOrderId_key" ON "MasterTrade"("brokerAccountId", "brokerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "CopyOrder_idempotencyKey_key" ON "CopyOrder"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CopyOrder_status_idx" ON "CopyOrder"("status");

-- CreateIndex
CREATE INDEX "CopyOrder_followerUserId_createdAt_idx" ON "CopyOrder"("followerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "CopyOrder_createdAt_idx" ON "CopyOrder"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CopyOrder_masterTradeId_followerUserId_key" ON "CopyOrder"("masterTradeId", "followerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "CopyOrder_brokerAccountId_brokerOrderId_key" ON "CopyOrder"("brokerAccountId", "brokerOrderId");

-- CreateIndex
CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Order_brokerAccountId_brokerOrderId_key" ON "Order"("brokerAccountId", "brokerOrderId");

-- CreateIndex
CREATE INDEX "Position_userId_idx" ON "Position"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Position_brokerAccountId_exchange_symbol_productType_key" ON "Position"("brokerAccountId", "exchange", "symbol", "productType");

-- CreateIndex
CREATE INDEX "Transaction_userId_occurredAt_idx" ON "Transaction"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "SystemEvent_severity_createdAt_idx" ON "SystemEvent"("severity", "createdAt");

-- CreateIndex
CREATE INDEX "SystemEvent_createdAt_idx" ON "SystemEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrokerAccount" ADD CONSTRAINT "BrokerAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrokerCredential" ADD CONSTRAINT "BrokerCredential_brokerAccountId_fkey" FOREIGN KEY ("brokerAccountId") REFERENCES "BrokerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Strategy" ADD CONSTRAINT "Strategy_masterUserId_fkey" FOREIGN KEY ("masterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyFollower" ADD CONSTRAINT "StrategyFollower_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyFollower" ADD CONSTRAINT "StrategyFollower_followerUserId_fkey" FOREIGN KEY ("followerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyFollower" ADD CONSTRAINT "StrategyFollower_brokerAccountId_fkey" FOREIGN KEY ("brokerAccountId") REFERENCES "BrokerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MasterTrade" ADD CONSTRAINT "MasterTrade_masterUserId_fkey" FOREIGN KEY ("masterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MasterTrade" ADD CONSTRAINT "MasterTrade_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MasterTrade" ADD CONSTRAINT "MasterTrade_brokerAccountId_fkey" FOREIGN KEY ("brokerAccountId") REFERENCES "BrokerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyOrder" ADD CONSTRAINT "CopyOrder_masterTradeId_fkey" FOREIGN KEY ("masterTradeId") REFERENCES "MasterTrade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyOrder" ADD CONSTRAINT "CopyOrder_strategyFollowerId_fkey" FOREIGN KEY ("strategyFollowerId") REFERENCES "StrategyFollower"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyOrder" ADD CONSTRAINT "CopyOrder_followerUserId_fkey" FOREIGN KEY ("followerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyOrder" ADD CONSTRAINT "CopyOrder_brokerAccountId_fkey" FOREIGN KEY ("brokerAccountId") REFERENCES "BrokerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_brokerAccountId_fkey" FOREIGN KEY ("brokerAccountId") REFERENCES "BrokerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_brokerAccountId_fkey" FOREIGN KEY ("brokerAccountId") REFERENCES "BrokerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_brokerAccountId_fkey" FOREIGN KEY ("brokerAccountId") REFERENCES "BrokerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_copyOrderId_fkey" FOREIGN KEY ("copyOrderId") REFERENCES "CopyOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

