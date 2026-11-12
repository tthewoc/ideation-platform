-- INSERT RETURNING checks policies before the new row is visible to STABLE queries.
CREATE FUNCTION workspace_unclaimed(w uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT NOT EXISTS(SELECT 1 FROM memberships WHERE workspace_id=w) $$;
REVOKE ALL ON FUNCTION workspace_unclaimed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workspace_unclaimed(uuid) TO ideator_app;
DROP POLICY workspace_read ON workspaces;
CREATE POLICY workspace_read ON workspaces FOR SELECT TO ideator_app USING(member(id) OR (created_by=actor() AND workspace_unclaimed(id)));
