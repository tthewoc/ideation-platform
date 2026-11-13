# Private conversational intake increment

This implements the human-authored partial-save and undo portion of T24. It is
independent of live AI and does not complete slice 5 or slice 6. The notebook
stores fragments before any structured claim, method or research fields are
required. It does not generate clarifications, formalise a turn, create registry
objects or publish anything. Those later actions remain separate and gated.

## User journey

Open “Private idea notebook” in a workspace, give the notebook a title, and save
an incomplete note. Original text, including whitespace, line breaks and language,
is preserved exactly. Each save appends a human-authored immutable turn with a
sequence number and parent pointer. There is no AI speaker or inferred claim.

Select a saved turn (or the empty branch), supply a reason, and restore the active
pointer. Later turns stay in history. The next save branches from the restored
turn; sequence numbers remain monotonic across all branches. Refresh/reopening a
notebook recovers saved text and undo reasons. A conflicting save retains the
unsaved editor text and asks the user to refresh rather than overwriting history.

The attachment picker offers currently loaded registry artifacts that are available,
digital and scanned clean. Attachments are immutable object/revision references,
not copied bytes or storage URLs. Use the existing artifact registration/upload
workflow; this increment adds no unscanned upload route. Attachment-only turns are
allowed. Both empty text and no attachments are rejected. Physical artifact custody
records are not digital note attachments.

## Privacy and integrity

Only the author, while a current workspace member, can read a session or its
turns/undo events. Workspace reviewers and administrators do not gain notebook
access from their role. These rules hold in HTTP and actual PostgreSQL RLS.

Every attachment must reference an existing readable revision whose artifact is
available and has a clean scan verdict. Private clean artifacts can be attached
by their owner. Restricting an attachment makes the entire referencing notebook
unavailable, including inactive branches and session listings; undo cannot bypass
that restriction. This conservative policy avoids exposing source-derived text
from an older branch. It preserves stored records and does not erase history.
Membership revocation similarly closes every new notebook read/write.

Migration 021 adds `intake_sessions`, `intake_turns` and `intake_undo_events`.
Application credentials have SELECT only on these tables. Narrow database
functions serialize writes per workspace, validate author/current membership,
versions, active-parent pointers and attachment access, and commit audit/outbox
records atomically. Composite foreign keys prevent cross-session parent/active/
undo pointers. No update/delete grants exist for original turns or undo records.
Existing command idempotency prevents duplicate state/audit writes on replay.
Responses to writes contain identifiers/pointers/ETags, not copied note content.

## API and limits

All routes are below `/v1/workspaces/:w` and require ordinary authenticated
membership. Mutations also require CSRF and an idempotency key; turn/undo writes
require the current session `If-Match` ETag.

| Route | Contract |
|---|---|
| `POST /sessions` | `{title}` → private session ID, null active turn and ETag |
| `GET /sessions?after=<id>` | 25 permitted session summaries and next cursor |
| `GET /sessions/:id` | Author-only session, all bounded turns and undo events |
| `POST /sessions/:id/turns` | `{text,attachment_refs,parent_turn}` → new immutable turn and active pointer |
| `POST /sessions/:id/undo` | `{target_turn,reason}` → changed active pointer, retained history |

Titles are 1–200 characters; each original note is at most 8,000 characters and
has at most ten clean digital attachment refs. Each session allows 200 turns and
200 undo events; each author can create at most 50 sessions per workspace in a
rolling 24-hour window. Restricted sessions still consume the creation allowance.
Lists use keyset pagination; detail responses are bounded by the session limits.
The existing request size, statement timeout and per-user HTTP rate limits apply.

The active parent must match the submitted parent; stale ETags fail without new
turns or events. Undo can select any saved turn in the same session or an empty
branch, but does not repeat a no-op pointer change. Quotas are enforced again at
the database boundary, and failed writes roll back all associated records.

## Remaining work

No `/ai/formalise` route is enabled by this increment. Explicit source mappings
from session turns to proposed structured atoms, provider consent, proportionate
AI clarification, typed formalisation/decomposition, batch preview and publication
still need implementation and evaluation. Notebook export/erasure/retention and
cross-workspace sharing are also pending; ordinary knowledge-object export does
not silently include private notebook content.

## Verification

Integration tests exercise exact original text, no registry publication, actual
runtime-role privacy and immutable history, concurrent stale-write rejection,
undo replay/branching, cross-session pointer rejection, clean/private/restricted
attachment checks, revocation, bounded writes, daily allowance and pagination.
Attachment policy fixtures use trusted metadata setup; real scanner coverage
continues in the research/artifact integration suite. Browser coverage follows
two users through partial saves, undo, a new branch and reload, verifies the peer
cannot see the notebook, and runs an axe accessibility scan. Restore verification
includes the new tables' runtime-role RLS.

Completed checkpoint: type checking, production build, formatting, all 64
application/tool tests and all six browser journeys passed. Restore verification
passed for 1,485 revisions, 44 artifact blobs and 3,011 prior receipts, including
runtime RLS on the new intake tables. These results cover human partial intake;
no AI formalisation or model quality gate is claimed.
