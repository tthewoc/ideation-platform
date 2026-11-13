# Private source-linked structured outline

This increment connects saved human notebook turns to editable structured
interpretations. It advances the provenance and manual formalisation portions of
T24. It does not enable `/ai/formalise`, generate AI content, complete slice 5, or
publish registry objects. Independent review and controlled publication of
private notebook-derived material remain separate work.

## User journey

Inside a private notebook, “Structure this idea privately” supports claims,
assumptions, alternative hypotheses, research questions, ethical constraints,
success criteria, methods and research tasks. Every item includes one or more
saved source turns and an explicit basis: exact quotation, human conjecture, or
unknown/unresolved. An exact quotation must occur literally in at least one cited
original turn. This verifies wording only, not truth or scientific attribution.

Tasks require an explanation of why the task is necessary. Methods require one
to five ordered steps. These are personal outline entries, not registry methods,
assigned tasks or completed research. Categories with no entries are shown as
not yet recorded; nothing fills missing fields with fabricated content. Recording
all categories does not imply correctness or scientific acceptance.

Adding, editing or removing an item requires a revision reason and saves an
immutable whole-outline revision. Earlier revisions remain inspectable. Removing
an item does not remove it or its sources from history. Editing an earlier
revision is disabled; return to the latest revision before changing the outline.
Notebook turns and their original wording are never changed by outline edits.

The current notebook ETag guards outline writes alongside turn/undo writes. A
concurrent notebook change rejects an outdated outline save and retains editor
input. Each source is pinned to an immutable turn, including saved turns outside
the current branch. Undo does not rewrite or silently rebase the outline: the UI
warns when any mapped source is outside the active branch so the author can
inspect the original context. This is a branch-context warning, not a scientific
freshness judgment.

## Persistence and policy

Migration 022 adds `outline_version` to private sessions and immutable
`intake_outline_revisions` / `intake_outline_sources` tables. Revisions carry
human origin, reason and timestamp; each item has a stable UUID and explicit
source mappings. The source table pins each item/revision to actual turns in the
same session. A narrow database function validates category/basis, bounds, source
membership, exact quotation, task rationale and method steps, then commits the
revision, all source mappings, session version and audit/outbox together.

Only the current notebook author can read these tables through PostgreSQL RLS.
There are no application-role INSERT/UPDATE/DELETE grants on either table. A
workspace reviewer or administrator cannot inspect another person's outline.
Membership revocation or restriction of any notebook attachment closes outline
and mapping reads too, including historical revisions. No copied notebook text
appears in search, ordinary knowledge export or the public registry.

## API and bounds

Below `/v1/workspaces/:w/sessions/:id`:

| Route | Contract |
|---|---|
| `GET /outline?revision=<n>` | Latest or selected immutable revision, session ETag, source mappings, revision history, missing categories and active-branch warning |
| `POST /outline` | `{items,reason}` plus current session `If-Match` → new outline revision and session ETag |

Each item has `id`, `kind`, `text`, `basis`, `source_turn_ids`, `rationale` and
`steps`. Item IDs and source IDs are canonical UUIDs; duplicate items/sources and
cross-session turn references are rejected. Unknown fields are rejected. At most
30 items per revision, ten source turns per item and 50 revisions per notebook
are allowed. Statements/rationales are capped at 1,000 characters, steps at 200,
and revision reasons at 4,000. The existing request-byte and database statement
limits also apply. Empty outlines are allowed as explicit revisions; their
missing categories remain visible. Initial revision zero means no saved outline,
not a persisted record or completed formalisation.

The API returns no private text in write receipts. Existing command idempotency
replays a committed receipt without duplicating revisions, mappings or events.
Stale ETags fail before any new state commits. Raw database calls are also guarded
against invalid source mappings, quotations, missing expected versions and quota
overflow.

## Remaining work and validation

These manual entries are not a substitute for full typed registry atoms, typed
relationships, executable method/task references, AI-generated alternatives or
human independent review. Mapping notebook turns into reviewable proposals,
explicitly authorizing the review/publication audience, batch previews and
publication still need implementation. The provider/privacy and live/hybrid
quality gates remain open.

Integration tests cover exact source mapping, immutable edits/removal, replay,
actual runtime-role privacy, attachment restriction, membership revocation,
concurrent edits/undo, branch warnings, all eight categories, fabricated quotes,
invalid tasks/methods, duplicate IDs, unknown sources and bounded revisions.
The browser journey quotes a saved turn, revises it into a labelled conjecture,
inspects the original outline revision, restores an earlier notebook branch,
checks the context warning and records a task with its necessity explanation.
Restore checks include both new tables' runtime-role RLS.

Completed checkpoint: type checking, production build, formatting, all 67
application/tool tests and all six browser journeys passed. The final focused
intake suite passed all eight tests (including missing-version rejection), and
the final outline browser journey passed against the rebuilt UI. Restore
verification passed for 1,612 revisions, 48 artifact blobs and 3,455 prior
receipts, including runtime RLS on the new tables. These results do not establish
AI quality or authorize publication of private source material.
