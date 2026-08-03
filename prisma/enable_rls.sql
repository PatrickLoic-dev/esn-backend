-- Enable Row Level Security on every application table.
--
-- Architecture note: all client access goes through the NestJS API, which
-- connects to Postgres as the Supabase project owner (the `postgres.<ref>`
-- pooler user). That role has BYPASSRLS, so it is unaffected by everything
-- below and the API keeps working exactly as before.
--
-- `anon` and `authenticated` (the roles PostgREST/Supabase client libraries
-- use) must NEVER read or write these tables directly — the API is the only
-- allowed path. This script (1) enables RLS with zero policies, which denies
-- all access by default to any role that isn't RLS-exempt, and (2) revokes
-- the table-level grants Supabase applies to `anon`/`authenticated` by
-- default, as defense-in-depth in case a policy is added later by mistake.
--
-- Safe to re-run (idempotent).

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'User',
      'MlmConfig',
      'ReferralCommission',
      'Review',
      'Category',
      'Product',
      'QuoteRequest',
      'Order',
      'OrderItem',
      'Payment',
      'Ticket',
      'TicketMessage',
      'AnalyticsEvent',
      'ServiceDay',
      'ServiceIncident'
    ])
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon;', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated;', t);
  END LOOP;
END $$;

-- No policies are created intentionally: with RLS enabled and no policies,
-- every role except the table owner / BYPASSRLS roles (postgres, service_role)
-- gets zero rows on SELECT and is rejected on INSERT/UPDATE/DELETE.
--
-- If you later need the Supabase client (anon/authenticated) to read or write
-- specific rows directly — bypassing the NestJS API — add narrow policies
-- per table/action instead of disabling RLS, e.g.:
--
--   CREATE POLICY "own_profile_select" ON public."User"
--     FOR SELECT TO authenticated
--     USING (id = auth.uid()::text);
