-- Reject a null expected version at the database boundary as well as HTTP.
CREATE OR REPLACE FUNCTION resubmit_fixture_run(w uuid,previous uuid,expected integer,reviewer uuid,instruction text,refs jsonb,input_limit integer,output_limit integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p ai_proposals; run uuid;
BEGIN
 SELECT * INTO p FROM ai_proposals WHERE id=previous AND workspace_id=w FOR UPDATE;
 IF NOT member(w) OR p.requester_id IS DISTINCT FROM actor() OR NOT fixture_inputs_readable(w,p.run_id) THEN RAISE insufficient_privilege;END IF;
 IF p.version IS DISTINCT FROM expected OR p.disposition NOT IN ('rejected','deferred','needs_evidence') OR p.published_refs IS NOT NULL OR reviewer<>p.reviewer_id THEN RAISE serialization_failure;END IF;
 run:=queue_fixture_run(w,reviewer,instruction,refs,input_limit,output_limit);
 UPDATE ai_runs SET previous_proposal_id=previous WHERE id=run;
 RETURN run;
END $$;
