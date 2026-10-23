ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "parentUserId" TEXT;
CREATE INDEX IF NOT EXISTS "User_parentUserId_idx" ON "User"("parentUserId");
