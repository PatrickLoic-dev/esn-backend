-- MLM / affiliation layer — manual migration for Supabase SQL editor
-- Additive only: new nullable/defaulted columns + 2 new tables. No data loss.

-- 1. New columns on "User"
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referredById" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "pointsBalance" INTEGER NOT NULL DEFAULT 0;

-- Unique referral code + self-referencing FK for the upline
CREATE UNIQUE INDEX IF NOT EXISTS "User_referralCode_key" ON "User"("referralCode");

ALTER TABLE "User"
  ADD CONSTRAINT "User_referredById_fkey"
  FOREIGN KEY ("referredById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. New column on "Order"
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "pointsUsed" INTEGER NOT NULL DEFAULT 0;

-- 3. New table: MlmConfig (single configurable row, id = 'default')
CREATE TABLE IF NOT EXISTS "MlmConfig" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "level1Rate" DOUBLE PRECISION NOT NULL DEFAULT 0.10,
  "level2Rate" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
  "level3Rate" DOUBLE PRECISION NOT NULL DEFAULT 0.02,
  "pointValueFcfa" DOUBLE PRECISION NOT NULL DEFAULT 0.10,
  "maxDirectReferrals" INTEGER NOT NULL DEFAULT 3,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MlmConfig_pkey" PRIMARY KEY ("id")
);

-- 4. New table: ReferralCommission (points ledger)
CREATE TABLE IF NOT EXISTS "ReferralCommission" (
  "id" TEXT NOT NULL,
  "beneficiaryId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "level" INTEGER NOT NULL,
  "points" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReferralCommission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReferralCommission_orderId_beneficiaryId_key"
  ON "ReferralCommission"("orderId", "beneficiaryId");
CREATE INDEX IF NOT EXISTS "ReferralCommission_beneficiaryId_idx"
  ON "ReferralCommission"("beneficiaryId");

ALTER TABLE "ReferralCommission"
  ADD CONSTRAINT "ReferralCommission_beneficiaryId_fkey"
  FOREIGN KEY ("beneficiaryId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReferralCommission"
  ADD CONSTRAINT "ReferralCommission_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReferralCommission"
  ADD CONSTRAINT "ReferralCommission_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
