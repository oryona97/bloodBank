CREATE TABLE lab_panels (
  panel_version integer PRIMARY KEY CHECK (panel_version > 0),
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_by uuid REFERENCES users(id),
  reason text NOT NULL
);
INSERT INTO lab_panels(panel_version,reason)
SELECT DISTINCT panel_version,'Preserved approved demonstration panel' FROM lab_test_types;
ALTER TABLE lab_test_types ADD CONSTRAINT lab_test_panel FOREIGN KEY(panel_version) REFERENCES lab_panels;
ALTER TABLE donations ADD CONSTRAINT donation_required_panel FOREIGN KEY(required_panel_version) REFERENCES lab_panels;
ALTER TABLE donations ALTER COLUMN required_panel_version DROP DEFAULT;
CREATE TRIGGER lab_panels_no_changes BEFORE UPDATE OR DELETE OR TRUNCATE ON lab_panels
FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_modification();
