-- Publication can carry acceptance of identical draft content. Expose its decision
-- provenance to the publication audience, without granting draft content access.
CREATE FUNCTION published_review_source(w uuid,o uuid,r integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT member(w) AND EXISTS(SELECT 1 FROM revision_status s JOIN publications p USING(workspace_id,object_id,revision) WHERE s.workspace_id=w AND s.object_id=o AND s.review_source_revision=r)
$$;
REVOKE ALL ON FUNCTION published_review_source(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION published_review_source(uuid,uuid,integer) TO ideator_app;
DROP POLICY reviews_read ON reviews;
CREATE POLICY reviews_read ON reviews FOR SELECT TO ideator_app USING(readable_revision(workspace_id,object_id,revision) OR published_review_source(workspace_id,object_id,revision));
DROP POLICY lifecycle_read ON lifecycle_events;
CREATE POLICY lifecycle_read ON lifecycle_events FOR SELECT TO ideator_app USING(readable_revision(workspace_id,object_id,revision) OR published_review_source(workspace_id,object_id,revision));
