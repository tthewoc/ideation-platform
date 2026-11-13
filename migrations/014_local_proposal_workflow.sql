ALTER TABLE revisions DROP CONSTRAINT revisions_origin_check;
ALTER TABLE revisions ADD CHECK(origin IN ('human','ai'));
CREATE TABLE ai_usage(workspace_id uuid NOT NULL REFERENCES workspaces,day date NOT NULL DEFAULT current_date,allocated_units integer NOT NULL CHECK(allocated_units BETWEEN 0 AND 100000),PRIMARY KEY(workspace_id,day));
CREATE TABLE ai_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces,requester_id uuid NOT NULL REFERENCES users,reviewer_id uuid NOT NULL REFERENCES users,adapter text NOT NULL CHECK(adapter='fixture-v1'),instruction text NOT NULL,input_refs jsonb NOT NULL,state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','failed','cancelled','timed_out')),version integer NOT NULL DEFAULT 1,token uuid,input_budget integer NOT NULL,output_budget integer NOT NULL,input_units integer,output_units integer,manifest jsonb,policy_version integer NOT NULL,content_epoch bigint NOT NULL,deadline timestamptz NOT NULL DEFAULT now()+interval '60 seconds',created_at timestamptz NOT NULL DEFAULT now(),CHECK(requester_id<>reviewer_id));
CREATE TABLE ai_proposals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid UNIQUE NOT NULL REFERENCES ai_runs,workspace_id uuid NOT NULL REFERENCES workspaces,requester_id uuid NOT NULL REFERENCES users,reviewer_id uuid NOT NULL REFERENCES users,candidates jsonb NOT NULL,disposition text NOT NULL DEFAULT 'pending' CHECK(disposition IN ('pending','accepted','rejected','deferred','needs_evidence')),version integer NOT NULL DEFAULT 1,published_refs jsonb,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE ai_decisions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces,proposal_id uuid NOT NULL REFERENCES ai_proposals,actor_id uuid NOT NULL REFERENCES users,decision text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE ai_publications(workspace_id uuid NOT NULL,object_id uuid PRIMARY KEY,proposal_id uuid NOT NULL REFERENCES ai_proposals,FOREIGN KEY(workspace_id,object_id) REFERENCES objects(workspace_id,id));
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['ai_usage','ai_runs','ai_proposals','ai_decisions','ai_publications'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);END LOOP;END $$;
CREATE POLICY ai_usage_read ON ai_usage FOR SELECT TO ideator_app USING(member(workspace_id));
CREATE POLICY ai_run_read ON ai_runs FOR SELECT TO ideator_app USING(member(workspace_id) AND (requester_id=actor() OR reviewer_id=actor()));
CREATE POLICY ai_proposal_read ON ai_proposals FOR SELECT TO ideator_app USING(member(workspace_id) AND (requester_id=actor() OR reviewer_id=actor()));
CREATE POLICY ai_decision_read ON ai_decisions FOR SELECT TO ideator_app USING(member(workspace_id) AND EXISTS(SELECT 1 FROM ai_proposals p WHERE p.id=proposal_id));
CREATE POLICY ai_publication_read ON ai_publications FOR SELECT TO ideator_app USING(member(workspace_id));
GRANT SELECT ON ai_usage,ai_runs,ai_proposals,ai_decisions,ai_publications TO ideator_app;
CREATE FUNCTION queue_fixture_run(w uuid,reviewer uuid,instruction text,refs jsonb,input_limit integer,output_limit integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE ws workspaces; item jsonb; run uuid; BEGIN
 IF NOT member(w) OR reviewer=actor() OR NOT EXISTS(SELECT 1 FROM memberships WHERE workspace_id=w AND user_id=reviewer AND revoked_at IS NULL AND 'reviewer'=ANY(roles)) THEN RAISE insufficient_privilege;END IF;
 IF input_limit NOT BETWEEN 1 AND 16000 OR output_limit NOT BETWEEN 1 AND 2000 OR length(instruction) NOT BETWEEN 1 AND 2000 OR jsonb_array_length(refs) NOT BETWEEN 1 AND 20 THEN RAISE invalid_parameter_value;END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(refs) LOOP IF NOT retrievable_revision(w,(item->>'id')::uuid,(item->>'revision')::integer,false) THEN RAISE insufficient_privilege;END IF;END LOOP;
 SELECT * INTO ws FROM workspaces WHERE id=w;
 INSERT INTO ai_usage(workspace_id,allocated_units) VALUES(w,input_limit+output_limit) ON CONFLICT(workspace_id,day) DO UPDATE SET allocated_units=ai_usage.allocated_units+excluded.allocated_units;
 INSERT INTO ai_runs(workspace_id,requester_id,reviewer_id,adapter,instruction,input_refs,input_budget,output_budget,policy_version,content_epoch) VALUES(w,actor(),reviewer,'fixture-v1',instruction,refs,input_limit,output_limit,ws.version,ws.content_epoch) RETURNING id INTO run;RETURN run;
END $$;
CREATE FUNCTION cancel_fixture_run(w uuid,run uuid,expected integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE r ai_runs; BEGIN
 SELECT * INTO r FROM ai_runs WHERE id=run AND workspace_id=w FOR UPDATE;
 IF NOT member(w) OR r.requester_id IS DISTINCT FROM actor() THEN RAISE insufficient_privilege; END IF;
 IF r.version<>expected OR r.state NOT IN ('queued','running') THEN RAISE serialization_failure;END IF;
 UPDATE ai_runs SET state='cancelled',token=NULL,version=version+1 WHERE id=run;
END $$;
CREATE FUNCTION claim_fixture_run() RETURNS SETOF ai_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE r ai_runs; ws workspaces; manifest jsonb; n integer; BEGIN
 SELECT * INTO r FROM ai_runs WHERE state='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;IF NOT FOUND THEN RETURN;END IF;
 PERFORM set_config('app.actor',r.requester_id::text,true);SELECT * INTO ws FROM workspaces WHERE id=r.workspace_id;
 IF r.deadline<=now() THEN UPDATE ai_runs SET state='timed_out',version=version+1 WHERE id=r.id;RETURN;END IF;
 IF NOT member(r.workspace_id) OR ws.version<>r.policy_version OR ws.content_epoch<>r.content_epoch OR NOT EXISTS(SELECT 1 FROM memberships WHERE workspace_id=r.workspace_id AND user_id=r.reviewer_id AND revoked_at IS NULL AND 'reviewer'=ANY(roles)) THEN UPDATE ai_runs SET state='failed',version=version+1 WHERE id=r.id;RETURN;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(r.input_refs) x WHERE NOT retrievable_revision(r.workspace_id,(x->>'id')::uuid,(x->>'revision')::integer,false)) THEN UPDATE ai_runs SET state='failed',version=version+1 WHERE id=r.id;RETURN;END IF;
 SELECT jsonb_agg(jsonb_build_object('id',v.object_id,'revision',v.revision,'type',o.type,'content',v.content) ORDER BY v.object_id,v.revision) INTO manifest FROM jsonb_array_elements(r.input_refs) x JOIN revisions v ON v.workspace_id=r.workspace_id AND v.object_id=(x->>'id')::uuid AND v.revision=(x->>'revision')::integer JOIN objects o ON o.id=v.object_id;
 n:=octet_length(manifest::text)+octet_length(r.instruction);
 IF n>r.input_budget THEN UPDATE ai_runs SET state='failed',input_units=n,version=version+1 WHERE id=r.id;RETURN;END IF;
 UPDATE ai_runs SET state='running',token=gen_random_uuid(),manifest=claim_fixture_run.manifest,input_units=n,version=version+1 WHERE id=r.id RETURNING * INTO r;RETURN NEXT r;
END $$;
CREATE FUNCTION finish_fixture_run(run uuid,lease uuid,candidate jsonb,output_units integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE r ai_runs; ws workspaces; BEGIN
 SELECT * INTO r FROM ai_runs WHERE id=run;IF NOT FOUND THEN RETURN false;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.workspace_id::text,0));
 SELECT * INTO r FROM ai_runs WHERE id=run FOR UPDATE;IF r.state<>'running' OR r.token IS DISTINCT FROM lease THEN RETURN false;END IF;
 PERFORM set_config('app.actor',r.requester_id::text,true);SELECT * INTO ws FROM workspaces WHERE id=r.workspace_id;
 IF r.deadline<=now() THEN UPDATE ai_runs SET state='timed_out',token=NULL,version=version+1 WHERE id=run;RETURN false;END IF;
 IF NOT member(r.workspace_id) OR ws.version<>r.policy_version OR ws.content_epoch<>r.content_epoch OR output_units>r.output_budget OR output_units<0 OR jsonb_array_length(candidate) NOT BETWEEN 1 AND 10 THEN UPDATE ai_runs SET state='failed',token=NULL,version=version+1 WHERE id=run;RETURN false;END IF;
 INSERT INTO ai_proposals(run_id,workspace_id,requester_id,reviewer_id,candidates) VALUES(run,r.workspace_id,r.requester_id,r.reviewer_id,candidate);
 UPDATE ai_runs SET state='succeeded',token=NULL,output_units=finish_fixture_run.output_units,version=version+1 WHERE id=run;RETURN true;
