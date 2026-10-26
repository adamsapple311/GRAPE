ALTER TABLE public.agent_roi_insights
  ADD COLUMN IF NOT EXISTS worker_uuid uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_next_agent_roi_insight(
  p_worker_uuid uuid,
  p_lease_seconds integer
)
RETURNS SETOF public.agent_roi_insights
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_worker_uuid IS NULL OR p_lease_seconds < 1 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'A worker UUID and lease duration between 1 and 3600 seconds are required.';
  END IF;

  UPDATE public.agent_roi_insights
  SET status = 'PENDING',
      worker_uuid = NULL,
      lease_expires_at = NULL
  WHERE status = 'CLAIMED'
    AND lease_expires_at <= clock_timestamp();

  RETURN QUERY
  WITH candidate AS (
    SELECT id
    FROM public.agent_roi_insights
    WHERE status = 'PENDING'
      AND (next_retry_at IS NULL OR next_retry_at <= clock_timestamp())
    ORDER BY id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.agent_roi_insights AS insight
  SET status = 'CLAIMED',
      worker_uuid = p_worker_uuid,
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
  FROM candidate
  WHERE insight.id = candidate.id
  RETURNING insight.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_agent_roi_insight(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_next_agent_roi_insight(uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_agent_roi_insight(uuid, integer) TO service_role;
