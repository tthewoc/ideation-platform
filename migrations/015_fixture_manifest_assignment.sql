CREATE OR REPLACE FUNCTION claim_fixture_run() RETURNS SETOF ai_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE r ai_runs; ws workspaces; input_manifest jsonb; n integer; BEGIN
 SELECT * INTO r FROM ai_runs WHERE state='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;IF NOT FOUND THEN RETURN;END IF;
 PERFORM set_config('app.actor',r.requester_id::text,true);SELECT * INTO ws FROM workspaces WHERE id=r.workspace_id;
 IF r.deadline<=now() THEN UPDATE ai_runs SET state='timed_out',version=version+1 WHERE id=r.id;RETURN;END IF;
 IF NOT member(r.workspace_id) OR ws.version<>r.policy_version OR ws.content_epoch<>r.content_epoch OR NOT EXISTS(SELECT 1 FROM memberships WHERE workspace_id=r.workspace_id AND user_id=r.reviewer_id AND revoked_at IS NULL AND 'reviewer'=ANY(roles)) THEN UPDATE ai_runs SET state='failed',version=version+1 WHERE id=r.id;RETURN;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(r.input_refs) x WHERE NOT retrievable_revision(r.workspace_id,(x->>'id')::uuid,(x->>'revision')::integer,false)) THEN UPDATE ai_runs SET state='failed',version=version+1 WHERE id=r.id;RETURN;END IF;
 SELECT jsonb_agg(jsonb_build_object('id',v.object_id,'revision',v.revision,'type',o.type,'content',v.content) ORDER BY v.object_id,v.revision) INTO input_manifest FROM jsonb_array_elements(r.input_refs) x JOIN revisions v ON v.workspace_id=r.workspace_id AND v.object_id=(x->>'id')::uuid AND v.revision=(x->>'revision')::integer JOIN objects o ON o.id=v.object_id;
 n:=octet_length(input_manifest::text)+octet_length(r.instruction);
 IF n>r.input_budget THEN UPDATE ai_runs SET state='failed',input_units=n,version=version+1 WHERE id=r.id;RETURN;END IF;
 UPDATE ai_runs SET state='running',token=gen_random_uuid(),manifest=input_manifest,input_units=n,version=version+1 WHERE id=r.id RETURNING * INTO r;RETURN NEXT r;
END $$;
