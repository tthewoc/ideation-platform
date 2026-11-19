CREATE TABLE outline_claim_publications (
 review_id uuid NOT NULL, version integer NOT NULL, workspace_id uuid NOT NULL,
 object_id uuid NOT NULL, revision integer NOT NULL,
 PRIMARY KEY(review_id,version), UNIQUE(object_id,revision),
 FOREIGN KEY(review_id,version) REFERENCES outline_claim_candidates(review_id,version),
 FOREIGN KEY(workspace_id,object_id,revision) REFERENCES publications(workspace_id,object_id,revision)
);
ALTER TABLE outline_claim_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE outline_claim_publications FORCE ROW LEVEL SECURITY;
CREATE POLICY candidate_publication_read ON outline_claim_publications FOR SELECT TO ideator_app USING(candidate_access(workspace_id,review_id));
CREATE POLICY candidate_publication_write ON outline_claim_publications FOR INSERT TO ideator_app WITH CHECK(candidate_access(workspace_id,review_id) AND object_author(workspace_id,object_id));
GRANT SELECT,INSERT ON outline_claim_publications TO ideator_app;
