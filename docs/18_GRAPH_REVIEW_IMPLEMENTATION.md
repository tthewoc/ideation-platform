# Slice 2: graph, assessments and independent review

The user's “Proceed with next slice” instruction authorizes this implementation.
This extends the slice 1 checkpoint in document 17 and the slice 2 scope in document
14. Changes are local; implementation does not publish a deployment or Git commit.

## Delivered behavior

Structured immutable revisions now support methods, results (including null,
negative and interrupted outcomes), evidence, hypotheses, assessments, theses and
research-task definitions. Result/method and assessment claim/evidence/method
references are type checked and pinned. Drafts retain private visibility. Nonempty
artifact references are rejected until the artifact service in slice 3 exists.

An assessment records polarity, scope, method, uncertainty and rationale, with
source-group IDs retained on evidence to make shared provenance inspectable.
Contradictory assessments coexist. Publishing an assessment creates a versioned
relationship projection; direct support/contradiction edge creation is rejected.
There is no aggregate confidence score or automatic identity merge.

Generic typed relationships have pinned endpoints, reasons, optional conditions
and temporal validity. Derivation, task-dependency and supersession writes reject
cycles under workspace serialization; relevance cycles remain allowed. Edge
retractions append history. Candidate equivalence requires independent review and
can be revoked without changing object identities or merging content.

Authors submit an exact revision to named reviewers. Grants expire and close on
withdrawal, editing, publication or decision. They expose neither older drafts nor
unrelated private objects. Inbox metadata remains available after closure. An
independent reviewer declares conflicts and records an immutable decision;
acceptance does not publish. Publishing identical accepted content retains the
review decision's provenance while keeping private draft content inaccessible.
Disputes require a different reviewer; adjudication is independent of the last
reviewer. Validity retraction and supersession are separate, audited transitions.

Publication/retraction increments a content epoch atomically. Readers report
unknown freshness until the restricted worker rebuilds it; lineage propagates
staleness from corrected or inactive inputs. Acceptance rejects stale, inactive or
pending-revalidation source revisions. Historical content remains readable to its
publication audience. Ordinary member/reviewer writes use an advisory workspace
lock, avoiding the administrator-only UPDATE policy previously implicated by row
locking.

The UI provides structured forms and details, exact-revision submission, inbox
review, lifecycle decisions, assessment comparison, reversible equivalence and a
keyboard-accessible graph table. Editing conflicts preserve form values and require
explicit selection of the latest revision as the base.

## API and storage contract

All routes are under `/v1/workspaces/:w` and retain session, CSRF, current membership,
idempotency and audit/outbox rules. Migrations 004–008 are append-only upgrades.

| Routes | Purpose |
|---|---|
| `POST edges`, `POST edges/:id/retract`, `GET edges/:id/revisions` | Versioned typed links and history |
| `POST graph/query` | Bounded graph traversal with opaque continuation |
| `GET objects/:id/provenance?revision=N` | Immediate pinned lineage inputs |
| `POST/GET assessments` | Draft creation and published assessment comparison |
| `POST objects/:id/submissions`, `GET submissions` | Exact-revision review and inbox |
| `POST submissions/:id/decisions` or `/withdraw` | Independent decision or withdrawal |
| `POST objects/:id/transitions` | Review and validity lifecycle commands |
| `GET objects/:id/reviews?revision=N` | Review decisions and lifecycle history |
| `POST/GET equivalences`, `POST equivalences/:id/decisions` | Reversible identity proposals |

Object reads accept `?revision=N`. Content writes use the object ETag; lifecycle
writes use `state_etag`, and submission decisions use the submission ETag. Publication
continues as an explicit separate command.

Graph queries allow depth 1–4 and at most 25 roots, 500 nodes/1,000 edges per page,
and 10,000 nodes/20,000 edges per query. Traversal uses a time budget and database
statement timeout. Opaque cursors bind actor, workspace, policy version and content
epoch; changes invalidate continuation. Adjacency exploration considers both
endpoints while displaying stored direction. Lists/history have bounded responses;
the UI's selectors operate on loaded objects, so load additional registry pages as
needed. Review/history responses currently cap at 100 entries.

## Local verification, 2026-11-12

- Strict TypeScript checking and production build passed.
- 22 real PostgreSQL/API tests passed, covering typed references, contradictory
  interpretations, concurrent cycle rejection, exact private review grants,
  independent decisions, review/publication separation, immutable history,
  equivalence revocation, freshness replay and existing registry protections.
- Two Chromium/OIDC journeys passed. They include independent private review,
  explicit publication, structured evidence assessment, graph exploration,
  concurrent edit reconciliation and axe scans with no reported violations on the
  tested screens.
- Logical backup restore passed with 185 revisions and checks for publication and
  lineage integrity, audit/outbox linkage, receipt deduplication and outsider RLS
  denial across registry, graph, review and equivalence tables.
- `npm run test:graph-load` creates and removes an isolated database containing
  100,000 objects and one million edges, including a 10,000-neighbor hub. It checks
  bounded depth-4 continuation, edge uniqueness, index rebuilding during reads,
  policy-cursor invalidation and revoked-reader denial. CI includes this check.

## Remaining roadmap work

Slice 3 adds task assignment/consent and quarantined artifact storage; schemas here
do not claim those workflows. Search, portable export and derived retrieval indexes
remain slices 4–5; AI and cross-workspace discovery remain disabled. The dense graph
fixture is synthetic evidence, not a production latency SLO or the full mixed-ACL
hybrid retrieval evaluation. Comprehensive property-based testing, manual screen
reader review, production identity/MFA integration and WAL/deployment recovery are
still outstanding release checks. Expired submissions can be explicitly withdrawn
before resubmission; automatic expiry reconciliation is not implemented.
