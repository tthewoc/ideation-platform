ALTER TABLE search_state ADD COLUMN retry_after timestamptz NOT NULL DEFAULT '-infinity';
ALTER TABLE search_state ADD COLUMN last_error boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION pending_search_workspaces() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT workspace_id FROM search_state WHERE requested AND retry_after<=now() ORDER BY updated_at,workspace_id LIMIT 10 $$;
CREATE FUNCTION report_search_batch(w uuid,ok boolean) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ UPDATE search_state SET last_error=NOT ok,retry_after=CASE WHEN ok THEN '-infinity'::timestamptz ELSE now()+interval '30 seconds' END WHERE workspace_id=w $$;
CREATE FUNCTION fail_export(job uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ UPDATE export_jobs SET state='failed',manifest=NULL WHERE id=job AND state='queued' $$;
REVOKE ALL ON FUNCTION report_search_batch(uuid,boolean),fail_export(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION report_search_batch(uuid,boolean),fail_export(uuid) TO ideator_worker;
