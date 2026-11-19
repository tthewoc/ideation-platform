CREATE FUNCTION outline_review_decision_readable(w uuid,review uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT outline_review_readable(w,review) AND EXISTS(SELECT 1 FROM intake_review_requests r WHERE r.workspace_id=w AND r.id=review AND outline_review_sources_available(w,r.session_id,r.outline_revision))
$$;
REVOKE ALL ON FUNCTION outline_review_decision_readable(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outline_review_decision_readable(uuid,uuid) TO ideator_app;
DROP POLICY intake_review_decision_read ON intake_review_decisions;
CREATE POLICY intake_review_decision_read ON intake_review_decisions FOR SELECT TO ideator_app USING(outline_review_decision_readable(workspace_id,request_id));
