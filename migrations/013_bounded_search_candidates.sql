-- Select a bounded indexed window before expensive transitive policy checks.
-- No raw document, score or inaccessible identity leaves this service function.
CREATE FUNCTION search_candidate_ids(w uuid,g uuid,phrase text,neighbors uuid[],kind text,outcome text) RETURNS TABLE(object_id uuid) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF NOT member(w) THEN RETURN; END IF;
 IF length(phrase)>200 OR cardinality(neighbors)>200 THEN RAISE invalid_parameter_value; END IF;
 RETURN QUERY WITH candidate_window AS MATERIALIZED(
 SELECT d.object_id,d.revision FROM search_documents d JOIN objects o ON o.workspace_id=d.workspace_id AND o.id=d.object_id AND o.current_revision=d.revision JOIN revisions r ON r.workspace_id=d.workspace_id AND r.object_id=d.object_id AND r.revision=d.revision
 WHERE d.workspace_id=w AND d.generation=g AND ((phrase<>'' AND d.document@@plainto_tsquery('simple',phrase)) OR d.object_id=ANY(neighbors)) AND (kind IS NULL OR o.type=kind) AND (outcome IS NULL OR (o.type='result' AND r.content->>'outcome'=outcome)) ORDER BY d.object_id LIMIT 5000
 ) SELECT x.object_id FROM candidate_window x WHERE retrievable_revision(w,x.object_id,x.revision,false) ORDER BY x.object_id LIMIT 1001;
END $$;
REVOKE ALL ON FUNCTION search_candidate_ids(uuid,uuid,text,uuid[],text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_candidate_ids(uuid,uuid,text,uuid[],text,text) TO ideator_app;
