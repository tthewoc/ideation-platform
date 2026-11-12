-- Application credentials cannot impersonate a successful ingestion scan.
CREATE FUNCTION guard_artifact_state() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_user='ideator_app' THEN
  IF TG_OP='INSERT' THEN
   IF (NEW.kind='digital' AND NEW.state<>'registered') OR (NEW.kind='physical' AND NEW.state<>'available') OR NEW.scan_token IS NOT NULL OR NEW.scanned_at IS NOT NULL OR NEW.storage_key IS NOT NULL THEN RAISE insufficient_privilege; END IF;
  ELSE
   IF NOT ((OLD.state='registered' AND NEW.state IN ('quarantined','rejected')) OR (OLD.state='available' AND NEW.state IN ('restricted','retracted')) OR (OLD.state='restricted' AND NEW.state='retracted')) THEN RAISE insufficient_privilege; END IF;
   IF NEW.kind<>OLD.kind OR NEW.workspace_id<>OLD.workspace_id OR NEW.object_id<>OLD.object_id OR NEW.scan_token IS DISTINCT FROM OLD.scan_token OR NEW.scanned_at IS DISTINCT FROM OLD.scanned_at OR NEW.scanner_version IS DISTINCT FROM OLD.scanner_version OR NEW.lease_until IS DISTINCT FROM OLD.lease_until OR NEW.attempts<>OLD.attempts OR (OLD.storage_key IS NOT NULL AND NEW.storage_key IS DISTINCT FROM OLD.storage_key) THEN RAISE insufficient_privilege; END IF;
   IF NEW.state='quarantined' AND (NEW.storage_key IS NULL OR NEW.scan_verdict IS NOT NULL) THEN RAISE check_violation; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER artifact_state_guard BEFORE INSERT OR UPDATE ON artifacts FOR EACH ROW EXECUTE FUNCTION guard_artifact_state();
ALTER TABLE artifacts ADD UNIQUE(workspace_id,object_id);
ALTER TABLE tasks ADD UNIQUE(workspace_id,object_id);
ALTER TABLE artifact_events ADD FOREIGN KEY(workspace_id,object_id) REFERENCES artifacts(workspace_id,object_id);
ALTER TABLE task_invitations ADD FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,object_id);
ALTER TABLE task_events ADD FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,object_id);
ALTER TABLE task_results ADD FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,object_id);
