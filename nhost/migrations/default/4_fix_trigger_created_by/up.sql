-- ============================================================
-- Migration 004: Make workflow_triggers.created_by nullable
-- Webhook, scheduled, and database_event triggers are created by
-- the system (no user session), so created_by must be optional.
-- ============================================================
ALTER TABLE public.workflow_triggers
  ALTER COLUMN created_by DROP NOT NULL;
