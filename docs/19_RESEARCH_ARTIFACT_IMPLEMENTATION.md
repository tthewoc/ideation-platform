# Slice 3: research coordination and artifacts

The user's next-slice instruction authorizes the research/artifact scope from
roadmap 14. This document extends the slice 2 checkpoint in document 18. Publication
of these changes to GitHub remains a separate action.

## Research workflow

1. Create and explicitly publish a research-task definition with a pinned method,
   rationale and acceptance criteria. Add typed `depends_on` relationships.
2. A coordinator opens the current active definition and invites a current member.
   The invitation records purpose and expiry (1–168 hours, default 72). The named
   assignee must personally accept; coordinators cannot assert consent for them.
   Declines remain in history. Replacing or cancelling an invitation closes it.
3. The consenting assignee starts work only after every pinned prerequisite is
   completed and active. Dependency changes are rejected after work starts.
4. The assignee or coordinator records a private result with the exact task method,
   measurement context, outcome and optional published artifacts. The task reference
   is added to immutable provenance. Positive, negative, null, ambiguous and
   interrupted outcomes have identical handling.
5. The result's author explicitly publishes it. The assignee submits that published
   revision with evidence for every acceptance criterion. Submission creates a
   typed `produces` relationship and records the criterion evidence in history.
6. An independent reviewer declares no conflict and completes the task or returns
   it for revision. The reviewer cannot be the task author, assignee or result
   author. Completion requires current active inputs and revalidated freshness;
   it records the result review decision separately from publication. The board
   shows result freshness and keeps completion unavailable while revalidation is
   pending or sources are stale.

The creator or coordinator may cancel nonterminal work with a reason. Cancellation
and assignment changes emit transactional audit/outbox events and appear on the
board/history. External email and push notification delivery are not implemented.
A corrected or withdrawn task/method cannot silently change an active assignment:
open work must be cancelled and replaced with a new task definition.

The board supports task pagination, pinned method/dependency inspection, invitations,
result recording, criterion evidence and independent review. The registry remains
the explicit publication surface. Selectors show loaded registry objects; load
additional registry pages when needed.

## Artifact ingestion and access

Digital artifacts are immutable registry objects containing filename, declared
media type, byte size, SHA-256, license and retention class (`workspace`). Physical
records instead require custodian, location, access protocol and identifying
integrity metadata; they have no digital download or malware verdict.

Digital registration returns a private object and upload-state ETag. Upload accepts
canonical base64 JSON, at most 1 MiB decoded, and a bounded request body. Initial
formats are UTF-8 plain text, CSV and JSON. Archives, executables, PDFs and rich
formats are not enabled. Text must decode cleanly without binary control bytes;
obvious markup signatures are rejected and JSON must parse. Filenames are bounded
and restricted; they never determine storage paths.

Bytes go to a private filesystem object store using server-generated UUID keys,
exclusive writes and restrictive permissions. The directory is outside the served
web root. Size, digest and type are checked before quarantine and again by the
worker. No stored bytes or client filenames are passed to a shell or executed.

The worker claims a two-minute scan lease. ClamAV receives bytes over stdin with a
60-second deadline. Clean scans make the record available privately; malware,
scanner errors and integrity/type failures reject it. Expired leases can be
reclaimed, and obsolete completion tokens cannot overwrite a newer scan. Database
triggers prevent the application role from forging a clean scanner verdict.
Only an available artifact may be explicitly published or referenced by a result.

Local setup pulls a digest-pinned ClamAV container. It runs with no network, a
read-only filesystem, dropped capabilities, resource limits and a temporary scratch
directory. The image includes signatures for reproducible local checks; those
pinned signatures are not a production update policy. Outside local mode the worker
uses a system-managed `clamscan` and rejects databases older than seven days.
Production deployment must provision the scanner, maintained signatures, isolated
worker permissions and durable artifact storage; this slice does not deploy them.

Downloads check the current session, membership and artifact state on every request,
recheck the stored digest and size, and return a no-store octet-stream attachment
with `nosniff`. There are no reusable signed URLs or inline previews. Restriction or
retraction closes subsequent downloads, marks published artifact revisions invalid
and propagates downstream staleness without deleting historical metadata. Bytes
already downloaded cannot be recalled.

