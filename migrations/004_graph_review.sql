ALTER TABLE objects DROP CONSTRAINT objects_type_check;
ALTER TABLE objects ADD CHECK(type IN ('claim','observation','hypothesis','method','result','evidence','assessment','thesis','research_task'));
ALTER TABLE workspaces ADD content_epoch bigint NOT NULL DEFAULT 1;
CREATE TABLE submissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,object_id uuid NOT NULL,revision integer NOT NULL,author_id uuid NOT NULL REFERENCES users,reviewer_ids uuid[] NOT NULL,purpose text NOT NULL,state text NOT NULL DEFAULT 'submitted' CHECK(state IN ('submitted','accepted','rejected','needs_evidence','withdrawn')),version integer NOT NULL DEFAULT 1,expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(workspace_id,object_id,revision) REFERENCES revisions(workspace_id,object_id,revision),CHECK(cardinality(reviewer_ids) BETWEEN 1 AND 10 AND NOT author_id=ANY(reviewer_ids)));
CREATE UNIQUE INDEX one_open_submission ON submissions(workspace_id,object_id) WHERE state='submitted';
CREATE FUNCTION review_grant(w uuid,o uuid,r integer DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT member(w) AND EXISTS(SELECT 1 FROM submissions s WHERE s.workspace_id=w AND s.object_id=o AND (r IS NULL OR s.revision=r) AND s.state='submitted' AND s.expires_at>now() AND actor()=ANY(s.reviewer_ids) AND has_role(w,'reviewer')) $$;
CREATE FUNCTION readable_revision(w uuid,o uuid,r integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT member(w) AND (object_author(w,o) OR published(w,o,r) OR review_grant(w,o,r)) $$;
REVOKE ALL ON FUNCTION review_grant(uuid,uuid,integer),readable_revision(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION review_grant(uuid,uuid,integer),readable_revision(uuid,uuid,integer) TO ideator_app;
DROP POLICY object_read ON objects;
CREATE POLICY object_read ON objects FOR SELECT TO ideator_app USING(member(workspace_id) AND (author_id=actor() OR current_revision IS NOT NULL OR review_grant(workspace_id,id)));
DROP POLICY revision_read ON revisions;
CREATE POLICY revision_read ON revisions FOR SELECT TO ideator_app USING(readable_revision(workspace_id,object_id,revision));
CREATE TABLE revision_status(workspace_id uuid NOT NULL,object_id uuid NOT NULL,revision integer NOT NULL,review_state text NOT NULL DEFAULT 'unreviewed' CHECK(review_state IN ('unreviewed','submitted','accepted','rejected','needs_evidence','disputed')),validity text NOT NULL DEFAULT 'active' CHECK(validity IN ('active','retracted','superseded')),version integer NOT NULL DEFAULT 1,last_reviewer uuid REFERENCES users,review_source_revision integer,PRIMARY KEY(workspace_id,object_id,revision),FOREIGN KEY(workspace_id,object_id,revision) REFERENCES revisions(workspace_id,object_id,revision));
CREATE TABLE lifecycle_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,object_id uuid NOT NULL,revision integer NOT NULL,axis text NOT NULL CHECK(axis IN ('review','validity')),from_state text NOT NULL,to_state text NOT NULL,reason text NOT NULL,actor_id uuid NOT NULL REFERENCES users,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(workspace_id,object_id,revision) REFERENCES revisions(workspace_id,object_id,revision));
CREATE TABLE reviews(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,object_id uuid NOT NULL,revision integer NOT NULL,submission_id uuid REFERENCES submissions,decision text NOT NULL,reason text NOT NULL,conflict_declaration text NOT NULL,reviewer_id uuid NOT NULL REFERENCES users,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(workspace_id,object_id,revision) REFERENCES revisions(workspace_id,object_id,revision));
CREATE TABLE edges(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces,author_id uuid NOT NULL REFERENCES users,current_revision integer NOT NULL DEFAULT 1,assessment_id uuid,UNIQUE(workspace_id,id),UNIQUE(workspace_id,assessment_id),FOREIGN KEY(workspace_id,assessment_id) REFERENCES objects(workspace_id,id));
CREATE TABLE edge_revisions(workspace_id uuid NOT NULL,edge_id uuid NOT NULL,revision integer NOT NULL,type text NOT NULL CHECK(type IN ('supports','contradicts','qualifies','inconclusive','derived_from','tests','depends_on','uses_method','produces','relevant_to','part_of','supersedes','cites')),from_id uuid NOT NULL,from_revision integer NOT NULL,to_id uuid NOT NULL,to_revision integer NOT NULL,assessment_revision integer,rationale text NOT NULL,condition text,valid_from timestamptz,valid_to timestamptz,state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','retracted')),actor_id uuid NOT NULL REFERENCES users,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,edge_id,revision),FOREIGN KEY(workspace_id,edge_id) REFERENCES edges(workspace_id,id),FOREIGN KEY(workspace_id,from_id,from_revision) REFERENCES publications(workspace_id,object_id,revision),FOREIGN KEY(workspace_id,to_id,to_revision) REFERENCES publications(workspace_id,object_id,revision),CHECK(valid_to IS NULL OR valid_from IS NULL OR valid_to>valid_from));
ALTER TABLE edges ADD FOREIGN KEY(workspace_id,id,current_revision) REFERENCES edge_revisions(workspace_id,edge_id,revision) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX edge_from ON edge_revisions(workspace_id,from_id,edge_id);
CREATE INDEX edge_to ON edge_revisions(workspace_id,to_id,edge_id);
CREATE TABLE lineage(workspace_id uuid NOT NULL,derived_id uuid NOT NULL,derived_revision integer NOT NULL,input_id uuid NOT NULL,input_revision integer NOT NULL,edge_id uuid REFERENCES edges,PRIMARY KEY(workspace_id,derived_id,derived_revision,input_id,input_revision),FOREIGN KEY(workspace_id,derived_id,derived_revision) REFERENCES publications(workspace_id,object_id,revision),FOREIGN KEY(workspace_id,input_id,input_revision) REFERENCES publications(workspace_id,object_id,revision));
CREATE INDEX lineage_reverse ON lineage(workspace_id,input_id,input_revision);
CREATE TABLE revision_freshness(workspace_id uuid NOT NULL,object_id uuid NOT NULL,revision integer NOT NULL,epoch bigint NOT NULL,status text NOT NULL CHECK(status IN ('current','stale')),PRIMARY KEY(workspace_id,object_id,revision),FOREIGN KEY(workspace_id,object_id,revision) REFERENCES publications(workspace_id,object_id,revision));
CREATE TABLE equivalences(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,left_id uuid NOT NULL,left_revision integer NOT NULL,right_id uuid NOT NULL,right_revision integer NOT NULL,author_id uuid REFERENCES users NOT NULL,rationale text NOT NULL,state text NOT NULL DEFAULT 'candidate' CHECK(state IN ('candidate','reviewed','rejected','revoked')),version integer NOT NULL DEFAULT 1,FOREIGN KEY(workspace_id,left_id,left_revision) REFERENCES publications(workspace_id,object_id,revision),FOREIGN KEY(workspace_id,right_id,right_revision) REFERENCES publications(workspace_id,object_id,revision),CHECK(left_id<>right_id));
CREATE TABLE equivalence_decisions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,equivalence_id uuid NOT NULL REFERENCES equivalences,decision text NOT NULL,reason text NOT NULL,actor_id uuid NOT NULL REFERENCES users,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE graph_cursors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES users,policy_version integer NOT NULL,content_epoch bigint NOT NULL,state jsonb NOT NULL,expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes');
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['submissions','revision_status','lifecycle_events','reviews','edges','edge_revisions','lineage','revision_freshness','equivalences','equivalence_decisions','graph_cursors'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 END LOOP;
END $$;
CREATE POLICY submission_read ON submissions FOR SELECT TO ideator_app USING(member(workspace_id) AND (author_id=actor() OR published(workspace_id,object_id,revision) OR (actor()=ANY(reviewer_ids) AND has_role(workspace_id,'reviewer') AND state='submitted' AND expires_at>now())));
CREATE POLICY submission_insert ON submissions FOR INSERT TO ideator_app WITH CHECK(member(workspace_id) AND author_id=actor() AND object_author(workspace_id,object_id));
CREATE POLICY submission_update ON submissions FOR UPDATE TO ideator_app USING(member(workspace_id) AND (author_id=actor() OR (actor()=ANY(reviewer_ids) AND has_role(workspace_id,'reviewer')))) WITH CHECK(member(workspace_id));
CREATE POLICY status_read ON revision_status FOR SELECT TO ideator_app USING(readable_revision(workspace_id,object_id,revision));
CREATE POLICY status_insert ON revision_status FOR INSERT TO ideator_app WITH CHECK(readable_revision(workspace_id,object_id,revision));
CREATE POLICY status_update ON revision_status FOR UPDATE TO ideator_app USING(readable_revision(workspace_id,object_id,revision) AND (object_author(workspace_id,object_id) OR has_role(workspace_id,'reviewer') OR has_role(workspace_id,'moderator'))) WITH CHECK(readable_revision(workspace_id,object_id,revision));
CREATE POLICY lifecycle_read ON lifecycle_events FOR SELECT TO ideator_app USING(readable_revision(workspace_id,object_id,revision));
CREATE POLICY lifecycle_insert ON lifecycle_events FOR INSERT TO ideator_app WITH CHECK(readable_revision(workspace_id,object_id,revision) AND actor_id=actor());
CREATE POLICY reviews_read ON reviews FOR SELECT TO ideator_app USING(readable_revision(workspace_id,object_id,revision));
CREATE POLICY reviews_insert ON reviews FOR INSERT TO ideator_app WITH CHECK(readable_revision(workspace_id,object_id,revision) AND reviewer_id=actor() AND has_role(workspace_id,'reviewer') AND NOT object_author(workspace_id,object_id));
CREATE POLICY edge_read ON edges FOR SELECT TO ideator_app USING(member(workspace_id));
CREATE POLICY edge_insert ON edges FOR INSERT TO ideator_app WITH CHECK(member(workspace_id) AND author_id=actor());
CREATE POLICY edge_update ON edges FOR UPDATE TO ideator_app USING(member(workspace_id) AND (author_id=actor() OR has_role(workspace_id,'moderator'))) WITH CHECK(member(workspace_id));
CREATE POLICY er_read ON edge_revisions FOR SELECT TO ideator_app USING(member(workspace_id) AND published(workspace_id,from_id,from_revision) AND published(workspace_id,to_id,to_revision));
CREATE POLICY er_insert ON edge_revisions FOR INSERT TO ideator_app WITH CHECK(member(workspace_id) AND actor_id=actor() AND EXISTS(SELECT 1 FROM edges WHERE id=edge_id AND (author_id=actor() OR has_role(workspace_id,'moderator'))));
CREATE POLICY lineage_read ON lineage FOR SELECT TO ideator_app USING(member(workspace_id) AND published(workspace_id,derived_id,derived_revision) AND published(workspace_id,input_id,input_revision));
CREATE POLICY lineage_insert ON lineage FOR INSERT TO ideator_app WITH CHECK(member(workspace_id) AND published(workspace_id,derived_id,derived_revision) AND published(workspace_id,input_id,input_revision));
CREATE POLICY freshness_read ON revision_freshness FOR SELECT TO ideator_app USING(member(workspace_id) AND published(workspace_id,object_id,revision));
CREATE POLICY equivalence_read ON equivalences FOR SELECT TO ideator_app USING(member(workspace_id));
CREATE POLICY equivalence_insert ON equivalences FOR INSERT TO ideator_app WITH CHECK(member(workspace_id) AND author_id=actor());
CREATE POLICY equivalence_update ON equivalences FOR UPDATE TO ideator_app USING(member(workspace_id) AND has_role(workspace_id,'reviewer')) WITH CHECK(member(workspace_id));
CREATE POLICY eq_decision_read ON equivalence_decisions FOR SELECT TO ideator_app USING(member(workspace_id));
CREATE POLICY eq_decision_insert ON equivalence_decisions FOR INSERT TO ideator_app WITH CHECK(member(workspace_id) AND actor_id=actor() AND has_role(workspace_id,'reviewer'));
CREATE POLICY cursor_owner ON graph_cursors TO ideator_app USING(member(workspace_id) AND actor_id=actor()) WITH CHECK(member(workspace_id) AND actor_id=actor());
GRANT SELECT,INSERT,UPDATE ON submissions,revision_status,edges,equivalences TO ideator_app;
GRANT SELECT,INSERT ON lifecycle_events,reviews,edge_revisions,lineage,equivalence_decisions TO ideator_app;
GRANT SELECT ON revision_freshness TO ideator_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON graph_cursors TO ideator_app;
CREATE FUNCTION bump_content_epoch(w uuid) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE v bigint; BEGIN IF NOT member(w) THEN RAISE insufficient_privilege; END IF;UPDATE workspaces SET content_epoch=content_epoch+1 WHERE id=w RETURNING content_epoch INTO v;RETURN v; END $$;
REVOKE ALL ON FUNCTION bump_content_epoch(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bump_content_epoch(uuid) TO ideator_app;
-- Narrow worker entry point. No direct read access to content is granted to its role.
CREATE FUNCTION refresh_freshness(w uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE current_epoch bigint; BEGIN
 SELECT content_epoch INTO current_epoch FROM workspaces WHERE id=w FOR UPDATE;
 IF current_epoch IS NULL THEN RETURN; END IF;
 WITH RECURSIVE active_lineage AS (
 SELECT l.* FROM lineage l LEFT JOIN edges e ON e.id=l.edge_id LEFT JOIN edge_revisions er ON er.edge_id=e.id AND er.revision=e.current_revision
 WHERE l.workspace_id=w AND (l.edge_id IS NULL OR er.state='active')
 ), stale(object_id,revision) AS (
 SELECT p.object_id,p.revision FROM publications p JOIN objects o ON o.id=p.object_id LEFT JOIN revision_status rs USING(workspace_id,object_id,revision)
 WHERE p.workspace_id=w AND (o.current_revision<>p.revision OR COALESCE(rs.validity,'active')<>'active')
 UNION
 SELECT l.derived_id,l.derived_revision FROM active_lineage l JOIN stale s ON s.object_id=l.input_id AND s.revision=l.input_revision
 )
 INSERT INTO revision_freshness(workspace_id,object_id,revision,epoch,status)
 SELECT p.workspace_id,p.object_id,p.revision,current_epoch,CASE WHEN s.object_id IS NULL THEN 'current' ELSE 'stale' END FROM publications p LEFT JOIN stale s USING(object_id,revision) WHERE p.workspace_id=w
 ON CONFLICT(workspace_id,object_id,revision) DO UPDATE SET epoch=excluded.epoch,status=excluded.status;
 END $$;
REVOKE ALL ON FUNCTION refresh_freshness(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refresh_freshness(uuid) TO ideator_worker;
-- Backfill old source references without changing immutable revision content.
INSERT INTO lineage(workspace_id,derived_id,derived_revision,input_id,input_revision)
 SELECT r.workspace_id,r.object_id,r.revision,(s->>'id')::uuid,(s->>'revision')::integer FROM publications p JOIN revisions r USING(workspace_id,object_id,revision) CROSS JOIN LATERAL jsonb_array_elements(r.content->'source_refs') s ON CONFLICT DO NOTHING;
