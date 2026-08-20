-- Adds the PromoBanner (single-row config) and Testimonial tables.
-- Additive only — no data loss. Safe to re-run.
--
-- Run this in the Supabase SQL editor.

BEGIN;

CREATE TABLE IF NOT EXISTS "PromoBanner" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "message" TEXT NOT NULL DEFAULT '',
  "code" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PromoBanner_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Testimonial" (
  "id" TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS "Testimonial_isActive_sortOrder_idx"
  ON "Testimonial"("isActive", "sortOrder");

COMMIT;
