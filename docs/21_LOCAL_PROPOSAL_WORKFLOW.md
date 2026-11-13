# Slice 5 preparation: local proposal workflow

The user requested continued slices. Slice 4 is implemented; this document records
bounded local preparation for slice 5, **not completion of slice 5**. No approved
provider/data policy has been supplied. No external AI provider is called and no
live model is enabled. The existing 12-case design corpus remains review material,
not an executed or human-adjudicated quality benchmark.

## What is implemented

In local development, the interface explicitly offers “Local proposal workflow
test — no AI model.” A requester selects up to 20 published inputs, supplies a test
instruction, names a distinct current reviewer and acknowledges fixture mode. A
deterministic adapter restates a short portion of supplied text with prominent
fixture/uncertainty labels. Instructions and source text are data; there are no
model tools, outbound requests or automated graph commands.

The real workflow around that fixture is implemented:

- Versioned queued/running/succeeded/failed/cancelled/timed-out runs, bounded by a
  60-second deadline and a worker token. Expired or cancelled work cannot finalize.
- Immutable pinned input references and an inspectable input manifest. Permissions,
  source validity and workspace epochs are checked before processing and publication.
  Private run/proposal reads reauthorize inputs and the reviewer's current scope.
- Input/output budgets of at most 16,000/2,000 conservative UTF-8 byte units. These
  are safe local test bounds, not measured model token usage. A transactional daily
  allowance of 100,000 units is allocated before work; cancellation does not refund
  it. No currency is charged and no provider-pricing claim is made.
- Private schema-validated claim candidates with references restricted to supplied
  inputs. Only the requester and named current reviewer can inspect proposals.
- Independent accept/reject/defer/needs-evidence decisions with a no-conflict
  declaration, immutable reasons and version checks. Acceptance publishes nothing.
- Separate requester-confirmed atomic publication. Every candidate and source is
  validated; one invalid candidate rolls back the whole batch. Publication preserves
  origin, pinned lineage and proposal linkage, and leaves scientific review unreviewed.
- Existing runtime idempotency, CSRF, quotas, current membership and audit/outbox
  rules. Worker state transitions emit audit events. Publication replay is exactly
  once through the command's idempotency key.

Fixture publications use the machine-origin field and a conspicuous fixture label.
They cannot be edited through generic draft/correction routes to erase origin. A
new human interpretation may cite them explicitly through the ordinary registry.
This does not imply that a model generated the fixture: every fixture's body and
qualifiers say no model inference occurred.

## Local API

`GET /v1/ai/capabilities` reports `live_ai: false` and whether local fixture routes
are available. All other routes below are under `/v1/workspaces/:w` and are registered
only when `LOCAL_DEVELOPMENT=true`.

| Route | Contract |
|---|---|
| `POST ai/intake` | `adapter:"fixture-v1"`, explicit acknowledgement, input refs, independent reviewer, instruction and budgets → queued run |
| `GET ai/runs` | Latest 25 permitted runs with state, version and observed fixture units |
| `POST ai/runs/:id/cancel` | Requester; run ETag; only queued/running work |
| `GET ai/proposals` | Latest 25 private permitted candidates and dispositions |
| `POST ai/proposals/:id/decisions` | Named current reviewer, proposal ETag, decision/reason/no-conflict declaration |
| `POST ai/proposals/:id/publish` | Requester, accepted proposal ETag and explicit audience confirmation |

Migrations 014–017 add scoped run/proposal projections, immutable decisions,
atomic allowance/publication functions, source reauthorization and state audit.
Worker functions do not accept a caller-selected arbitrary requester identity.
Budget reservations and epochs are persisted in PostgreSQL. A crash leaves running
work to expire rather than silently dispatching a duplicate. There is no fixture
retry because the deterministic adapter has no transient provider failures.
Deferred/needs-evidence proposals are retained for inspection; revised work requires
a new run. Configurable proposal retention/resubmission are still pending.

## Gates still required before slice 5 can be declared complete

- An approved provider/model, retention and training terms, permitted data classes,
  credentials through environment settings, pricing and per-workspace currency caps.
- A real provider adapter with measured tokens/cost, budget reservation/reconciliation,
  bounded transient retries, provider-consent enforcement and dispatch-time checks.
- Actual versioned embeddings and permission-scoped hybrid lexical/graph/vector
  retrieval. The slice 4 vector schema is only a foundation; synthetic vectors are
  used solely for storage/permission tests, not semantic-quality claims.
- Formalisation beyond a fixture claim: methods, justified research tasks, alternative
  hypotheses, questions, ethical constraints and mappings to original inputs/turns.
- Prompt/template/provider provenance, cancellation against live execution, complete
  proposal resubmission/retention policy and production operational checks.
- Expansion to the documented 40 development/20 held-out cases, adversarial and null/
  contradiction coverage, two independent human reviewers with adjudication, and
  passing attribution/unsupported-assertion/relevance/testability/utility thresholds.

No blocked quality gate is replaced by a deterministic fixture assertion. Later
sharing/matching and pilot-hardening slices remain dependent on their own contracts
and release evidence.

## Validation

Integration tests exercise the real application and worker roles: explicit fixture
acknowledgement, private scope, stable supplied references, independent disposition,
publication separation and replay, origin preservation, cancellation races, expiry,
revocation before processing, stale publication denial, atomic batch rollback,
concurrent daily allowance and reviewer-scope removal. Browser validation follows
two synthetic users through request, review and separate publication, including
an axe scan. These checks validate workflow mechanics, not AI output quality.

The completed checkpoint passed type checking, the production build, all 47
integration tests and all five browser journeys. Restore verification passed for
735 revisions and 20 artifact blobs, including runtime row-level security,
source integrity, audit/outbox links and receipt deduplication.
