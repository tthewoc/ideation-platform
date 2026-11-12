CREATE FUNCTION bootstrap_workspace(w uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT EXISTS(SELECT 1 FROM workspaces WHERE id=w AND created_by=actor()) AND NOT EXISTS(SELECT 1 FROM memberships WHERE workspace_id=w) $$;
REVOKE ALL ON FUNCTION bootstrap_workspace(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bootstrap_workspace(uuid) TO ideator_app;
DROP POLICY workspace_read ON workspaces;
CREATE POLICY workspace_read ON workspaces FOR SELECT TO ideator_app USING(member(id) OR bootstrap_workspace(id));
DROP POLICY membership_write ON memberships;
CREATE POLICY membership_write ON memberships FOR ALL TO ideator_app USING(has_role(workspace_id,'admin')) WITH CHECK(has_role(workspace_id,'admin') OR (user_id=actor() AND bootstrap_workspace(workspace_id)));
CREATE OR REPLACE FUNCTION object_author(w uuid,o uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT member(w) AND EXISTS(SELECT 1 FROM objects WHERE workspace_id=w AND id=o AND author_id=actor()) $$;
CREATE OR REPLACE FUNCTION published(w uuid,o uuid,r integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT member(w) AND EXISTS(SELECT 1 FROM publications WHERE workspace_id=w AND object_id=o AND revision=r) $$;
