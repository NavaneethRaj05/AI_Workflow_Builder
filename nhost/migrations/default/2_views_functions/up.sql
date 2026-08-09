-- ============================================================
-- Migration 002: Views, Computed Fields, and Helper Functions
-- ============================================================

-- ============================================================
-- View: org_monthly_usage
-- Computes per-org workflow runs completed this calendar month
-- ============================================================
CREATE OR REPLACE VIEW public.org_monthly_usage AS
SELECT
  o.id AS org_id,
  o.name AS org_name,
  o.quota_limit,
  o.quota_used,
  o.quota_reset_at,
  COUNT(CASE
    WHEN wr.status = 'completed'
      AND wr.completed_at >= date_trunc('month', NOW())
      AND wr.completed_at < date_trunc('month', NOW()) + INTERVAL '1 month'
    THEN 1 ELSE NULL END
  ) AS runs_this_month,
  ROUND(
    AVG(CASE WHEN wr.duration_ms IS NOT NULL THEN wr.duration_ms ELSE NULL END) / 1000.0, 2
  ) AS avg_run_duration_seconds
FROM public.organizations o
LEFT JOIN public.workflow_runs wr ON wr.org_id = o.id
GROUP BY o.id, o.name, o.quota_limit, o.quota_used, o.quota_reset_at;

-- ============================================================
-- Function: get_org_quota_remaining
-- Used as a computed field on organizations
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_org_quota_remaining(org_row public.organizations)
RETURNS INTEGER AS $$
  SELECT GREATEST(0, org_row.quota_limit - org_row.quota_used);
$$ LANGUAGE sql STABLE;

-- ============================================================
-- Function: check_and_increment_quota
-- Atomically checks if quota allows a new run, increments if yes
-- Returns TRUE if quota was available and incremented, FALSE if exhausted
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_and_increment_quota(p_org_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_quota_limit INTEGER;
  v_quota_used INTEGER;
  v_reset_at TIMESTAMPTZ;
BEGIN
  -- Lock the row to prevent race conditions
  SELECT quota_limit, quota_used, quota_reset_at
  INTO v_quota_limit, v_quota_used, v_reset_at
  FROM public.organizations
  WHERE id = p_org_id
  FOR UPDATE;

  -- Reset quota if past reset date
  IF NOW() >= v_reset_at THEN
    UPDATE public.organizations
    SET
      quota_used = 0,
      quota_reset_at = date_trunc('month', NOW()) + INTERVAL '1 month'
    WHERE id = p_org_id;
    v_quota_used := 0;
  END IF;

  -- Check if quota allows
  IF v_quota_used >= v_quota_limit THEN
    RETURN FALSE;
  END IF;

  -- Increment quota
  UPDATE public.organizations
  SET quota_used = quota_used + 1
  WHERE id = p_org_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Function: get_user_org_role
-- Returns a user's role in a given org, or NULL if not a member
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_user_org_role(p_user_id UUID, p_org_id UUID)
RETURNS TEXT AS $$
  SELECT role::TEXT
  FROM public.org_members
  WHERE user_id = p_user_id AND org_id = p_org_id
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- Function: workflow_run_step_count
-- Computed field for workflow_runs: total and completed steps
-- ============================================================
CREATE OR REPLACE FUNCTION public.workflow_run_step_count(run_row public.workflow_runs)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.step_runs
  WHERE workflow_run_id = run_row.id;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.workflow_run_completed_steps(run_row public.workflow_runs)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.step_runs
  WHERE workflow_run_id = run_row.id
    AND status IN ('succeeded', 'skipped');
$$ LANGUAGE sql STABLE;
