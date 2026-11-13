-- Each revision is a new private run; prior proposals and decisions stay intact.
ALTER TABLE ai_runs ADD COLUMN previous_proposal_id uuid REFERENCES ai_proposals;
ALTER TABLE ai_runs ADD COLUMN provenance jsonb NOT NULL DEFAULT '{"adapter":"fixture-v1","template":"restatement-v1","candidate_schema":1,"provider":null,"model":null,"unit":"utf8-bytes"}'::jsonb;
CREATE INDEX ai_run_previous_proposal ON ai_runs(previous_proposal_id) WHERE previous_proposal_id IS NOT NULL;
CREATE FUNCTION resubmit_fixture_run(w uuid,previous uuid,expected integer,reviewer uuid,instruction text,refs jsonb,input_limit integer,output_limit integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p ai_proposals; run uuid;
BEGIN
 SELECT * INTO p FROM ai_proposals WHERE id=previous AND workspace_id=w FOR UPDATE;
 IF NOT member(w) OR p.requester_id IS DISTINCT FROM actor() OR NOT fixture_inputs_readable(w,p.run_id) THEN RAISE insufficient_privilege;END IF;
 IF p.version<>expected OR p.disposition NOT IN ('rejected','deferred','needs_evidence') OR p.published_refs IS NOT NULL OR reviewer<>p.reviewer_id THEN RAISE serialization_failure;END IF;
 run:=queue_fixture_run(w,reviewer,instruction,refs,input_limit,output_limit);
 UPDATE ai_runs SET previous_proposal_id=previous WHERE id=run;
 RETURN run;
END $$;
REVOKE ALL ON FUNCTION resubmit_fixture_run(uuid,uuid,integer,uuid,text,jsonb,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resubmit_fixture_run(uuid,uuid,integer,uuid,text,jsonb,integer,integer) TO ideator_app;
