CREATE TABLE freshness_jobs(workspace_id uuid PRIMARY KEY REFERENCES workspaces);
INSERT INTO freshness_jobs SELECT DISTINCT workspace_id FROM publications;
CREATE OR REPLACE FUNCTION bump_content_epoch(w uuid) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE v bigint; BEGIN
 IF NOT member(w) THEN RAISE insufficient_privilege; END IF;
 UPDATE workspaces SET content_epoch=content_epoch+1 WHERE id=w RETURNING content_epoch INTO v;
 INSERT INTO freshness_jobs VALUES(w) ON CONFLICT DO NOTHING;RETURN v;
END $$;
CREATE FUNCTION refresh_pending_freshness() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE target uuid; processed integer:=0; BEGIN
 FOR target IN SELECT workspace_id FROM freshness_jobs ORDER BY workspace_id LIMIT 10 LOOP
 PERFORM refresh_freshness(target);DELETE FROM freshness_jobs WHERE workspace_id=target;processed:=processed+1;
 END LOOP;RETURN processed;
END $$;
REVOKE ALL ON FUNCTION refresh_pending_freshness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refresh_pending_freshness() TO ideator_worker;
