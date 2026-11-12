# Traceability matrix and documentation review

Status: proposed requirements mapped to design and planned verification. Test IDs
refer to [test strategy](11_TEST_AND_EVALUATION_STRATEGY.md); they have not run.

| Requirement | Design documents | Verification | Slice |
|---|---|---|---|
| IAM-01 | 03 architecture, 04 data, 08 security, 09 API | T09, actual-role RLS, session/revocation contracts | 1, extended 4/5 |
| IAM-02 | 04 data, 08 security, 10 UX | T09 private draft/history/cache cases | 1 |
| OBJ-01 | 04 data, 09 API | Schema/property tests, T12 stale edit | 1 |
| OBJ-02 | 04 data, 05 graph, 06 provenance | T03 correction/history, immutable-write integration | 1/2 |
| PRJ-01 | 04 data, 05 graph, 09 API | T01 project deletion and shared ID | 1 |
| TXN-01 | 03 architecture, 09 API, 12 operations | T11 crash/replay, T12 concurrent transition | 1 |
| GRF-01 | 05 graph, 08 security, 09 API | T02 typed assessment, T09 hidden hops, T13 bounds | 2/4 |
| GRF-02 | 05 graph, 09 API | T12 concurrent cycle inserts, generated cycle tests | 2 |
| EVD-01 | 01 glossary, 04 data, 06 provenance | T02/T03/T05 contradiction/scope/correlation | 2 |
| PROV-01 | 04 data, 06 provenance, 09 API | T01/T03/T11 lineage/audit/history; origin schema tests | 1, extended 5 |
| PROV-02 | 05 graph, 06 provenance, 12 operations | T03/T05 invalidation, worker crash/replay | 2 |
| RES-01 | 04 data, 09 API, 10 UX | T04 null replication, consent/state contracts | 3 |
| ART-01 | 04 data, 08 security, 09 API | T08 digest/scan/quarantine and unsafe upload tests | 3 |
| AI-01 | 06 provenance, 07 AI, 09 API | T06/T07/T14, schema/grounding corpus and budget reservation | 5 |
| AI-02 | 07 AI, 08 security | T09/T10/T14 permission/injection/revocation | 5 |
| SRCH-01 | 03 architecture, 05 graph, 07 AI | T09/T13 rebuild/permission and hybrid retrieval | 4/5 |
| GOV-01 | 08 security, 09 API, 10 UX | T02/T12/T18 dispute/review/moderation | 2/3 |
| UX-01 | 10 UX | T15 browser/keyboard/screen reader and moderated sessions | 1, expanded 6 |
| OPS-01 | 12 operations | T16 restore/rollback, migration tests, load/trace checks | 1, expanded 7 |
| PORT-01 | 06 provenance, 08 security, 09 API | T17 export revocation/license/integrity | 4 |
| MATCH-01 | 04 data, 07 AI, 09 API, 10 UX | T23 constraints, decline/override/consent | 6 |
| FED-01 | 03 architecture, 04 data, 08 security, 09 API | T22 grant/revocation/derived access | 6 |
| INTAKE-01 | 04 data, 07 AI, 09 API, 10 UX | T24 original turns/undo/partial saves/attachments | 5/6 |
| FORM-01 | 07 AI, 09 API | T24 decomposition and source attribution | 5 |
| VIS-01 | 04 data, 08 security, 09 API | T22 embargo/release/audience tests | 6 |
| EQV-01 | 04 data, 05 graph, 09 API | T21 reversible equivalence, stable IDs | 2 |
| BATCH-01 | 05 graph, 09 API | T19 rollback all published objects/edges | 5 |
| MFA-01 | 08 security, 12 operations | T20 assurance and role-change tests | 1 |

## Brief coverage

Brief §§1–3 → vision/glossary/requirements; §§4–5 → data/graph/provenance;
§6 → API/UX/roadmap; §7 → AI/test strategy; §8 → architecture/data/API;
§9 → security/risk; §10 → UX; §11 → operations; §12 → test strategy;
§13 → roadmap; §14 → decision log; §15 → this full 00–16 documentation set.

## Self-review findings and resolution

- Publication and acceptance initially risked conflation: separate lifecycle and
  review dimensions, self-publication marked unreviewed, consequential AI changes
  require a separate human disposition.
- Stable revisions and private drafts can leak discarded text: history policy
  explicitly excludes unpublished private revisions from publication access.
- Asynchronous invalidation can leave a misleading interval: increment content epochs
  atomically and show unknown freshness on derived views until revalidated.
- Cycle checks can race: serialize guarded writes per workspace/graph kind before
  checking reachability; test reciprocal simultaneous inserts.
- Initial workspace boundaries must not remove target cross-network discovery:
  implement explicit revision grants and revocation in slice 6; external federation
  transport alone remains deferred.
- Permanent provenance can conflict with erasure: retain minimal lawful metadata,
  apply tombstones/key destruction, replay erasure ledger after restoration.
- Design targets can be mistaken for evidence: all model thresholds and SLOs are
  provisional; no app, migration or application tests exist yet. A concrete design-time corpus
  seed now exists; model execution and release-size expansion remain outstanding.

## Review status and outstanding decisions

The 17 required documents are drafted. No implementation approval has been
recorded. Remaining production decisions concern operator, identity issuer,
residency/retention, provider terms, budgets and governance ownership. Recommended
approval scope is slice 1 with synthetic data and a local test identity provider.
Review [decisions](13_DECISION_LOG.md), [risks](15_RISK_REGISTER.md) and
[roadmap](14_DELIVERY_ROADMAP.md) before authorizing application scaffolding.

## Review evidence

The review covered all 17 documents against brief §§1–15. Corrected scope drift
(hybrid retrieval, matching, sharing), draft/publication storage, reviewer grants,
independent review, origin attribution, run/proposal lifecycle separation,
idempotent replay ordering, atomic publication, derived-data revocation and
freshness, type schema coverage and the missing concrete evaluation seed.

Documentation validation checks IDs, links and corpus consistency. It does not
establish that PostgreSQL policies, APIs, model quality or browser behavior work.
The design remains proposed, with the production questions listed above; publishing
documents to GitHub is not an implementation approval event.
