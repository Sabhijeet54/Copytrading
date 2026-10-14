-- Subscription licence per user.
ALTER TABLE "User"
  ADD COLUMN "licenceDays" INTEGER,
  ADD COLUMN "licenceAssignedAt" TIMESTAMP(3),
  ADD COLUMN "licenceExpiresAt" TIMESTAMP(3);

CREATE INDEX "User_licenceExpiresAt_idx" ON "User"("licenceExpiresAt");
