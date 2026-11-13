CREATE FUNCTION audit_fixture_state() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE ev uuid:=gen_random_uuid(); BEGIN
 IF OLD.state IS DISTINCT FROM NEW.state THEN
 INSERT INTO audit_events(id,workspace_id,actor_id,action,target_id,request_id) VALUES(ev,NEW.workspace_id,NEW.requester_id,'ai.fixture_'||NEW.state,NEW.id,'fixture-state-machine');
 INSERT INTO outbox(event_id,workspace_id,kind,payload) VALUES(ev,NEW.workspace_id,'ai.fixture_'||NEW.state,jsonb_build_object('target_id',NEW.id));
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER fixture_state_event AFTER UPDATE OF state ON ai_runs FOR EACH ROW EXECUTE FUNCTION audit_fixture_state();