END $$;
CREATE FUNCTION fail_fixture_run(run uuid,lease uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ UPDATE ai_runs SET state=CASE WHEN deadline<=now() THEN 'timed_out' ELSE 'failed' END,token=NULL,version=version+1 WHERE id=run AND token=lease AND state='running' $$;
CREATE FUNCTION expire_fixture_runs() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ UPDATE ai_runs SET state='timed_out',token=NULL,version=version+1 WHERE deadline<=now() AND state IN ('queued','running') $$;
CREATE FUNCTION decide_fixture_proposal(w uuid,proposal uuid,expected integer,decision text,why text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE p ai_proposals; BEGIN
 SELECT * INTO p FROM ai_proposals WHERE id=proposal AND workspace_id=w FOR UPDATE;
 IF NOT member(w) OR p.reviewer_id IS DISTINCT FROM actor() OR NOT has_role(w,'reviewer') OR p.requester_id=actor() THEN RAISE insufficient_privilege;END IF;
 IF p.version<>expected OR p.disposition<>'pending' OR decision NOT IN ('accepted','rejected','deferred','needs_evidence') OR length(why) NOT BETWEEN 1 AND 4000 THEN RAISE serialization_failure;END IF;
 INSERT INTO ai_decisions(workspace_id,proposal_id,actor_id,decision,reason) VALUES(w,proposal,actor(),decision,why);
 UPDATE ai_proposals SET disposition=decision,version=version+1 WHERE id=proposal;
END $$;
CREATE FUNCTION publish_fixture_proposal(w uuid,proposal uuid,expected integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE p ai_proposals;r ai_runs;ws workspaces;c jsonb;refs jsonb:='[]';obj uuid;input jsonb;BEGIN
 SELECT * INTO p FROM ai_proposals WHERE id=proposal AND workspace_id=w FOR UPDATE;
 IF NOT member(w) OR p.requester_id IS DISTINCT FROM actor() THEN RAISE insufficient_privilege;END IF;
 SELECT * INTO r FROM ai_runs WHERE id=p.run_id;SELECT * INTO ws FROM workspaces WHERE id=w;
 IF p.version<>expected OR p.disposition<>'accepted' OR p.published_refs IS NOT NULL OR r.state<>'succeeded' OR ws.version<>r.policy_version OR ws.content_epoch<>r.content_epoch OR NOT EXISTS(SELECT 1 FROM memberships WHERE workspace_id=w AND user_id=p.reviewer_id AND revoked_at IS NULL AND 'reviewer'=ANY(roles)) THEN RAISE serialization_failure;END IF;
 FOR input IN SELECT * FROM jsonb_array_elements(r.input_refs) LOOP
 IF NOT retrievable_revision(w,(input->>'id')::uuid,(input->>'revision')::integer,false) OR NOT EXISTS(SELECT 1 FROM objects o LEFT JOIN revision_status s ON s.object_id=o.id AND s.revision=o.current_revision WHERE o.workspace_id=w AND o.id=(input->>'id')::uuid AND o.current_revision=(input->>'revision')::integer AND COALESCE(s.validity,'active')='active') THEN RAISE insufficient_privilege;END IF;
 END LOOP;
 FOR c IN SELECT * FROM jsonb_array_elements(p.candidates) LOOP
 IF c->>'type'<>'claim' OR c->'content'->'source_refs'<>r.input_refs THEN RAISE check_violation;END IF;
 obj:=gen_random_uuid();INSERT INTO objects(id,workspace_id,type,author_id,current_revision,next_revision) VALUES(obj,w,'claim',actor(),NULL,2);
 INSERT INTO revisions(workspace_id,object_id,revision,content,origin,actor_id,reason) VALUES(w,obj,1,c->'content','ai',actor(),'Explicit publication of accepted local fixture proposal; no model inference');
 INSERT INTO publications(workspace_id,object_id,revision,published_by) VALUES(w,obj,1,actor());UPDATE objects SET current_revision=1 WHERE id=obj;
 INSERT INTO ai_publications VALUES(w,obj,proposal);
 FOR input IN SELECT * FROM jsonb_array_elements(r.input_refs) LOOP INSERT INTO lineage(workspace_id,derived_id,derived_revision,input_id,input_revision) VALUES(w,obj,1,(input->>'id')::uuid,(input->>'revision')::integer) ON CONFLICT DO NOTHING;END LOOP;
 refs:=refs||jsonb_build_array(jsonb_build_object('id',obj,'revision',1));
 END LOOP;
 UPDATE ai_proposals SET published_refs=refs,version=version+1 WHERE id=proposal;PERFORM bump_content_epoch(w);RETURN refs;
END $$;
REVOKE ALL ON FUNCTION queue_fixture_run(uuid,uuid,text,jsonb,integer,integer),cancel_fixture_run(uuid,uuid,integer),claim_fixture_run(),finish_fixture_run(uuid,uuid,jsonb,integer),fail_fixture_run(uuid,uuid),expire_fixture_runs(),decide_fixture_proposal(uuid,uuid,integer,text,text),publish_fixture_proposal(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION queue_fixture_run(uuid,uuid,text,jsonb,integer,integer),cancel_fixture_run(uuid,uuid,integer),decide_fixture_proposal(uuid,uuid,integer,text,text),publish_fixture_proposal(uuid,uuid,integer) TO ideator_app;
GRANT EXECUTE ON FUNCTION claim_fixture_run(),finish_fixture_run(uuid,uuid,jsonb,integer),fail_fixture_run(uuid,uuid),expire_fixture_runs() TO ideator_worker;
