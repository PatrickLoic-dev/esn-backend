-- Removes the PAID value from the OrderStatus enum.
-- Postgres cannot drop an enum value directly, so we recreate the type.
-- Run this in the Supabase SQL editor. Safe to re-run.

BEGIN;

-- 1. Move any existing PAID orders to SHIPPED (payment confirmation is now
--    tracked entirely on the Payment record, not on Order.status).
UPDATE "Order" SET status = 'SHIPPED' WHERE status = 'PAID';

-- 2. Recreate the enum without PAID
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";

CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'SHIPPED', 'DELIVERED', 'CANCELLED');

ALTER TABLE "Order"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "OrderStatus"
    USING ("status"::text::"OrderStatus"),
  ALTER COLUMN "status" SET DEFAULT 'PENDING';

DROP TYPE "OrderStatus_old";

COMMIT;
