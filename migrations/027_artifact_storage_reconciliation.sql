CREATE FUNCTION artifact_blob_referenced(k uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM artifacts WHERE storage_key=k)
$$;
REVOKE ALL ON FUNCTION artifact_blob_referenced(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION artifact_blob_referenced(uuid) TO ideator_worker;
