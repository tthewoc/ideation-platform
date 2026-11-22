CREATE FUNCTION artifact_registration_available(w uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT member(w) AND NOT EXISTS (
    SELECT 1 FROM artifacts WHERE workspace_id=w
      AND created_at>now()-interval '1 day' OFFSET 99
  )
$$;
REVOKE ALL ON FUNCTION artifact_registration_available(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION artifact_registration_available(uuid) TO ideator_app;
