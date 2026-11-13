CREATE TABLE search_state(workspace_id uuid PRIMARY KEY REFERENCES workspaces,active_generation uuid,active_epoch bigint,building_generation uuid,building_epoch bigint,last_id uuid,requested boolean NOT NULL DEFAULT true,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE search_documents(workspace_id uuid NOT NULL, generation uuid NOT NULL,object_id uuid NOT NULL,revision integer NOT NULL,document tsvector NOT NULL,PRIMARY KEY(workspace_id,generation,object_id),FOREIGN KEY(workspace_id,object_id,revision) REFERENCES publications(workspace_id,object_id,revision));
CREATE INDEX search_terms ON search_documents USING gin(document);
CREATE TABLE search_cursors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces,actor_id uuid NOT NULL REFERENCES users,policy_version integer NOT NULL,content_epoch bigint NOT NULL,generation uuid NOT NULL,query jsonb NOT NULL,last_score numeric NOT NULL,last_id uuid NOT NULL,expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes');
CREATE TABLE export_policies(workspace_id uuid NOT NULL,object_id uuid NOT NULL,revision integer NOT NULL,allowed boolean NOT NULL,reason text NOT NULL,actor_id uuid NOT NULL REFERENCES users,version integer NOT NULL DEFAULT 1,PRIMARY KEY(workspace_id,object_id,revision),FOREIGN KEY(workspace_id,object_id,revision) REFERENCES publications(workspace_id,object_id,revision));
CREATE TABLE export_policy_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,object_id uuid NOT NULL,revision integer NOT NULL,allowed boolean NOT NULL,reason text NOT NULL,actor_id uuid NOT NULL REFERENCES users,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(workspace_id,object_id,revision) REFERENCES publications(workspace_id,object_id,revision));
CREATE TABLE export_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces,actor_id uuid NOT NULL REFERENCES users,roots jsonb NOT NULL,state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','ready','denied','failed')),manifest jsonb,policy_version integer,content_epoch bigint,warning boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours');
CREATE INDEX export_pending ON export_jobs(created_at) WHERE state='queued';
-- Vector projection foundation only: no model or provider is enabled by this migration.
CREATE TABLE embedding_models(version text PRIMARY KEY,dimensions integer NOT NULL CHECK(dimensions BETWEEN 1 AND 4096),enabled boolean NOT NULL DEFAULT false);
CREATE TABLE revision_embeddings(workspace_id uuid NOT NULL,object_id uuid NOT NULL,revision integer NOT NULL,model_version text NOT NULL REFERENCES embedding_models,content_sha256 text NOT NULL,dimensions integer NOT NULL,values real[] NOT NULL,validated_epoch bigint NOT NULL,PRIMARY KEY(workspace_id,object_id,revision,model_version),CHECK(array_ndims(values)=1 AND cardinality(values)=dimensions),FOREIGN KEY(workspace_id,object_id,revision) REFERENCES publications(workspace_id,object_id,revision));
-- Bounded closure uses immutable publication lineage, including retracted derivation
-- provenance: withdrawing a link does not grant export rights to its old source.
CREATE FUNCTION revision_closure(w uuid,o uuid,r integer) RETURNS TABLE(object_id uuid,revision integer) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH RECURSIVE refs(object_id,revision) AS (
 SELECT o,r UNION SELECT l.input_id,l.input_revision FROM lineage l JOIN refs p ON p.object_id=l.derived_id AND p.revision=l.derived_revision WHERE l.workspace_id=w
 ) SELECT * FROM refs LIMIT 501
