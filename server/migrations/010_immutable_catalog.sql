CREATE TRIGGER component_types_no_changes BEFORE UPDATE OR DELETE OR TRUNCATE ON component_types
FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_modification();
CREATE TRIGGER lab_test_types_no_changes BEFORE UPDATE OR DELETE OR TRUNCATE ON lab_test_types
FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_modification();
