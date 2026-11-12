# Risk register

Status: proposed. Likelihood/impact are qualitative design estimates, not incident
statistics. Owners below are required responsibilities, not assigned people.

| ID | Risk; likelihood / impact | Mitigation and detection | Owner / release gate |
|---|---|---|---|
| R01 | Permission/inference leak; medium / critical | RLS, per-hop checks, cache revocation, hidden-neighbor/export fixtures | Security lead; no known disclosure before any pilot |
| R02 | History or shared atom loss; medium / high | Immutable revisions, noncascading joins, backup restore and T01/T16 | Registry owner; slice 1 |
| R03 | Partial/concurrent publication; medium / high | Transactional audit/outbox, ETags, idempotency, crash injection | API owner; slice 1 |
| R04 | Misleading evidence confidence; high / high | Scoped assessments, correlation warnings, no opaque aggregate score | Domain reviewer; slice 2 |
| R05 | Stale interpretation treated current; medium / high | Pinned inputs, pending-invalidation markers, replayable worker | Graph owner; slice 2 |
| R06 | Fabricated sources/artifact tampering; high / high | Citation status, digest/scan quarantine, human challenge | Research owner; slice 3 |
| R07 | Prompt injection or model exfiltration; high / critical | No mutation tools, scoped retrieval, provider allowlist, hostile corpus | AI/security owner; slice 5 |
| R08 | Unbounded cost or worker retries; medium / high | Reservations, deadlines, retry caps, idempotency and cost alerts | Operator; slice 5 |
| R09 | Privacy/license/retention conflict; medium / critical | Use rights metadata, provider contract review, erasure ledger, legal policy | Operator/legal reviewer; before real data |
| R10 | Dense graph stalls database; medium / high | Depth/result/time budgets, indexed adjacency, dense fixtures | Database owner; slice 2/4 |
| R11 | Coordinated review abuse; medium / high | Conflict disclosures, no self-review, moderation/appeal, rate limits | Governance owner; slice 3/pilot |
| R12 | Architecture overreach delays usefulness; high / medium | Thin registry slice, one DB, staged hybrid retrieval/sharing, deferred external federation/planners | Delivery owner; every slice review |
| R13 | Review burden and novice confusion; high / medium | Clear origin/review/freshness states, accessibility and moderated tests | UX owner; slice 6 |
| R14 | Provider/model drift; high / high | Versioned adapters/corpus, budget and grounding gates, disable AI independently | AI owner; every model release |
| R15 | Backup exists but cannot restore; medium / critical | Isolated measured recovery, erasure replay and artifact integrity checks | Operator; slice 1 and pilot |
| R16 | Residency/identity requirements invalidate defaults; medium / high | Confirm jurisdiction and OIDC integration before production investment | Product/operator; pilot entry |
| R17 | Sensitive research routing causes harm; medium / critical | Disable automated routing, human governance review and opt-in sharing | Governance owner; any matching/federation release |

Residual risks: provenance cannot establish truth, human reviewers may collude,
external providers may retain already-dispatched data, and revoked users may have
copied authorized exports. Communicate these limits in policy and consent rather
than promising technical recall. Revisit risks at each slice exit with evidence,
owner assignment and accepted residual exposure. Unowned critical risks block pilot.

## Risks identified in specification review

| ID | Risk; likelihood / impact | Mitigation and detection | Owner / gate |
|---|---|---|---|
| R18 | Private review impossible or excessive reviewer access; high / high | Exact-revision submission grants, author/requester/editor conflict checks; T20 | Registry/security; slice 2 |
| R19 | Partial AI graph publication; medium / high | Atomic object/edge/ref publication with rollback; T19 | API owner; slice 5 |
| R20 | Grant revocation leaks derived content; medium / critical | Policy epochs and audience intersection, fail-closed read checks; T22 | Security; slice 6 |
| R21 | Specification features silently deferred; high / high | Trace each required workflow to a concrete slice and test; separate first-slice scope from target scope | Delivery owner; design review |
| R22 | Review corpus exists only as prose promises; high / medium | Versioned concrete seed inputs/expected outcomes and explicit expansion gate | AI owner; documentation and slice 5 |
