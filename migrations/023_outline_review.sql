CREATE TABLE intake_review_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, session_id uuid NOT NULL, outline_revision integer NOT NULL,
 author_id uuid NOT NULL REFERENCES users,reviewer_id uuid NOT NULL REFERENCES users,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','decided','revoked')),version integer NOT NULL DEFAULT 1,
 purpose text NOT NULL CHECK(length(purpose) BETWEEN 1 AND 4000),revoke_reason text,
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),CHECK(author_id<>reviewer_id),
 FOREIGN KEY(workspace_id,session_id) REFERENCES intake_sessions(workspace_id,id),
 FOREIGN KEY(session_id,outline_revision) REFERENCES intake_outline_revisions(session_id,revision)
);
CREATE INDEX intake_review_scope ON intake_review_requests(workspace_id,id);
CREATE INDEX intake_review_session ON intake_review_requests(session_id);
CREATE TABLE intake_review_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid UNIQUE NOT NULL REFERENCES intake_review_requests,
 workspace_id uuid NOT NULL REFERENCES workspaces,reviewer_id uuid NOT NULL REFERENCES users,
 disposition text NOT NULL CHECK(disposition IN ('accepted','rejected','deferred','needs_evidence')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 4000),conflict_declaration text NOT NULL CHECK(conflict_declaration='none'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION outline_review_sources_available(w uuid,s uuid,r integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT member(w) AND EXISTS(SELECT 1 FROM intake_outline_revisions v WHERE v.workspace_id=w AND v.session_id=s AND v.revision=r)
 AND NOT EXISTS(
 SELECT 1 FROM intake_outline_sources m JOIN intake_turns t ON t.session_id=m.session_id AND t.id=m.turn_id
 CROSS JOIN LATERAL jsonb_array_elements(t.attachment_refs) a
 WHERE m.workspace_id=w AND m.session_id=s AND m.outline_revision=r
 AND (NOT retrievable_revision(w,(a->>'id')::uuid,(a->>'revision')::integer,false) OR NOT EXISTS(SELECT 1 FROM artifacts f WHERE f.workspace_id=w AND f.object_id=(a->>'id')::uuid AND f.kind='digital' AND f.state='available' AND f.scan_verdict='clean')))
$$;
CREATE FUNCTION outline_review_readable(w uuid,review uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT member(w) AND EXISTS(SELECT 1 FROM intake_review_requests r WHERE r.workspace_id=w AND r.id=review
 AND (r.author_id=actor() OR (r.reviewer_id=actor() AND has_role(w,'reviewer') AND r.state<>'revoked' AND r.expires_at>clock_timestamp()
 AND EXISTS(SELECT 1 FROM memberships m WHERE m.workspace_id=w AND m.user_id=r.author_id AND m.revoked_at IS NULL)
 AND outline_review_sources_available(w,r.session_id,r.outline_revision))))
$$;
ALTER TABLE intake_review_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_review_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE intake_review_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_review_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY intake_review_read ON intake_review_requests FOR SELECT TO ideator_app USING(outline_review_readable(workspace_id,id));
CREATE POLICY intake_review_decision_read ON intake_review_decisions FOR SELECT TO ideator_app USING(outline_review_readable(workspace_id,request_id) AND EXISTS(SELECT 1 FROM intake_review_requests r WHERE r.id=request_id AND outline_review_sources_available(r.workspace_id,r.session_id,r.outline_revision)));
-- Grant only non-content request metadata: purpose and revocation reasons stay in the checked packet function.
GRANT SELECT(id,workspace_id,session_id,outline_revision,author_id,reviewer_id,state,version,expires_at,created_at) ON intake_review_requests TO ideator_app;
GRANT SELECT ON intake_review_decisions TO ideator_app;
CREATE FUNCTION request_outline_review(w uuid,s uuid,expected integer,revision integer,reviewer uuid,days integer,why text,request text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE session intake_sessions;review uuid;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(w::text,0));
 IF NOT intake_session_readable(w,s) OR reviewer IS NULL OR reviewer=actor() OR NOT EXISTS(SELECT 1 FROM memberships WHERE workspace_id=w AND user_id=reviewer AND revoked_at IS NULL AND 'reviewer'=ANY(roles)) THEN RAISE insufficient_privilege;END IF;
 SELECT * INTO session FROM intake_sessions WHERE workspace_id=w AND id=s FOR UPDATE;
 IF session.version IS DISTINCT FROM expected THEN RAISE serialization_failure;END IF;
 IF days IS NULL OR days NOT BETWEEN 1 AND 30 OR why IS NULL OR length(btrim(why)) NOT BETWEEN 1 AND 4000 OR NOT EXISTS(SELECT 1 FROM intake_outline_revisions WHERE session_id=s AND intake_outline_revisions.revision=request_outline_review.revision AND jsonb_array_length(items)>0) THEN RAISE invalid_parameter_value;END IF;
 IF NOT outline_review_sources_available(w,s,revision) THEN RAISE insufficient_privilege;END IF;
 IF (SELECT count(*) FROM intake_review_requests WHERE session_id=s)>=20 THEN RAISE check_violation USING MESSAGE='Outline review request limit reached';END IF;
 INSERT INTO intake_review_requests(workspace_id,session_id,outline_revision,author_id,reviewer_id,purpose,expires_at) VALUES(w,s,revision,actor(),reviewer,why,clock_timestamp()+make_interval(days=>days)) RETURNING id INTO review;
 UPDATE intake_sessions SET version=version+1 WHERE id=s;
 PERFORM intake_audit(w,review,'intake.review_requested',request);RETURN review;
END $$;
CREATE FUNCTION outline_review_packet(w uuid,review uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r intake_review_requests;outline jsonb;sources jsonb;decision jsonb;BEGIN
 IF NOT outline_review_readable(w,review) THEN RAISE insufficient_privilege;END IF;
 SELECT * INTO r FROM intake_review_requests WHERE workspace_id=w AND id=review;
 IF NOT outline_review_sources_available(w,r.session_id,r.outline_revision) THEN RAISE insufficient_privilege;END IF;
 SELECT jsonb_build_object('revision',revision,'items',items,'origin',origin) INTO outline FROM intake_outline_revisions WHERE session_id=r.session_id AND revision=r.outline_revision;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',t.id,'sequence',t.sequence,'original_text',t.original_text,'attachment_refs',t.attachment_refs) ORDER BY t.sequence),'[]') INTO sources FROM intake_turns t WHERE t.session_id=r.session_id AND EXISTS(SELECT 1 FROM intake_outline_sources m WHERE m.session_id=r.session_id AND m.outline_revision=r.outline_revision AND m.turn_id=t.id);
 SELECT jsonb_build_object('id',id,'reviewer_id',reviewer_id,'disposition',disposition,'reason',reason,'conflict_declaration',conflict_declaration,'created_at',created_at) INTO decision FROM intake_review_decisions WHERE request_id=review;
 RETURN jsonb_build_object('id',r.id,'author_id',r.author_id,'reviewer_id',r.reviewer_id,'state',r.state,'version',r.version,'expires_at',r.expires_at,'expired',r.expires_at<=clock_timestamp(),'purpose',r.purpose,'revoke_reason',r.revoke_reason,'outline',outline,'source_turns',sources,'decision',decision);
END $$;
CREATE FUNCTION decide_outline_review(w uuid,review uuid,expected integer,choice text,why text,conflict text,request text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r intake_review_requests;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(w::text,0));
 IF NOT outline_review_readable(w,review) OR NOT has_role(w,'reviewer') THEN RAISE insufficient_privilege;END IF;
 SELECT * INTO r FROM intake_review_requests WHERE workspace_id=w AND id=review FOR UPDATE;
 IF r.reviewer_id IS DISTINCT FROM actor() OR r.author_id=actor() THEN RAISE insufficient_privilege;END IF;
 IF r.version IS DISTINCT FROM expected OR r.state<>'pending' OR r.expires_at<=clock_timestamp() THEN RAISE serialization_failure;END IF;
 IF choice IS NULL OR choice NOT IN ('accepted','rejected','deferred','needs_evidence') OR why IS NULL OR length(btrim(why)) NOT BETWEEN 1 AND 4000 OR conflict IS DISTINCT FROM 'none' THEN RAISE invalid_parameter_value;END IF;
 INSERT INTO intake_review_decisions(request_id,workspace_id,reviewer_id,disposition,reason,conflict_declaration) VALUES(review,w,actor(),choice,why,conflict);
 UPDATE intake_review_requests SET state='decided',version=version+1 WHERE id=review;
 PERFORM intake_audit(w,review,'intake.review_decided',request);
END $$;
CREATE FUNCTION revoke_outline_review(w uuid,review uuid,expected integer,why text,request text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r intake_review_requests;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(w::text,0));
 SELECT * INTO r FROM intake_review_requests WHERE workspace_id=w AND id=review FOR UPDATE;
 IF NOT member(w) OR r.author_id IS DISTINCT FROM actor() THEN RAISE insufficient_privilege;END IF;
 IF r.version IS DISTINCT FROM expected OR r.state='revoked' THEN RAISE serialization_failure;END IF;
 IF why IS NULL OR length(btrim(why)) NOT BETWEEN 1 AND 4000 THEN RAISE invalid_parameter_value;END IF;
 UPDATE intake_review_requests SET state='revoked',revoke_reason=why,version=version+1 WHERE id=review;
 PERFORM intake_audit(w,review,'intake.review_revoked',request);
END $$;
REVOKE ALL ON FUNCTION outline_review_sources_available(uuid,uuid,integer),outline_review_readable(uuid,uuid),request_outline_review(uuid,uuid,integer,integer,uuid,integer,text,text),outline_review_packet(uuid,uuid),decide_outline_review(uuid,uuid,integer,text,text,text,text),revoke_outline_review(uuid,uuid,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outline_review_readable(uuid,uuid),request_outline_review(uuid,uuid,integer,integer,uuid,integer,text,text),outline_review_packet(uuid,uuid),decide_outline_review(uuid,uuid,integer,text,text,text,text),revoke_outline_review(uuid,uuid,integer,text,text) TO ideator_app;
