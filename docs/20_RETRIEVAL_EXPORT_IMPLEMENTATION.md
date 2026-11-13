# Slice 4: retrieval and portable export

The user authorized continuation of the roadmap. The resumed environment preserved
slice 4's working files; this implementation extends the slice 3 checkpoint without
reapplying prior changes. GitHub and environment publication remain separate actions.

## Delivered workflow

The Find & reuse knowledge screen searches published revisions by words, knowledge
type and result outcome, including null outcomes. Results show the exact revision,
review/validity/freshness labels and why they matched. Related-object retrieval uses
explicit graph neighbors. Graph direction and scientific interpretation remain
inspectable in the graph explorer; relevance is not confidence or equivalence.

Lexical search uses PostgreSQL's `simple` full-text configuration, with title weight
A and other string content weight B. Text rank and a fixed direct-neighbor relevance
bonus are transparent ordering signals. Case folding and tokenization are supported;
language-specific stemming, spelling correction and semantic search are not claimed.
The API supports lexical, direct graph and combined lexical/graph channels. Vector
requests fail explicitly until a model and quality evaluation are enabled in slice 5.

Search projections are rebuilt from authoritative publications in 500-object batches.
A staging generation swaps atomically with the active generation. Search commands
share the workspace lock with writers so a generation cannot disappear mid-page.
Old indexed corrections are excluded immediately by the current published pointer.
Artifact access restrictions and dependent-source checks are evaluated before ranking,
not deferred to a background index update. Private drafts never enter the index.
The UI labels a pending/updating index so incomplete results are not presented as
complete coverage. Failed rebuild batches retry after 30 seconds.

A query first scans a bounded indexed candidate window (5,000 matching publications),
then applies transitive policy checks and ranks at most 1,000 permitted candidates.
Pages contain at most 25 objects. Broad queries should be refined; this is bounded
retrieval, not a claim of global top-k optimality. The candidate service returns only
permitted IDs and never returns raw inaccessible terms, counts or scores. Graph
retrieval considers at most 200 permitted direct neighbors; deeper exploration uses
the existing depth/result-limited graph API. Statements time out after two seconds.
Opaque cursors bind actor, workspace policy version, content epoch, generation and
exact query and expire after 15 minutes. Any bound change requires a fresh search.

## Portable JSON and restrictions

Select published objects into an export basket and prepare `json-v1`. Preparation
pins the requested published revisions and their required provenance. The worker
reauthorizes membership and usage restrictions. Downloads reauthorize again and
reject exports whose policy/content epoch has changed. A queued job for a revoked
requester is denied; another member cannot inspect or download that person's job.
Jobs expire after 24 hours and are limited to ten requests per actor/workspace/hour.

A package contains stable identities, schemas, pinned content, origin/author,
review/validity/freshness, internal typed edges, required lineage and applicable
review decisions. It includes artifact license/integrity metadata when permitted,
but never artifact bytes, storage keys, download tokens, sessions or credentials.
Provenance closure includes inputs, not every related neighbor or task output;
select additional roots to include those objects. It is not a whole-workspace backup
or an import/restore format. Review state is current at download while content
revisions remain pinned to preparation.

Artifacts default to no metadata export until an owner/moderator explicitly records
a license or consent decision for the published revision. Other published objects
allow metadata export by default and can also be restricted. This decision does not
infer legal rights from license text. Restricted/unavailable sources prevent export
of dependent objects as well. The entire dependent root is omitted, so structured
references cannot reveal hidden IDs/digests. The response gives one generic omission
warning without identifying omitted roots or source counts. Free text is not a DLP
system; users still control the content they author and publish.

Preparation is bounded to 100 selected roots and 500 closure revisions. Downloads
allow up to 1,000 internal edges, 2,000 lineage links, 1,000 review records and 4 MiB
of JSON. Over-budget requests fail closed and should be split into smaller exports.
The current download is a fresh authenticated, no-store attachment with `nosniff`;
there is no persistent public/signed download URL. Already downloaded bytes cannot
be recalled. Failed preparation is marked failed rather than repeatedly blocking
other jobs.

## API and storage

All routes are relative to `/v1/workspaces/:w`. Existing sessions, CSRF, rate limits,
idempotent mutations, audit/outbox and current membership checks apply.

| Route | Behavior |
|---|---|
| `GET search` | q, channels, optional root_id/type/outcome/cursor; ranked refs and index state |
| `GET search/status` | Current index state and retry indication; vector channel disabled |
| `POST search/rebuild` | Administrator queues a rebuild from publications |
| `GET objects/:id/export-policy?revision=N` | Revision usage decision and policy ETag |
| `POST objects/:id/export-policy` | `{revision,allowed,reason}` with policy ETag; owner/moderator |
| `POST exports` | `{object_ids,format:"json-v1"}` → 202 job |
| `GET exports`, `GET exports/:id` | Requester's unexpired jobs and ready/stale/failed state |
| `GET exports/:id/download` | Current-authorized portable JSON attachment |

Migrations 011–013 add RLS-protected projections/cursors, revision usage decisions,
immutable policy events and export jobs. Narrow worker functions perform generation
and export preparation; the worker does not receive broad application read access.
The bounded candidate function verifies membership and every returned candidate's
transitive policy before exposing its identity.

The vector foundation records revision, model version, dimensions, content SHA-256
and validated epoch. Disabled models, stale fingerprints, wrong dimensions and
non-finite vectors are rejected. No provider/model is enabled by these migrations.
Tests use explicitly synthetic vectors to check storage and permissions, not to
claim semantic retrieval or model quality. Future retrieval must additionally select
the approved model/generation and recheck source permissions before ranking.

## Verification and remaining gates

Local validation on 2026-11-13 includes eight retrieval/export integration tests,
a browser journey through search, related objects, portable download and permission
invalidation, and the existing regression suites. The large fixture contains 100,000
published objects and one million edges. Bounded lexical search returned its first
page in 1,028 ms; rebuilding during reads preserved authorized identities and scores.
Depth-4 graph traversal returned a bounded page in 1,590 ms. Index rebuilding,
permission-cursor invalidation and revoked-reader denial passed. These are synthetic
local measurements, not production SLOs.

The logical restore drill now also checks projection references, embedding
fingerprints and outsider denial on the new tables. Full hybrid ranking and the
human-adjudicated AI corpus gates remain slice 5. Manual accessibility review,
production identity, storage/retention operations and recovery gates remain as
recorded in earlier checkpoints.

At the slice 4 checkpoint, all 40 integration tests passed. Four Chromium journeys
passed (including the existing graph review journey rerun after making its selector
exact). The restore drill verified 605 revisions and 16 artifact blobs, projection
references, embedding fingerprints and runtime RLS. Additional slice 5 preparation
is documented separately and does not change these into live-AI release results.
