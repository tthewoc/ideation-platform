# Ideator

A TypeScript/Fastify/React knowledge workspace backed by PostgreSQL 17. The first
four development slices support private drafts, immutable publication, project
reuse, typed graph relationships, scoped evidence assessments, independent review,
source freshness, consented research tasks, scanned artifacts, permission-scoped
search and portable JSON export. Publication and scientific acceptance remain separate.

See [slice 4 implementation and evidence](docs/20_RETRIEVAL_EXPORT_IMPLEMENTATION.md)
and [local proposal-workflow preparation](docs/21_LOCAL_PROPOSAL_WORKFLOW.md).
Live AI remains disabled; the optional local fixture makes no model calls.
Local proposal review windows default to 30 days. Set `FIXTURE_REVIEW_DAYS=1..90`
in `.local/dev.env` before starting the API to change deadlines for new runs.
Expiry closes unpublished proposal actions while preserving private history;
it does not delete records or affect already-published knowledge.

The [private idea notebook](docs/23_PRIVATE_INTAKE_IMPLEMENTATION.md) supports
unfinished human notes, clean attachment references and undo without deleting history.
It creates no published knowledge and makes no AI calls.

## Local development

Requires Node 24, npm and Docker Compose. Local setup also pulls a pinned ClamAV
image for artifact scans (allow 1.5 GiB of memory per scan). Use the existing checkout.

```sh
npm ci
npm run setup
npm run build
npm run dev
```

The app listens on loopback port 3000; the synthetic OIDC provider uses port 3001.
Sign in with Alice, Bob or Eve. These are explicitly development identities.
Create a workspace, save a draft, review publication, then confirm its audience.
A registered user can obtain their ID from Workspace membership; an administrator
can add that ID to a workspace. A user must sign in once before being added.

Setup generates random local credentials in `.local/dev.env` with restrictive
permissions, starts a digest-pinned database on loopback port 55432, and applies
checksummed migrations. It is repeatable and preserves existing data and local
configuration. Never commit `.local` or use its synthetic provider in production.
The API and worker use separate non-owner database roles; migration credentials
are used only by setup/administration scripts. The outbox worker records idempotent delivery receipts and rebuilds lineage freshness
against workspace epochs; reads report unknown while revalidation is pending.

`npm run dev` runs the API, synthetic identity provider and outbox worker. Ctrl-C
stops them. Rebuild after editing the UI; reload to use the new bundle. Database
state stays in the Compose volume. Stop the database with
`docker compose --env-file .local/dev.env stop`; do not remove the volume unless
you intend to delete local data.

## Verification

```sh
npm run check
npm run test:browser
npm run test:restore
npm run test:graph-load
npm run format:check
```

Integration tests use actual PostgreSQL roles, RLS and transactions. They create
synthetic fixtures in the configured local database; they do not reset existing
data. Browser tests run real OIDC/PKCE login and a full publication/project journey,
keyboard interaction and an axe accessibility scan. Use `CHROMIUM_PATH` to select
an installed Chromium; otherwise the runner uses system Chromium when present or
Playwright's browser (`npx playwright install chromium`).

The restore drill writes a private dump under `.local`, restores it into a uniquely
named temporary database, verifies references, audit/outbox links, RLS and receipt
deduplication, and deletes only that temporary database. Run it after integration
tests while no other task is mutating the local database. This is a local logical
backup drill, not production WAL/PITR or a measured production RPO/RTO guarantee.

## Evaluation evidence

`npm run evaluate` writes a JSON/Markdown readiness report and intentionally exits 2
for the incomplete design seed. It makes no model calls and grants no release
authorization. See the [evidence contract and commands](docs/22_EVALUATION_RUNNER.md).

## API and operational boundaries

JSON API routes live under `/v1`; authenticated writes require a CSRF header,
matching Origin, UUID Idempotency-Key and an If-Match ETag for existing resources.
Publication retries return the committed result before checking the old ETag.
Private corrections never change another member's published projection. Author
history includes their drafts; other members see published revisions only.
Workspace writes are serialized to make membership changes, retries and version
checks predictable. This deliberately favors correctness over write throughput.

Independent login/session storage uses a restricted authentication role. Production
configuration must set HTTPS APP_ORIGIN/OIDC_ISSUER, OIDC_CLIENT_ID,
OIDC_CLIENT_SECRET, SESSION_SECRET (at least 32 characters), DATABASE_URL,
AUTH_DATABASE_URL and WORKER_DATABASE_URL, with LOCAL_DEVELOPMENT unset/false.
REQUIRE_ADMIN_MFA=true requires fresh provider-verified MFA for membership changes.
Use an operated OIDC provider; `scripts/identity.ts` refuses production mode.
This repository is currently a development workflow, not a production deployment.

Implemented API surface: session/logout, workspace creation, membership listing/
creation/revocation, object creation/list/detail/draft/correction/publication/history,
and project creation/list/deletion/reference management. Pagination uses bounded
UUID keysets for object/project lists and a `before` revision for history. The UI
currently loads the first 25 projects and history revisions; object lists support
Load more. Full opaque policy-scoped cursors and broader browsing are follow-up work.

Graph assessments, cross-workspace sharing, artifact ingestion, AI, moderation and
public publishing belong to later roadmap slices and are not exposed here. Manual
screen-reader review, property-based generators, load testing, production identity
integration and deployment rollback/WAL recovery drills remain outstanding.
See [implementation evidence](docs/17_IMPLEMENTATION_STATUS.md) and the
[delivery roadmap](docs/14_DELIVERY_ROADMAP.md).
