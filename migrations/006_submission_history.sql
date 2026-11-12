-- Keep the assigned reviewer's inbox metadata after disposition, while review_grant
-- continues to close access to private content immediately on disposition/expiry.
DROP POLICY submission_read ON submissions;
CREATE POLICY submission_read ON submissions FOR SELECT TO ideator_app USING(member(workspace_id) AND (author_id=actor() OR published(workspace_id,object_id,revision) OR (actor()=ANY(reviewer_ids) AND has_role(workspace_id,'reviewer'))));
