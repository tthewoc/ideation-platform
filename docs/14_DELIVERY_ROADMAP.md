# Delivery roadmap and approval gate

Status: the user authorized coding on 2026-11-12 after the documentation review.
**Slices 1–4 have working implementations.** See the latest
[implementation evidence](20_RETRIEVAL_EXPORT_IMPLEMENTATION.md). Slice 5 has
[local workflow preparation with linked resubmission, review history and expiry](21_LOCAL_PROPOSAL_WORKFLOW.md); live AI and quality
gates remain outstanding.
The greenfield brief §15 requires completed documents and explicit human approval
before application code, migrations or scaffolding. Review this set as one design.

## Recommended first slice

Build authenticated private drafts and explicitly published observations/claims,
immutable history, workspace permissions, project references and atomic audit/outbox.
Demonstration: Alice publishes an observation, Bob reads its history and references
the same ID from two projects; deleting one project preserves the atom; outsider
Eve cannot discover it; concurrent edits and retrying publication do not lose or
duplicate state. This retires identity, ownership, concurrency and provenance risk
before model integration.

| Slice | Scope / dependencies | Exit evidence |
|---|---|---|
| 0 documentation | This complete set and human review | Explicit approval recorded with remaining scope decisions |
| 1 registry foundation | Approved design; pinned tools, OIDC test provider, PostgreSQL; observation/claim, draft/publication, history/projects | T01/T09/T11/T12 edit subset/T15 basic/T16; build/typecheck, schemas, API/browser, real RLS tests, migration/restore instructions and working smoke journey |
| 2 graph and assessments | Slice 1; typed edges, evidence/result/method, scoped assessments, review/dispute/retraction, invalidation | T02/T03/T05/T12 graph/review/T13; contradictory views, cycles rejected under concurrency, stale propagation visible |
| 3 research and artifacts | Slice 2; tasks/consented assignment, dependencies, null results, quarantined storage, scan/digest/license | T04/T08/T18; result-to-method/artifact chain and rejected unsafe upload demonstrated |
| 4 retrieval and export | Slice 3; lexical/graph retrieval, vector projection foundation, rebuilds, authorized portable JSON | T09 all surfaces/T13/T17; revoke access during export, rebuild equivalence, bounded graph |
| 5 bounded AI intake | Slice 4; provider/privacy review, budgets, versioned fixtures, required hybrid ranking, formalisation, job pipeline, human dispositions and atomic publication | T06/T07/T10/T14/T19/T24; hybrid ranking and live corpus thresholds, cancellation/budget checks, no direct publication, recorded provenance |
| 6 sharing and capability workflow | Slice 5; revision grants, public/embargo release, cross-workspace discovery, matching/decline/override; complete conversational undo/partial save and evidence requests | T19–T24 and T15 full journey; grant revocation during retrieval/AI, provider consent, keyboard/screen-reader evidence |
| 7 pilot hardening | All MVP slices; operational/legal review, observability, incident/recovery practice | Load SLOs at agreed scale, restore/rollback drill, security review, documented ownership |

Every slice includes domain schemas, migration, server policy/validation, API,
usable UI, telemetry and relevant tests. A route or screen without its integrity
and access checks does not satisfy a slice. Feature flags keep incomplete routes
disabled; no placeholder passing tests. Each earlier slice includes its usable UI;
slice 6 integrates and extends those journeys rather than delaying all UX. External
federation transport and autonomous planners remain beyond this roadmap. All
required in-installation workflows must pass before claiming specification coverage.

## Review packet

Read product/requirements, architecture/data/graph, provenance/AI/security, then
contracts/UX/tests/operations and decision/risk/traceability documents. Confirm
workspace-only initial scope, separate publication/review, immutable history,
PostgreSQL, OIDC and bounded AI. Resolve conflicting feedback in ADRs and update
traceability before implementation. Production questions in the decision log may
remain deferred if slice 1 is explicitly approved for local synthetic development.

The subsequent explicit instruction to commence coding authorizes slice 1 after
the completed documentation review. Do not ask for that approval again.
Do not treat creation of this packet or environment publication as design approval.
