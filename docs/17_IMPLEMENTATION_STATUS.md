# Slice 1 implementation status and evidence

Historical slice 1 checkpoint. The current graph/review implementation and updated
boundaries are documented in [slice 2](18_GRAPH_REVIEW_IMPLEMENTATION.md).

The user authorized coding after reviewing and publishing the design packet on
2026-11-12. This authorizes the first development slice; no further design approval
is needed to continue its implementation. Later feature decisions and production
requirements remain as documented. No deployment or GitHub publication is implied.

## Implemented

- Fastify API, React UI, PostgreSQL migrations and repeatable local setup with pinned
  npm dependencies and a digest-pinned database image.
- Real OIDC authorization-code/PKCE/nonce/state validation, random opaque sessions,
  CSRF/origin checks, login rotation and logout; a loopback-only synthetic provider.
- Workspace creation, membership/role administration, last-admin protection,
  configurable MFA assurance, current membership checks on every request.
- Observation/claim schemas; separate private draft pointers and immutable published
  revisions; author-only correction drafts; explicit audience confirmation.
- Workspace RLS under a non-owner application role, append-only revision/audit
  privileges, no implicit administrator access to private drafts.
- Atomic audit/outbox with idempotent delivery receipts, request replay, optimistic
  concurrency and rejection of private provenance in workspace publication.
- Multiple project references without atom ownership or cascade deletion.
- Browser editing/history/publication/projects and preserved text on version conflict.

## Verification scope

The automated integration suite exercises real PostgreSQL roles: draft privacy,
revoked access, immutable history, concurrent edits, atomic rollback, publication
replay, project deletion, outbox replay, former-owner bootstrap denial and private
source audience checks. The browser journey exercises synthetic OIDC sign-in,
private draft/publication/history, project reuse/deletion, keyboard editing and
logout with an axe accessibility scan. Build and strict TypeScript checks run too.

The local logical backup drill restores into a separate database and verifies
revision/reference integrity, audit/outbox linkage, outsider denial, author access
and receipt deduplication. It does not claim production disaster recovery readiness.

## Deliberate first-slice boundaries

Schemas physically implement only observations, claims and project references.
Source references are retained in immutable revision JSON and checked transactionally;
typed graph/lineage tables and invalidation epochs arrive with slice 2. Workspace
membership is the only publication audience currently enabled. Review grants and
independent scientific acceptance remain unavailable rather than being simulated.

Database columns use `version` for row_version and `base_revision` for the draft's
base published revision. Human origin is enforced. Lifecycle is derived from draft
and publication records for this slice; richer lifecycle events are deferred to
slice 2. Object/project pagination uses UUID keysets; history uses a revision cursor.
Full opaque policy-version cursors and complete UI pagination remain follow-up work.
Workspace serialization is conservative and must be load-tested before scaling.

The API server is not given migration credentials through its database pools; its
session role is distinct from its RLS data role. Local scripts share the development
configuration file; production processes must receive only their required bindings.
The synthetic provider is in-memory and uses development signing material, so it
must never serve a production installation.

## Outstanding before declaring the full slice release-ready

Manual screen-reader/accessibility review, comprehensive property-based tests,
production MFA/identity integration, broader HTTP contract/negative-case coverage,
load evidence and deployment rollback/WAL recovery remain pending. The current
working implementation demonstrates the registry workflow; it does not claim that
all roadmap release gates or the complete product specification are satisfied.

## Local validation result (2026-11-12)

- `npm ci`, repeatable `npm run setup`, strict typecheck and production UI build passed.
- 13 PostgreSQL/API integration tests passed; no skipped tests.
- One full Chromium/OIDC journey passed, including a real concurrent edit,
  preserved editor text, explicit conflict reconciliation, keyboard activation,
  logout and an axe scan with zero reported violations on the tested screen.
- Isolated logical restore passed with 32 revisions, checked references/audit links,
  runtime role isolation and receipt deduplication.
- Formatting and whitespace checks passed. Runtime dependency audit reported zero
  known vulnerabilities at check time. GitHub Actions is configured but has not run
  remotely because these implementation changes have not been pushed.
- The app, synthetic identity provider and worker were restarted successfully after
  reinstalling dependencies. API health returned `{"status":"ok"}`.

These results cover the local workflow only; they do not turn the outstanding
release checks above into passed tests.
