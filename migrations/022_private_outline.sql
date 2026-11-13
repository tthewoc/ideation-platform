ALTER TABLE intake_sessions ADD COLUMN outline_version integer NOT NULL DEFAULT 0 CHECK(outline_version BETWEEN 0 AND 50);
CREATE TABLE intake_outline_revisions (
 workspace_id uuid NOT NULL,session_id uuid NOT NULL,revision integer NOT NULL CHECK(revision BETWEEN 1 AND 50),
 items jsonb NOT NULL CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items)<=30),
 origin text NOT NULL DEFAULT 'human' CHECK(origin='human'),reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 4000),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(session_id,revision),
 FOREIGN KEY(workspace_id,session_id) REFERENCES intake_sessions(workspace_id,id)
);
CREATE TABLE intake_outline_sources (
 workspace_id uuid NOT NULL,session_id uuid NOT NULL,outline_revision integer NOT NULL,item_id uuid NOT NULL,turn_id uuid NOT NULL,
 PRIMARY KEY(session_id,outline_revision,item_id,turn_id),
 FOREIGN KEY(workspace_id,session_id) REFERENCES intake_sessions(workspace_id,id),
 FOREIGN KEY(session_id,outline_revision) REFERENCES intake_outline_revisions(session_id,revision),
 FOREIGN KEY(session_id,turn_id) REFERENCES intake_turns(session_id,id)
);
ALTER TABLE intake_outline_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_outline_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE intake_outline_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_outline_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY outline_read ON intake_outline_revisions FOR SELECT TO ideator_app USING(intake_session_readable(workspace_id,session_id));
CREATE POLICY outline_sources_read ON intake_outline_sources FOR SELECT TO ideator_app USING(intake_session_readable(workspace_id,session_id));
GRANT SELECT ON intake_outline_revisions,intake_outline_sources TO ideator_app;
CREATE FUNCTION save_intake_outline(w uuid,s uuid,expected integer,entries jsonb,why text,request text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE session intake_sessions;entry jsonb;source jsonb;revision integer; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(w::text,0));
 IF NOT intake_session_readable(w,s) THEN RAISE insufficient_privilege;END IF;
 SELECT * INTO session FROM intake_sessions WHERE workspace_id=w AND id=s FOR UPDATE;
 IF session.version IS DISTINCT FROM expected THEN RAISE serialization_failure;END IF;
 IF session.outline_version>=50 THEN RAISE check_violation USING MESSAGE='Outline revision limit reached';END IF;
 IF entries IS NULL OR jsonb_typeof(entries)<>'array' OR jsonb_array_length(entries)>30 OR why IS NULL OR length(btrim(why)) NOT BETWEEN 1 AND 4000 THEN RAISE invalid_parameter_value;END IF;
 IF (SELECT count(DISTINCT (x->>'id')::uuid) FROM jsonb_array_elements(entries) x)<>jsonb_array_length(entries) THEN RAISE invalid_parameter_value;END IF;
 FOR entry IN SELECT * FROM jsonb_array_elements(entries) LOOP
 IF jsonb_typeof(entry)<>'object' OR NOT entry ?& ARRAY['id','kind','text','basis','source_turn_ids','rationale','steps'] OR (SELECT count(*) FROM jsonb_object_keys(entry))<>7 THEN RAISE invalid_parameter_value;END IF;
 IF entry->>'kind' NOT IN ('claim','assumption','alternative_hypothesis','question','ethical_constraint','success_criterion','method','task') OR entry->>'basis' NOT IN ('quoted','human_conjecture','unknown') OR jsonb_typeof(entry->'kind')<>'string' OR jsonb_typeof(entry->'basis')<>'string' OR jsonb_typeof(entry->'text')<>'string' OR length(btrim(entry->>'text')) NOT BETWEEN 1 AND 1000 OR jsonb_typeof(entry->'rationale')<>'string' OR length(entry->>'rationale')>1000 OR jsonb_typeof(entry->'steps')<>'array' OR jsonb_array_length(entry->'steps')>5 OR jsonb_typeof(entry->'source_turn_ids')<>'array' OR jsonb_array_length(entry->'source_turn_ids') NOT BETWEEN 1 AND 10 THEN RAISE invalid_parameter_value;END IF;
 IF entry->>'kind'='task' AND length(btrim(entry->>'rationale'))=0 THEN RAISE invalid_parameter_value;END IF;
 IF (entry->>'kind'='method' AND jsonb_array_length(entry->'steps')=0) OR (entry->>'kind'<>'method' AND jsonb_array_length(entry->'steps')<>0) THEN RAISE invalid_parameter_value;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(entry->'steps') step WHERE jsonb_typeof(step)<>'string' OR length(btrim(step#>>'{}')) NOT BETWEEN 1 AND 200) THEN RAISE invalid_parameter_value;END IF;
 IF (SELECT count(DISTINCT value::uuid) FROM jsonb_array_elements_text(entry->'source_turn_ids'))<>jsonb_array_length(entry->'source_turn_ids') THEN RAISE invalid_parameter_value;END IF;
 FOR source IN SELECT * FROM jsonb_array_elements(entry->'source_turn_ids') LOOP
 IF NOT EXISTS(SELECT 1 FROM intake_turns WHERE workspace_id=w AND session_id=s AND id=(source#>>'{}')::uuid) THEN RAISE insufficient_privilege;END IF;
 END LOOP;
 IF entry->>'basis'='quoted' AND NOT EXISTS(SELECT 1 FROM intake_turns t WHERE t.session_id=s AND t.id IN (SELECT value::uuid FROM jsonb_array_elements_text(entry->'source_turn_ids')) AND strpos(t.original_text,entry->>'text')>0) THEN RAISE invalid_parameter_value;END IF;
 END LOOP;
 revision:=session.outline_version+1;
 INSERT INTO intake_outline_revisions(workspace_id,session_id,revision,items,reason) VALUES(w,s,revision,entries,why);
 FOR entry IN SELECT * FROM jsonb_array_elements(entries) LOOP
 FOR source IN SELECT * FROM jsonb_array_elements(entry->'source_turn_ids') LOOP
 INSERT INTO intake_outline_sources VALUES(w,s,revision,(entry->>'id')::uuid,(source#>>'{}')::uuid);
 END LOOP;
 END LOOP;
 UPDATE intake_sessions SET outline_version=revision,version=version+1 WHERE id=s;
 PERFORM intake_audit(w,s,'intake.outline_saved',request);RETURN revision;
END $$;
REVOKE ALL ON FUNCTION save_intake_outline(uuid,uuid,integer,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_intake_outline(uuid,uuid,integer,jsonb,text,text) TO ideator_app;
