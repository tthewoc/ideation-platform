CREATE TABLE intake_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces,
 author_id uuid NOT NULL REFERENCES users, title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 active_turn uuid, next_sequence integer NOT NULL DEFAULT 1 CHECK(next_sequence BETWEEN 1 AND 201),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id)
);
CREATE TABLE intake_turns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, session_id uuid NOT NULL,
 sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 200), parent_turn uuid,
 speaker text NOT NULL DEFAULT 'human' CHECK(speaker='human'), original_text text NOT NULL CHECK(length(original_text)<=8000),
 attachment_refs jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(attachment_refs)='array' AND jsonb_array_length(attachment_refs)<=10),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(session_id,id), UNIQUE(session_id,sequence),
 FOREIGN KEY(workspace_id,session_id) REFERENCES intake_sessions(workspace_id,id),
 FOREIGN KEY(session_id,parent_turn) REFERENCES intake_turns(session_id,id)
);
ALTER TABLE intake_sessions ADD FOREIGN KEY(id,active_turn) REFERENCES intake_turns(session_id,id);
CREATE TABLE intake_undo_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, session_id uuid NOT NULL,
 from_turn uuid, target_turn uuid, reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 4000),
 actor_id uuid NOT NULL REFERENCES users, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,session_id) REFERENCES intake_sessions(workspace_id,id),
 FOREIGN KEY(session_id,from_turn) REFERENCES intake_turns(session_id,id),
 FOREIGN KEY(session_id,target_turn) REFERENCES intake_turns(session_id,id)
);
CREATE INDEX intake_session_author ON intake_sessions(workspace_id,author_id,id);
CREATE INDEX intake_undo_session ON intake_undo_events(session_id,created_at,id);
CREATE FUNCTION intake_attachment_readable(w uuid,o uuid,r integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT member(w) AND readable_revision(w,o,r) AND EXISTS(
 SELECT 1 FROM artifacts a JOIN revisions v ON v.workspace_id=a.workspace_id AND v.object_id=a.object_id AND v.revision=r
 WHERE a.workspace_id=w AND a.object_id=o AND a.kind='digital' AND a.state='available' AND a.scan_verdict='clean')
$$;
CREATE FUNCTION intake_session_readable(w uuid,s uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT member(w) AND EXISTS(SELECT 1 FROM intake_sessions x WHERE x.workspace_id=w AND x.id=s AND x.author_id=actor())
 AND NOT EXISTS(SELECT 1 FROM intake_turns t CROSS JOIN LATERAL jsonb_array_elements(t.attachment_refs) a WHERE t.workspace_id=w AND t.session_id=s AND NOT intake_attachment_readable(w,(a->>'id')::uuid,(a->>'revision')::integer))
$$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['intake_sessions','intake_turns','intake_undo_events'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 END LOOP; END $$;
CREATE POLICY intake_session_read ON intake_sessions FOR SELECT TO ideator_app USING(intake_session_readable(workspace_id,id));
CREATE POLICY intake_turn_read ON intake_turns FOR SELECT TO ideator_app USING(intake_session_readable(workspace_id,session_id));
CREATE POLICY intake_undo_read ON intake_undo_events FOR SELECT TO ideator_app USING(intake_session_readable(workspace_id,session_id));
GRANT SELECT ON intake_sessions,intake_turns,intake_undo_events TO ideator_app;
CREATE FUNCTION intake_audit(w uuid,s uuid,action text,request text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE event uuid:=gen_random_uuid(); BEGIN
 INSERT INTO audit_events(id,workspace_id,actor_id,action,target_id,request_id) VALUES(event,w,actor(),action,s,request);
 INSERT INTO outbox(event_id,workspace_id,kind,payload) VALUES(event,w,action,jsonb_build_object('target_id',s));
END $$;
CREATE FUNCTION create_intake_session(w uuid,title text,request text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE s uuid; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(w::text,0));
 IF NOT member(w) THEN RAISE insufficient_privilege;END IF;
 IF length(btrim(title)) NOT BETWEEN 1 AND 200 THEN RAISE invalid_parameter_value;END IF;
 IF (SELECT count(*) FROM intake_sessions WHERE workspace_id=w AND author_id=actor() AND created_at>now()-interval '1 day')>=50 THEN RAISE check_violation USING MESSAGE='Intake session limit reached';END IF;
 INSERT INTO intake_sessions(workspace_id,author_id,title) VALUES(w,actor(),title) RETURNING id INTO s;
 PERFORM intake_audit(w,s,'session.created',request);RETURN s;
END $$;
CREATE FUNCTION append_intake_turn(w uuid,s uuid,expected integer,parent uuid,original text,attachments jsonb,request text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE session intake_sessions; a jsonb;turn uuid; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(w::text,0));
 IF NOT intake_session_readable(w,s) THEN RAISE insufficient_privilege;END IF;
 SELECT * INTO session FROM intake_sessions WHERE workspace_id=w AND id=s FOR UPDATE;
 IF session.version IS DISTINCT FROM expected OR session.active_turn IS DISTINCT FROM parent THEN RAISE serialization_failure;END IF;
 IF original IS NULL OR length(original)>8000 OR attachments IS NULL OR jsonb_typeof(attachments)<>'array' OR jsonb_array_length(attachments)>10 OR (length(btrim(original))=0 AND jsonb_array_length(attachments)=0) THEN RAISE invalid_parameter_value;END IF;
 IF session.next_sequence>200 THEN RAISE check_violation USING MESSAGE='Intake turn limit reached';END IF;
 FOR a IN SELECT * FROM jsonb_array_elements(attachments) LOOP
 IF NOT intake_attachment_readable(w,(a->>'id')::uuid,(a->>'revision')::integer) THEN RAISE insufficient_privilege;END IF;
 END LOOP;
 INSERT INTO intake_turns(workspace_id,session_id,sequence,parent_turn,original_text,attachment_refs) VALUES(w,s,session.next_sequence,parent,original,attachments) RETURNING id INTO turn;
 UPDATE intake_sessions SET active_turn=turn,next_sequence=next_sequence+1,version=version+1 WHERE id=s;
 PERFORM intake_audit(w,s,'turn.recorded',request);RETURN turn;
END $$;
CREATE FUNCTION undo_intake_session(w uuid,s uuid,expected integer,target uuid,why text,request text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE session intake_sessions; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(w::text,0));
 IF NOT intake_session_readable(w,s) THEN RAISE insufficient_privilege;END IF;
 SELECT * INTO session FROM intake_sessions WHERE workspace_id=w AND id=s FOR UPDATE;
 IF session.version IS DISTINCT FROM expected OR session.active_turn IS NOT DISTINCT FROM target THEN RAISE serialization_failure;END IF;
 IF why IS NULL OR length(btrim(why)) NOT BETWEEN 1 AND 4000 OR (target IS NOT NULL AND NOT EXISTS(SELECT 1 FROM intake_turns WHERE session_id=s AND id=target)) THEN RAISE invalid_parameter_value;END IF;
 IF (SELECT count(*) FROM intake_undo_events WHERE session_id=s)>=200 THEN RAISE check_violation USING MESSAGE='Intake undo limit reached';END IF;
 INSERT INTO intake_undo_events(workspace_id,session_id,from_turn,target_turn,reason,actor_id) VALUES(w,s,session.active_turn,target,why,actor());
 UPDATE intake_sessions SET active_turn=target,version=version+1 WHERE id=s;
 PERFORM intake_audit(w,s,'session.undo_recorded',request);
END $$;
REVOKE ALL ON FUNCTION intake_attachment_readable(uuid,uuid,integer),intake_session_readable(uuid,uuid),intake_audit(uuid,uuid,text,text),create_intake_session(uuid,text,text),append_intake_turn(uuid,uuid,integer,uuid,text,jsonb,text),undo_intake_session(uuid,uuid,integer,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION intake_attachment_readable(uuid,uuid,integer),intake_session_readable(uuid,uuid),create_intake_session(uuid,text,text),append_intake_turn(uuid,uuid,integer,uuid,text,jsonb,text),undo_intake_session(uuid,uuid,integer,uuid,text,text) TO ideator_app;
