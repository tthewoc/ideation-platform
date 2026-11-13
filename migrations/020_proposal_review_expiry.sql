-- Review expiry is an action cutoff, not deletion of provenance or decisions.
ALTER TABLE ai_runs ADD COLUMN review_expires_at timestamptz;
UPDATE ai_runs SET review_expires_at=created_at+interval '30 days';
ALTER TABLE ai_runs ALTER COLUMN review_expires_at SET NOT NULL;
ALTER TABLE ai_proposals ADD COLUMN expires_at timestamptz;
UPDATE ai_proposals p SET expires_at=r.review_expires_at FROM ai_runs r WHERE r.id=p.run_id;
ALTER TABLE ai_proposals ALTER COLUMN expires_at SET NOT NULL;

CREATE FUNCTION fixture_review_window() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE days integer;
BEGIN
 days:=COALESCE(NULLIF(current_setting('app.fixture_review_days',true),''),'30')::integer;
 IF days NOT BETWEEN 1 AND 90 THEN RAISE invalid_parameter_value;END IF;
 NEW.review_expires_at:=clock_timestamp()+make_interval(days=>days);
 RETURN NEW;
END $$;
CREATE TRIGGER fixture_review_window BEFORE INSERT ON ai_runs FOR EACH ROW EXECUTE FUNCTION fixture_review_window();

CREATE FUNCTION guard_fixture_proposal_expiry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT review_expires_at INTO NEW.expires_at FROM ai_runs WHERE id=NEW.run_id AND workspace_id=NEW.workspace_id;
  IF NEW.expires_at IS NULL OR NEW.expires_at<=clock_timestamp() THEN RAISE serialization_failure USING MESSAGE='Proposal review window expired';END IF;
 ELSIF OLD.published_refs IS NULL AND OLD.expires_at<=clock_timestamp() THEN
  RAISE serialization_failure USING MESSAGE='Proposal review window expired';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_fixture_proposal_expiry BEFORE INSERT OR UPDATE ON ai_proposals FOR EACH ROW EXECUTE FUNCTION guard_fixture_proposal_expiry();

CREATE FUNCTION guard_fixture_resubmission_expiry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.previous_proposal_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ai_proposals p WHERE p.id=NEW.previous_proposal_id AND p.workspace_id=NEW.workspace_id AND p.expires_at>clock_timestamp()) THEN
  RAISE serialization_failure USING MESSAGE='Previous proposal review window expired';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_fixture_resubmission_expiry BEFORE INSERT OR UPDATE OF previous_proposal_id ON ai_runs FOR EACH ROW EXECUTE FUNCTION guard_fixture_resubmission_expiry();
REVOKE ALL ON FUNCTION fixture_review_window(),guard_fixture_proposal_expiry(),guard_fixture_resubmission_expiry() FROM PUBLIC;
