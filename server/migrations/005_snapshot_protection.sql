CREATE TRIGGER research_snapshot_append_only BEFORE UPDATE OR DELETE ON research_snapshots
FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_changes();
