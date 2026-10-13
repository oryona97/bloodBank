CREATE TABLE lab_test_types (
  test_type_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  panel_version integer NOT NULL,
  result_kind text NOT NULL CHECK (result_kind IN ('TYPING','SCREENING')),
  required boolean NOT NULL DEFAULT true,
  UNIQUE(code,panel_version)
);
INSERT INTO lab_test_types(code,panel_version,result_kind) VALUES
('ABO_RH',1,'TYPING'),('HIV',1,'SCREENING'),('HBV',1,'SCREENING'),('HCV',1,'SCREENING'),('SYPHILIS',1,'SCREENING');
CREATE TABLE lab_results (
  result_id uuid PRIMARY KEY,
  donation_id uuid NOT NULL REFERENCES donations,
  test_type_id uuid NOT NULL REFERENCES lab_test_types,
  value text NOT NULL,
  revision integer NOT NULL,
  performed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  recorded_by uuid NOT NULL REFERENCES users(id),
  replaces_result_id uuid REFERENCES lab_results,
  reason text,
  UNIQUE(donation_id,test_type_id,revision)
);
CREATE TABLE release_decisions (
  release_id uuid PRIMARY KEY,
  donation_id uuid NOT NULL REFERENCES donations,
  result_version_refs uuid[] NOT NULL,
  decision text NOT NULL CHECK (decision IN ('APPROVE','REJECT')),
  approved_by uuid NOT NULL REFERENCES users(id),
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason text
);
CREATE TRIGGER lab_results_no_changes BEFORE UPDATE OR DELETE OR TRUNCATE ON lab_results
FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_modification();
CREATE TRIGGER release_decisions_no_changes BEFORE UPDATE OR DELETE OR TRUNCATE ON release_decisions
FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_modification();
