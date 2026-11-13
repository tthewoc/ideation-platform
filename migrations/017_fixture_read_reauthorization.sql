CREATE FUNCTION fixture_inputs_readable(w uuid,run uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT member(w) AND EXISTS(SELECT 1 FROM ai_runs r WHERE r.workspace_id=w AND r.id=run AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.input_refs) x WHERE NOT retrievable_revision(w,(x->>'id')::uuid,(x->>'revision')::integer,false)))
$$;
REVOKE ALL ON FUNCTION fixture_inputs_readable(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fixture_inputs_readable(uuid,uuid) TO ideator_app;
DROP POLICY ai_run_read ON ai_runs;
CREATE POLICY ai_run_read ON ai_runs FOR SELECT TO ideator_app USING(fixture_inputs_readable(workspace_id,id) AND (requester_id=actor() OR (reviewer_id=actor() AND has_role(workspace_id,'reviewer'))));
DROP POLICY ai_proposal_read ON ai_proposals;
CREATE POLICY ai_proposal_read ON ai_proposals FOR SELECT TO ideator_app USING(fixture_inputs_readable(workspace_id,run_id) AND (requester_id=actor() OR (reviewer_id=actor() AND has_role(workspace_id,'reviewer'))));