$$;
CREATE FUNCTION retrievable_revision(w uuid,o uuid,r integer,for_export boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH refs AS MATERIALIZED(SELECT * FROM revision_closure(w,o,r))
 SELECT member(w) AND (SELECT count(*)<=500 FROM refs) AND NOT EXISTS(
 SELECT 1 FROM refs x LEFT JOIN publications p ON p.workspace_id=w AND p.object_id=x.object_id AND p.revision=x.revision LEFT JOIN objects obj ON obj.id=x.object_id LEFT JOIN artifacts a ON a.object_id=x.object_id LEFT JOIN export_policies ep ON ep.workspace_id=w AND ep.object_id=x.object_id AND ep.revision=x.revision
 WHERE p.object_id IS NULL OR (obj.type='artifact' AND a.state IS DISTINCT FROM 'available') OR (for_export AND NOT COALESCE(ep.allowed,obj.type<>'artifact')))
$$;
REVOKE ALL ON FUNCTION revision_closure(uuid,uuid,integer),retrievable_revision(uuid,uuid,integer,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retrievable_revision(uuid,uuid,integer,boolean) TO ideator_app;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['search_state','search_documents','search_cursors','export_policies','export_policy_events','export_jobs','revision_embeddings'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t); END LOOP; END $$;
CREATE POLICY search_state_read ON search_state FOR SELECT TO ideator_app USING(member(workspace_id));
CREATE POLICY search_doc_read ON search_documents FOR SELECT TO ideator_app USING(retrievable_revision(workspace_id,object_id,revision,false));
CREATE POLICY cursor_owner ON search_cursors TO ideator_app USING(member(workspace_id) AND actor_id=actor()) WITH CHECK(member(workspace_id) AND actor_id=actor());
CREATE POLICY export_policy_read ON export_policies FOR SELECT TO ideator_app USING(member(workspace_id));
CREATE POLICY export_policy_write ON export_policies FOR ALL TO ideator_app USING(member(workspace_id) AND (object_author(workspace_id,object_id) OR has_role(workspace_id,'moderator'))) WITH CHECK(member(workspace_id) AND actor_id=actor() AND (object_author(workspace_id,object_id) OR has_role(workspace_id,'moderator')));
CREATE POLICY export_policy_events_read ON export_policy_events FOR SELECT TO ideator_app USING(member(workspace_id));
CREATE POLICY export_policy_events_create ON export_policy_events FOR INSERT TO ideator_app WITH CHECK(member(workspace_id) AND actor_id=actor());
CREATE POLICY export_owner_read ON export_jobs FOR SELECT TO ideator_app USING(member(workspace_id) AND actor_id=actor());
CREATE POLICY export_owner_create ON export_jobs FOR INSERT TO ideator_app WITH CHECK(member(workspace_id) AND actor_id=actor() AND state='queued' AND manifest IS NULL AND policy_version IS NULL AND content_epoch IS NULL);
CREATE POLICY embedding_read ON revision_embeddings FOR SELECT TO ideator_app USING(retrievable_revision(workspace_id,object_id,revision,false));
GRANT SELECT ON search_state,search_documents,revision_embeddings,embedding_models TO ideator_app;
GRANT SELECT,INSERT ON search_cursors,export_jobs,export_policy_events TO ideator_app;
GRANT SELECT,INSERT,UPDATE ON export_policies TO ideator_app;
CREATE FUNCTION enqueue_search() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 INSERT INTO search_state(workspace_id) VALUES(NEW.id) ON CONFLICT(workspace_id) DO UPDATE SET requested=true;RETURN NEW;
END $$;
CREATE TRIGGER search_epoch_change AFTER UPDATE OF content_epoch ON workspaces FOR EACH ROW WHEN(OLD.content_epoch IS DISTINCT FROM NEW.content_epoch) EXECUTE FUNCTION enqueue_search();
INSERT INTO search_state(workspace_id) SELECT id FROM workspaces;
CREATE FUNCTION request_search_rebuild(w uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF NOT has_role(w,'admin') THEN RAISE insufficient_privilege; END IF;
 INSERT INTO search_state(workspace_id) VALUES(w) ON CONFLICT(workspace_id) DO UPDATE SET requested=true;
END $$;
REVOKE ALL ON FUNCTION request_search_rebuild(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_search_rebuild(uuid) TO ideator_app;
CREATE FUNCTION rebuild_search_batch(w uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE s search_state; epoch bigint; last uuid; n integer; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(w::text,0));
 SELECT content_epoch INTO epoch FROM workspaces WHERE id=w;
 SELECT * INTO s FROM search_state WHERE workspace_id=w FOR UPDATE;
 IF NOT FOUND OR NOT s.requested THEN RETURN false; END IF;
 IF s.building_generation IS NULL OR s.building_epoch<>epoch THEN
  IF s.building_generation IS NOT NULL THEN DELETE FROM search_documents WHERE workspace_id=w AND generation=s.building_generation; END IF;
  UPDATE search_state SET building_generation=gen_random_uuid(),building_epoch=epoch,last_id=NULL WHERE workspace_id=w RETURNING * INTO s;
 END IF;
 WITH batch AS MATERIALIZED(SELECT o.id,o.current_revision,r.content FROM objects o JOIN revisions r ON r.workspace_id=o.workspace_id AND r.object_id=o.id AND r.revision=o.current_revision WHERE o.workspace_id=w AND (s.last_id IS NULL OR o.id>s.last_id) ORDER BY o.id LIMIT 500), inserted AS (
 INSERT INTO search_documents SELECT w,s.building_generation,id,current_revision,setweight(to_tsvector('simple',COALESCE(content->>'title','')),'A')||setweight(jsonb_to_tsvector('simple',content,'["string"]'),'B') FROM batch RETURNING object_id)
 SELECT count(*),(array_agg(object_id ORDER BY object_id DESC))[1] INTO n,last FROM inserted;
 IF n=500 THEN UPDATE search_state SET last_id=last,updated_at=now() WHERE workspace_id=w;
 ELSE
  UPDATE search_state SET active_generation=s.building_generation,active_epoch=epoch,building_generation=NULL,building_epoch=NULL,last_id=NULL,requested=false,updated_at=now() WHERE workspace_id=w;
  DELETE FROM search_documents WHERE workspace_id=w AND generation<>s.building_generation;
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION rebuild_search_batch(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rebuild_search_batch(uuid) TO ideator_worker;
CREATE FUNCTION pending_search_workspaces() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT workspace_id FROM search_state WHERE requested ORDER BY updated_at,workspace_id LIMIT 10 $$;
REVOKE ALL ON FUNCTION pending_search_workspaces() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pending_search_workspaces() TO ideator_worker;
CREATE FUNCTION prepare_export(job uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE j export_jobs; ws workspaces; pins jsonb; warned boolean; ev uuid; BEGIN
 SELECT * INTO j FROM export_jobs WHERE id=job;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(j.workspace_id::text,0));
 SELECT * INTO j FROM export_jobs WHERE id=job FOR UPDATE;
 IF j.state<>'queued' THEN RETURN false; END IF;
 PERFORM set_config('app.actor',j.actor_id::text,true);
 IF NOT member(j.workspace_id) OR j.expires_at<=now() THEN UPDATE export_jobs SET state='denied',manifest=NULL WHERE id=job; RETURN true; END IF;
 SELECT * INTO ws FROM workspaces WHERE id=j.workspace_id;
 WITH roots AS MATERIALIZED(SELECT (v->>'id')::uuid id,(v->>'revision')::integer revision FROM jsonb_array_elements(j.roots) v), eligible AS MATERIALIZED(SELECT * FROM roots WHERE retrievable_revision(j.workspace_id,id,revision,true)), refs AS MATERIALIZED(SELECT DISTINCT x.* FROM eligible e CROSS JOIN LATERAL revision_closure(j.workspace_id,e.id,e.revision) x LIMIT 501)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',object_id,'revision',revision) ORDER BY object_id,revision),'[]'),(SELECT count(*) FROM roots)<>(SELECT count(*) FROM eligible) INTO pins,warned FROM refs;
 IF jsonb_array_length(pins)>500 THEN UPDATE export_jobs SET state='failed',manifest=NULL WHERE id=job;RETURN true; END IF;
 UPDATE export_jobs SET state='ready',manifest=pins,warning=warned,policy_version=ws.version,content_epoch=ws.content_epoch WHERE id=job;
 ev:=gen_random_uuid();INSERT INTO audit_events(id,workspace_id,actor_id,action,target_id,request_id) VALUES(ev,j.workspace_id,j.actor_id,'export.prepared',job,'export-worker');INSERT INTO outbox(event_id,workspace_id,kind,payload) VALUES(ev,j.workspace_id,'export.prepared',jsonb_build_object('target_id',job));RETURN true;
END $$;
CREATE FUNCTION pending_export_jobs() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT id FROM export_jobs WHERE state='queued' ORDER BY created_at LIMIT 5 $$;
REVOKE ALL ON FUNCTION prepare_export(uuid),pending_export_jobs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prepare_export(uuid),pending_export_jobs() TO ideator_worker;
CREATE FUNCTION record_embedding(w uuid,o uuid,r integer,model text,vec real[],fingerprint text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE dims integer; canonical text; epoch bigint; BEGIN
 SELECT dimensions INTO dims FROM embedding_models WHERE version=model AND enabled;
 SELECT encode(sha256(convert_to(rv.content::text,'UTF8')),'hex'),ws.content_epoch INTO canonical,epoch FROM revisions rv JOIN objects ob ON ob.id=rv.object_id AND ob.current_revision=rv.revision JOIN workspaces ws ON ws.id=rv.workspace_id WHERE rv.workspace_id=w AND rv.object_id=o AND rv.revision=r;
 IF dims IS NULL OR canonical IS NULL OR canonical<>fingerprint OR cardinality(vec)<>dims OR array_ndims(vec)<>1 OR EXISTS(SELECT 1 FROM unnest(vec) v WHERE v IS NULL OR v IN ('NaN'::real,'Infinity'::real,'-Infinity'::real)) THEN RAISE invalid_parameter_value; END IF;
 INSERT INTO revision_embeddings VALUES(w,o,r,model,fingerprint,dims,vec,epoch) ON CONFLICT(workspace_id,object_id,revision,model_version) DO UPDATE SET values=excluded.values,validated_epoch=excluded.validated_epoch,content_sha256=excluded.content_sha256;
END $$;
REVOKE ALL ON FUNCTION record_embedding(uuid,uuid,integer,text,real[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_embedding(uuid,uuid,integer,text,real[],text) TO ideator_worker;
