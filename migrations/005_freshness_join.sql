CREATE OR REPLACE FUNCTION refresh_freshness(w uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE current_epoch bigint; BEGIN
 SELECT content_epoch INTO current_epoch FROM workspaces WHERE id=w FOR UPDATE;
 IF current_epoch IS NULL THEN RETURN; END IF;
 WITH RECURSIVE active_lineage AS (
 SELECT l.* FROM lineage l LEFT JOIN edges e ON e.id=l.edge_id LEFT JOIN edge_revisions er ON er.edge_id=e.id AND er.revision=e.current_revision
 WHERE l.workspace_id=w AND (l.edge_id IS NULL OR er.state='active')
 ), stale(object_id,revision) AS (
 SELECT p.object_id,p.revision FROM publications p JOIN objects o ON o.id=p.object_id LEFT JOIN revision_status rs ON rs.workspace_id=p.workspace_id AND rs.object_id=p.object_id AND rs.revision=p.revision
 WHERE p.workspace_id=w AND (o.current_revision<>p.revision OR COALESCE(rs.validity,'active')<>'active')
 UNION
 SELECT l.derived_id,l.derived_revision FROM active_lineage l JOIN stale s ON s.object_id=l.input_id AND s.revision=l.input_revision
 )
 INSERT INTO revision_freshness(workspace_id,object_id,revision,epoch,status)
 SELECT p.workspace_id,p.object_id,p.revision,current_epoch,CASE WHEN s.object_id IS NULL THEN 'current' ELSE 'stale' END FROM publications p LEFT JOIN stale s ON s.object_id=p.object_id AND s.revision=p.revision WHERE p.workspace_id=w
 ON CONFLICT(workspace_id,object_id,revision) DO UPDATE SET epoch=excluded.epoch,status=excluded.status;
 END $$;
