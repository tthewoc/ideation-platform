# Scoped independent outline review

This increment lets a notebook author explicitly grant one current independent
workspace reviewer access to a selected immutable outline revision and only its
cited original turns. It does not publish the outline, open the notebook, assign
research tasks, enable AI, or complete the remaining slice 5/6 release gates.

## Disclosure and review journey

The outline editor provides a disclosure preview of cited original turns. The
author supplies a reviewer ID, purpose and 1–30 day grant duration (default seven
days), then explicitly confirms sharing the selected outline revision and those
turns. The selection can be an earlier saved nonempty revision. The current
notebook ETag prevents a concurrent grant/edit from silently using stale context.

The “Outline review inbox” shows requests the user authored or is currently
permitted to review. The checked packet includes the pinned outline's items and
human origin, exact cited turn text and permitted artifact refs, purpose and any
recorded disposition. It excludes uncited turns, parent-turn pointers, notebook
title, outline edit reasons and newer outline revisions. General notebook and
outline endpoints remain author-only even while a reviewer holds a grant.

The named reviewer explicitly declares independence/no conflict and records
accept, reject, defer or needs-evidence with a reason. Decisions are immutable
and tied to the selected revision. Acceptance publishes nothing and does not
establish scientific acceptance. A changed outline needs a new review request;
an earlier disposition is never silently applied to its new revision.

The author can revoke an open or decided grant, including an expired grant, with
a reason. Revocation closes subsequent reviewer reads and decisions immediately;
previous decisions stay recorded. The author can still inspect retained decisions
when their sources are available. Grant expiry uses the database wall clock;
expiry does not delete the decision or rewrite its disposition. There are no
email or chat notifications: requests are available in the application inbox.

## Attachment and permission boundaries

Explicit source-text sharing does not implicitly grant artifact access. Every
attachment revision cited by a granted turn must already be published, available,
scanned clean and retrievable with its lineage in the same workspace. A newer
published artifact revision does not expose an older private revision. The author
must save a turn explicitly referencing the published revision and map the
reviewed outline to that turn. The system never rewrites a private source pin.

Reads and decisions recheck the named reviewer's current role/membership, the
author's current membership, grant expiry/revocation and availability of the
packet's cited attachment sources. Loss of any required permission closes packet
access. Unrelated original notebook turns are not included in the grant. The
author retains content-free request metadata to revoke a grant even when its
source packet is unavailable. Raw purpose/revocation text is available only from
the authorized packet reader, not through general table SELECT.

## Persistence, API and concurrency

Migrations 023–024 add `intake_review_requests` and immutable
`intake_review_decisions`. RLS protects request metadata and decisions; narrow
security-definer functions produce checked packets and perform mutations. No
application-role table writes are granted. A dedicated policy helper keeps the
source-availability helper private rather than exposing a probe for arbitrary
outline IDs. Writes serialize per workspace, require expected versions, and
commit audit/outbox events atomically. Existing idempotency replays receipts
without duplicate requests or decisions.

All routes are under `/v1/workspaces/:w`:

| Route | Contract |
|---|---|
| `POST /sessions/:id/outline-reviews` | Current session ETag; `{outline_revision,reviewer_id,expires_days,purpose,share_sources_confirmation:true}` → request ID/ETag and new session ETag |
| `GET /outline-reviews?after=<id>` | 25 permitted content-free request summaries and next cursor |
| `GET /outline-reviews/:id` | Authorized pinned outline/source packet and retained decision |
| `POST /outline-reviews/:id/decisions` | Request ETag; `{disposition,reason,conflict_declaration:"none"}`; named current independent reviewer only |
| `POST /outline-reviews/:id/revoke` | Request ETag; `{reason}`; author only |

Each notebook permits at most 20 review requests. Purpose/reasons are bounded by
4,000 characters. Packet size is bounded by existing notebook/outline limits:
30 outline items, ten source-turn refs per item, and at most 200 original turns.
Source text grants last at most 30 days. A decided grant remains inspectable by
its reviewer only while its original permission and expiry conditions hold.
Revoking a request preserves its audit trail; it does not erase previously read
content from a recipient's memory or stored copies.

Concurrent decision/revocation attempts share the same version and lock: only
one can succeed against that version. A stale writer must refresh. Revocation
that wins first prevents any later decision under that grant. A decision that
wins first remains immutable; the author can then revoke the newer version.

## Verification and remaining gates

Tests cover explicit disclosure confirmation, self-review denial, exact revision
and source scope, no generic notebook access, immutable/replayed decisions, no
publication, expiry, role/membership loss, private artifact pins, restriction,
revocation and concurrent decision/revocation. The browser journey grants one
revision, verifies the peer sees only the cited turn, records needs-evidence and
revokes future access. Restore verification includes both new tables' RLS.

An older outbox test assumed two 100-event batches drained every persistent test
database. Increased test coverage exposed that assumption. It now drains the
measured initial backlog, checks an empty subsequent delivery, and explicitly
redelivers one test-workspace event to verify exactly one receipt. Worker behavior
was not changed to accommodate the test.

Provider/privacy approval, live-model and hybrid quality evaluation, typed
proposal conversion, broader audience confirmation, atomic publication and
cross-workspace grants remain outstanding. This review grant is confined to one
workspace and cannot authorize public or cross-workspace publication.

Completed checkpoint: type checking, production build, formatting, all 71
application/tool tests and all six browser journeys passed. Restore verification
passed for 1,970 revisions, 59 artifact blobs and 4,890 prior receipts, including
runtime RLS on the new review tables. No live-model quality or publication gate
is claimed by these checks.

## Private registry claim preview

After an independent reviewer accepts an outline, its author can select a claim
in the review inbox and supply a title, scope and language. The preview uses the
registry claim schema. Its proposition, rationale and qualifier come from the
pinned outline item. Its provenance identifies the review, outline revision,
item and exact source turns. Published artifact revisions from those turns become
registry source references. Author-supplied fields remain labelled separately.

`POST /v1/workspaces/:w/outline-reviews/:id/claim-preview` takes the current
review ETag and `{item_id,title,scope,language}`. The server checks current source
access, grant expiry, acceptance and author identity. The preview is ephemeral. The author can save its inputs through POST to the sibling claim-candidates route. The server rebuilds the candidate from the pinned review and records an immutable numbered snapshot (up to 50 per review). GET on that route returns authorized snapshots newest first. Expiry, source restriction and revocation close candidate reads. Audience confirmation and atomic batch publication remain outstanding.
