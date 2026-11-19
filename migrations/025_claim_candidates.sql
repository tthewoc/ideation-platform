CREATE TABLE outline_claim_candidates (
 review_id uuid NOT NULL REFERENCES intake_review_requests, version integer NOT NULL CHECK(version BETWEEN 1 AND 50),
 workspace_id uuid NOT NULL REFERENCES workspaces, candidate jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(review_id,version)
);
ALTER TABLE outline_claim_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE outline_claim_candidates FORCE ROW LEVEL SECURITY;
CREATE FUNCTION candidate_access(w uuid, review uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT member(w) AND EXISTS(SELECT 1 FROM intake_review_requests r JOIN intake_review_decisions d ON d.request_id=r.id
 WHERE r.workspace_id=w AND r.id=review AND r.author_id=actor() AND r.state='decided' AND r.expires_at>clock_timestamp()
 AND d.disposition='accepted' AND outline_review_sources_available(w,r.session_id,r.outline_revision))
$$;
REVOKE ALL ON FUNCTION candidate_access(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_access(uuid,uuid) TO ideator_app;
CREATE POLICY candidate_read ON outline_claim_candidates FOR SELECT TO ideator_app USING(candidate_access(workspace_id,review_id));
CREATE POLICY candidate_insert ON outline_claim_candidates FOR INSERT TO ideator_app WITH CHECK(candidate_access(workspace_id,review_id));
GRANT SELECT,INSERT ON outline_claim_candidates TO ideator_app;
