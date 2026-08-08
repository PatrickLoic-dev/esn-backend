-- Empties the product catalog (Product + Category) and everything that
-- references a product, since OrderItem/QuoteRequest have no ON DELETE
-- CASCADE on productId (they'd otherwise block the delete with a foreign
-- key violation). Review already cascades via the schema, but it's cleared
-- explicitly here too for a self-contained script.
--
-- WARNING: this deletes ALL order line items and ALL quote requests, not
-- just ones tied to inactive/test products — every Order row itself is kept
-- (so order totals/history remain), but each order's line items are gone.
-- Only run this if that history is disposable (seed/test data), which is
-- the intended use here.
--
-- Run this in the Supabase SQL editor.

BEGIN;

DELETE FROM "OrderItem";
DELETE FROM "QuoteRequest";
DELETE FROM "Review";
DELETE FROM "Product";
DELETE FROM "Category";

COMMIT;
