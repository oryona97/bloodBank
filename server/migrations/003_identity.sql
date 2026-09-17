CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE CHECK (username = lower(username) AND username ~ '^[a-z0-9_.-]{3,64}$'),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 2 AND 120),
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('ADMIN', 'STAFF', 'RESEARCHER')),
  active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  csrf_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '8 hours'
);
CREATE INDEX sessions_user_id ON sessions(user_id);
CREATE TABLE login_limits (
  bucket text PRIMARY KEY,
  attempts integer NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE audit_logs ADD COLUMN actor_id uuid REFERENCES users(id);
ALTER TABLE audit_logs ADD COLUMN actor_role text CHECK (actor_role IN ('ADMIN', 'STAFF', 'RESEARCHER'));
ALTER TABLE audit_logs ADD COLUMN attribution text NOT NULL DEFAULT 'LEGACY' CHECK (attribution IN ('LEGACY', 'USER', 'SYSTEM'));
ALTER TABLE operation_requests ADD COLUMN actor_id uuid REFERENCES users(id);

-- Defense in depth; production also uses a separate non-owner runtime DB role.
CREATE FUNCTION reject_audit_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit history is append-only';
END;
$$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_changes();
