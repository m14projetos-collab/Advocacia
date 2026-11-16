-- M14 Advocacia | Fase 2 | Hardening do Intake Público
-- Objetivo: revogar INSERT direto de anon em leads_intake e exigir entrada via Edge Function (leads-intake).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DROP POLICY IF EXISTS m14_public_intake ON public.leads_intake;
REVOKE INSERT ON TABLE public.leads_intake FROM anon;
REVOKE INSERT (name, phone, email, practice_area, summary, urgency, consent_version)
  ON TABLE public.leads_intake FROM anon;

CREATE TABLE IF NOT EXISTS m14_private.intake_rate_limits (
  ip_hash text NOT NULL,
  window_bucket timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 1,
  PRIMARY KEY (ip_hash, window_bucket)
);

REVOKE ALL ON TABLE m14_private.intake_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE m14_private.intake_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION m14_private.check_intake_rate_limit(p_ip_hash text, p_limit integer DEFAULT 5)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_bucket timestamptz := date_trunc('hour', now());
  v_hits integer;
BEGIN
  INSERT INTO m14_private.intake_rate_limits (ip_hash, window_bucket, hits)
  VALUES (p_ip_hash, v_bucket, 1)
  ON CONFLICT (ip_hash, window_bucket)
  DO UPDATE SET hits = m14_private.intake_rate_limits.hits + 1
  RETURNING hits INTO v_hits;

  RETURN v_hits <= p_limit;
END;
$$;

REVOKE ALL ON FUNCTION m14_private.check_intake_rate_limit(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION m14_private.check_intake_rate_limit(text, integer) TO service_role;

COMMIT;
