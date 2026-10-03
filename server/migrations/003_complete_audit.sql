ALTER TABLE audit_logs
  ADD COLUMN sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  ADD COLUMN actor text NOT NULL DEFAULT 'unknown',
  ADD COLUMN source text NOT NULL DEFAULT 'legacy',
  ADD COLUMN request_id uuid,
  ADD COLUMN request_key text,
  ADD COLUMN outcome text NOT NULL DEFAULT 'SUCCESS'
    CHECK (outcome IN ('SUCCESS', 'REJECTED', 'ERROR')),
  ADD COLUMN context jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE audit_logs ALTER COLUMN created_at SET DEFAULT clock_timestamp();
CREATE INDEX audit_logs_request_id_idx ON audit_logs(request_id);

CREATE FUNCTION reject_audit_modification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit records are append-only' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER audit_logs_no_changes
  BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_modification();