## API and concurrency

Routes below are relative to `/v1/workspaces/:w`. Commands retain CSRF, request
limits, idempotency keys, workspace serialization and atomic audit/outbox behavior.

| Route | Contract |
|---|---|
| `POST tasks/:id/open` | Current published task revision, reason, object ETag; coordinator |
| `GET tasks`, `GET tasks/:id` | Bounded board and pinned detail/history/invitations |
| `POST tasks/:id/assignment` | Assignee ID, purpose, optional expiry hours; task ETag |
| `POST tasks/:id/assignment/decisions` | Invitation ID, accept/decline, reason; invitation ETag |
| `POST tasks/:id/results` | Structured result content; task ETag; returns private result draft |
| `POST tasks/:id/transitions` | start/submit/complete/return/cancel, reason; task ETag |
| `POST artifacts` | Digital or physical manifest; returns private object and ingestion state |
| `GET artifacts`, `GET artifacts/:id` | Permission-filtered ingestion state and history |
| `POST artifacts/:id/upload` | `{base64}`; ingestion-state ETag; returns quarantine/rejection |
| `POST artifacts/:id/transitions` | restricted/retracted and reason; ingestion-state ETag; owner/moderator |
| `GET artifacts/:id/download` | Authorized, available digital bytes as attachment |

Task submission additionally requires `result_ref` and an `acceptance_evidence`
entry for each criterion. Independent completion/return requires
`conflict_declaration: "none"`. Review rejection does not erase the measured outcome.
Result corrections preserve pinned artifact references, including references absent
from the loaded registry page. Result content edits and publication use registry routes; acceptance
history uses the existing review routes. API callers can paginate artifact and task
lists; the artifact board currently displays the first 25 records. Detail histories
are capped at 100 entries and invitations at 25.

Migrations 009–010 add RLS-protected projections, immutable task/artifact events,
worker-only scan functions, lease tokens and cross-workspace foreign-key guards.
Task and invitation versions prevent stale or competing decisions from overwriting
one another. Artifact content cannot be corrected in place: register a new identity
for changed bytes or licensing/custody metadata and retain the old provenance.

## Operations and deliberate limits

`npm run setup` prepares PostgreSQL, applies checksummed migrations and pulls the
local scanner. `npm run dev` runs the existing worker with artifact processing.
`ARTIFACT_STORAGE_ROOT` overrides `.local/artifacts`; both API and worker require the
same private storage. The restore drill copies registered blobs into a separate
scratch directory and validates digest/size against the restored database before
removing the scratch copy.

The local filesystem backend is intentionally limited to small artifacts. A durable
object-store adapter, storage quotas across retention periods, policy-driven deletion,
orphan-blob reconciliation after a failed database commit, full backup automation
and production recovery remain deployment work. Scanner failure is fail-closed;
there is no “trust anyway” action. Correct a failed ingestion by registering a new
artifact. Search/export remain slice 4; the registry lists null outcomes, but this
slice does not claim full search. Capability ranking, external provider assignment,
AI and cross-workspace sharing remain later roadmap work.

## Validation

The research suite exercises real PostgreSQL application/worker roles and actual
ClamAV scans, including the harmless EICAR antivirus test file. Coverage includes
forged digest/media, private scan/publication separation, downloads, null-result
lineage, independent review, dependency guards, invitation expiry/replacement,
concurrent consent, cancellation, physical records, scan recovery and RLS denial.
Browser validation covers the complete three-person research journey and an axe
scan. The backup drill includes artifact bytes as well as database relationships.
Local verification outcomes are recorded below.

Local results (2026-11-12): repeatable setup, strict TypeScript checking, production
build, 32 integration tests and three Chromium journeys passed. Both new and existing
browser journeys include axe checks with zero reported violations on tested screens.
The isolated restore verified 300 revisions and nine artifact blobs against their
immutable manifests, plus runtime RLS and receipt deduplication. Formatting and
whitespace checks passed. Manual screen-reader review, production scanner/storage
operations and the wider roadmap release gates remain outstanding.
