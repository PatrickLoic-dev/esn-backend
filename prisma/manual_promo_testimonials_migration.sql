-- Adds the PromoCode table (scoped percentage discount codes, applied for
-- real at checkout) and the Testimonial table (customer-authored, one per
-- account, plus staff-curated ones with no account attached).
-- Fully idempotent — safe to run even if parts of it were applied before.
--
-- Run this in the Supabase SQL editor.

BEGIN;

-- Drop a stale PromoBanner table from an earlier iteration of this feature,
-- if it exists — replaced by PromoCode below.
DROP TABLE IF EXISTS "PromoBanner";

-- ---------------------------------------------------------------------------
-- PromoCode
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "PromoScope" AS ENUM ('ORDER', 'CATEGORY', 'NEW_PRODUCTS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PromoCode" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT,
  "percentOff" INTEGER NOT NULL,
  "scope" "PromoScope" NOT NULL DEFAULT 'ORDER',
  "categoryId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PromoCode_code_key" ON "PromoCode"("code");

DO $$ BEGIN
  ALTER TABLE "PromoCode"
    ADD CONSTRAINT "PromoCode_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Order: which promo (if any) was applied, and how much it discounted.
-- ---------------------------------------------------------------------------
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "promoCodeId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "promoDiscount" DECIMAL(10,2);

DO $$ BEGIN
  ALTER TABLE "Order"
    ADD CONSTRAINT "Order_promoCodeId_fkey"
    FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Testimonial
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Testimonial" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "authorName" TEXT NOT NULL,
  "authorTitle" TEXT,
  "avatarUrl" TEXT,
  "rating" INTEGER,
  "quote" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Testimonial_pkey" PRIMARY KEY ("id")
);

-- In case an earlier version of this table exists without userId.
ALTER TABLE "Testimonial" ADD COLUMN IF NOT EXISTS "userId" TEXT;

CREATE INDEX IF NOT EXISTS "Testimonial_isActive_sortOrder_idx"
  ON "Testimonial"("isActive", "sortOrder");
CREATE UNIQUE INDEX IF NOT EXISTS "Testimonial_userId_key" ON "Testimonial"("userId");

DO $$ BEGIN
  ALTER TABLE "Testimonial"
    ADD CONSTRAINT "Testimonial_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
