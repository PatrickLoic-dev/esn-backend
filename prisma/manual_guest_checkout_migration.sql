-- Guest checkout support: makes Order/Payment ownership optional and adds
-- Order.guestEmail so an order can exist without an account.
-- Additive/relaxing only — no data loss. Safe to re-run.

-- Order: drop NOT NULL on userId, add guestEmail
ALTER TABLE "Order" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "guestEmail" TEXT;
CREATE INDEX IF NOT EXISTS "Order_guestEmail_idx" ON "Order"("guestEmail");

-- Payment: drop NOT NULL on userId (guest orders can be paid without an account)
ALTER TABLE "Payment" ALTER COLUMN "userId" DROP NOT NULL;
