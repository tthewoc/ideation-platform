# Ideator — Greenfield Technical Brief & Specification

**Status:** Pre-implementation design input  
**Purpose:** Define the intended system from first principles. This is a target-state specification, not a history of previous development.  
**Rule:** Do not begin implementation until the documentation-first gate in §15 has been satisfied and explicitly approved.

## 1. Product definition

Ideator is a distributed, AI-mediated system for turning informal observations, ideas and research questions into structured, testable, collaborative innovation activity. Its fundamental substrate is a **provenance-preserving network of independently identifiable knowledge objects**. Human participants and AI agents can create, connect, challenge, investigate and synthesise these objects under explicit governance.

The system must support conversational ideation, formalisation, research decomposition, capability matching, investigation, evidence evaluation, cross-network discovery and emergent hypothesis formation.

### Desired outcomes
- Reduce the friction between a vague idea and a researchable question.
- Enable knowledge reuse across disciplines, projects and theses.
- Coordinate investigations across distributed expertise and resources.
- Preserve provenance, context, uncertainty and authorship.
- Suggest non-obvious but defensible connections without treating AI speculation as fact.

## 2. Actors, scope and exclusions

**Actors:** originators, contributors/researchers, expert reviewers, coordinators, capability/resource providers, AI agents and platform stewards.

**Initial scope:** authentication and workspaces; conversational intake; typed knowledge objects; relationship graph; proposal review; evidence and provenance; research tasks and artifact registration; search and graph exploration; bounded AI ideation; abuse controls; observability and documented APIs.

**Initial non-goals:** autonomous laboratory execution, guaranteed scientific truth, definitive patentability decisions, financial marketplaces, token incentives, automatic promotion of AI hypotheses to accepted facts and universal ontology coverage.

## 3. Foundational principles

1. **Atomic identity:** every first-class knowledge object has a durable identity independent of any thesis, project or workspace view.
2. **Typed semantics:** objects and relationships have explicit definitions, validation and versioned schemas.
3. **Composable trajectories:** projects and theses reference reusable objects rather than exclusively owning them.
4. **Provenance by construction:** source, authorship, transformations, reviews and lineage are inspectable.
5. **Epistemic separation:** claims, results, evidence assessments, confidence and review status are distinct.
6. **Non-destructive evolution:** revision, supersession, retraction and correction retain historical records.
7. **Human oversight:** consequential AI-generated mutations require review and policy checks.
8. **Least privilege:** all reads, links, traversals, exports and model inputs respect access control.
9. **Interoperability:** use portable schemas and exports where practicable.

## 4. Canonical domain model

Object families are **semantic categories**, not mandatory tables. The implementation agent must evaluate appropriate physical representations.

### Common object envelope

`id`, `type`, `schema_version`, `lifecycle_status`, `created_at`, `created_by`, `updated_at`, `visibility/access_policy`, `content/content_ref`, `revision`, `provenance_refs`, `integrity_metadata`, optional `license/usage_rights`, and optional external identifiers. Maintain immutable history distinct from mutable read projections.

### Object taxonomy

| Family | Semantics |
|---|---|
| Observation | Raw empirical or experiential input, with context and uncertainty |
| Problem / opportunity | A need, deficiency or potential value to investigate |
| Concept / proposal | Suggested intervention, mechanism, product or research direction |
| Claim | Assessable proposition with scope and qualifiers |
| Hypothesis | Explanatory or predictive proposition with test conditions |
| Assumption | Unverified premise required by an argument or plan |
| Question | Unresolved information requirement |
| Method / protocol | Repeatable investigation plan, constraints and metrics |
| Research task | Assignable work, dependencies, criteria and lifecycle |
| Result | Reported investigation outcome; not automatically evidence |
| Evidence item | Contextualised material bearing on one or more claims |
| Artifact | File, dataset, code, model, document or physical-output record |
| Capability / resource | Expertise, instrument, facility, funding, dataset or access |
| Thesis / synthesis | Higher-order interpretation assembled from referenced atoms |
| Review / assessment | Attributable evaluation of object, relation or inference |
| Agent proposal | Machine-generated candidate awaiting disposition |

### Relationships

Typed, attributable relationships may include `supports`, `contradicts`, `qualifies`, `derived_from`, `tests`, `depends_on`, `addresses`, `uses_method`, `produces`, `relevant_to`, `part_of`, `supersedes`, `cites`, `requires_capability`, `motivates`.

Edges need identity, semantics, direction where applicable, provenance, lifecycle, validity period and review status. For nuanced evidential assertions, consider **reified relationships / assessment objects**: an evidence-to-claim assessment records the claim, evidence, scope, assessor, method, polarity, interpretation and uncertainty. The same evidence may support one thesis and undermine another without duplication.

Similarity is not identity. Support reversible candidate-equivalence and deduplication review; never automatically merge objects solely because embeddings are similar.

## 5. Graph invariants

- Objects may participate in arbitrarily many authorised projects and theses.
- Removing a project or view must not cascade-delete shared knowledge atoms.
- Links and graph traversal must not reveal restricted objects or metadata.
- Accepted evidence assessments require attributable, inspectable provenance.
- Machine-authored content must remain distinguishable from human-authored content.
- Published or accepted objects must not be silently overwritten.
- Corrections and retractions must trigger downstream staleness/invalidation.
- Cycles may be valid in the general graph but restricted in dependency and derivation subgraphs.
- Writes must be idempotent and safe under concurrency.
- Correlated or reused evidence must not be counted as independent corroboration.
- Derived read models (thesis views, provenance paths, evidence matrices, dependency maps, syntheses) must be reproducible from authoritative records.

## 6. User and research workflows

### 6.1 Conversational intake
Accept both fragmentary and complete proposals. AI asks proportionate clarifications, preserves original language, distinguishes user claims from AI inferences, and proposes editable structured objects. Support drafts, undo, partial saves, attachments and explicit confirmation before publication.

### 6.2 Formalisation
Decompose ideas into claims, assumptions, alternative hypotheses, research questions, ethical constraints, success criteria, methods and tasks. Mark conjecture; never fabricate sources; record why each task is necessary.

### 6.3 Capability matching
Match task requirements to expertise, equipment, data, funding and institutional resources. Account for availability, qualifications, permissions, geography where relevant, conflicts and cost. Explain recommendations and permit declines/overrides.

### 6.4 Evidence and results
Capture raw results separately from interpretive evidence assessments. Register artifact integrity, methods, measurement context, licensing and uncertainty. Support positive, negative, null, contradictory and ambiguous results, replication, challenge and correction.

### 6.5 Cross-network ideation
Generate candidate relationships and new theses using existing atoms. Record input IDs, inferential rationale, uncertainty, permissions and novelty checks. Allow review, edit, rejection, deferral and requests for further evidence. Never promote AI suggestions to accepted knowledge automatically.

### 6.6 Lifecycle design
Define explicit authorised state machines for proposals, claims, reviews, research tasks, results, artifacts and syntheses. Separate submission, review, acceptance, publication, dispute, supersession and retraction. The agent must specify exact transition guards and audit events.

## 7. AI architecture

Logical roles (not necessarily separate models): intake, research design, linking, synthesis, challenge, capability routing and evaluation.

**Execution contract:** versioned structured output schemas; input references; model and prompt revision; generated timestamp; safety labels; validated output; idempotency; token/cost telemetry; bounded tools; retries/timeouts; human approval for consequential actions.

**Retrieval:** combine permission-scoped graph traversal, lexical search and vector similarity. Rerank with provenance and domain semantics. Treat similarity as relevance, not truth. Detect contradictory evidence and avoid circular citation of AI summaries as independent evidence.

**Evaluation:** schema validity, groundedness, attribution precision, unsupported assertion rate, link precision/recall, reviewer utility, novelty with relevance, uncertainty calibration, latency, cost, robustness to adversarial content and prompt injection.

## 8. Technical architecture

### Candidate bounded contexts
Identity & Access; Knowledge Registry; Graph & Assessments; Ideation Sessions; Research Coordination; Artifacts & Provenance; AI Orchestration; Search & Discovery; Reviews & Governance; Notifications & Audit.

Prefer a modular monolith initially unless explicit requirements justify service decomposition.

### Persistence
Evaluate a transactional relational store with typed objects and adjacency/edge tables versus a dedicated graph or hybrid model. Prefer authoritative transactions and constraints over prematurely complex infrastructure. Store large artifacts in object storage; use queues/outbox for asynchronous jobs; keep embeddings and search indexes rebuildable.

### APIs
Specify versioned operations for `create_draft`, `propose_atoms`, `review_proposal`, `publish_atom`, `link_atoms`, `assess_evidence`, `submit_result`, `register_artifact`, `create_task`, `assign_task`, `query_graph`, `retrieve_provenance`, and `request_synthesis`.

Each contract must define authentication, authorisation, schema, lifecycle guards, idempotency, optimistic concurrency, rate limits, errors, pagination and audit events.

### Transactional integrity
Atomically commit state transitions and associated audit/outbox records. Guard duplicate retries and concurrent reviews. Prevent partial graph publication and dangling references. Document schema migrations, backward compatibility and recovery.

## 9. Security, privacy, trust and governance

- Secure sessions, MFA readiness, service identities and scoped credentials.
- Enforce access controls in the data layer, including traversal, embeddings and inference surfaces.
- Visibility for private drafts, shared workspaces, embargoed work and public knowledge.
- Data minimisation, lawful processing, retention, erasure workflows and licensing.
- Safe file handling, integrity hashes, malware scanning and untrusted-content rendering.
- Prompt-injection isolation, constrained agent tools and exfiltration safeguards.
- Anti-spam, sybil resistance, fabricated-evidence detection, conflicts of interest and moderation.
- Auditable, contestable review and governance decisions.
- Contextual trust dimensions rather than a single opaque credibility score.
- Dual-use risk assessment before publishing or routing sensitive research.

## 10. User experience

Provide (1) a conversational ideation workspace, (2) a structured editor/review surface, and (3) a graph explorer. Make provenance, uncertainty, review state and authorship visible. Include research task boards, dependency views, evidence polarity, permission indicators, responsive design, keyboard navigation, WCAG 2.2 AA as an accessibility target and portable exports.

## 11. Quality attributes and operations

Define measurable service-level objectives and operational budgets. Candidate design-review targets, **not fixed commitments**: p95 ordinary read APIs under 500 ms excluding model calls; transactional writes under 1 s; durable acknowledged writes; cancellable and observable asynchronous AI jobs.

Require end-to-end tracing, correlation IDs, privacy-safe structured logs, AI cost attribution, operational dashboards, backup/restore drills, secret management, CI/CD, staging, vulnerability scanning, migrations and rollback.

## 12. Independent verification strategy

**The agent must generate its own domain-diverse test cases.** Do not anchor the architecture to preselected example inventions. Derive representative and adversarial scenarios from invariants and failure modes.

Mandatory dimensions:
1. Reuse of a single atom across independent theses without duplication or ownership leakage.
2. Contradictory, conditional, temporal and many-to-many graph relations.
3. Provenance through AI transformations, artifact revisions and downstream invalidation.
4. Null results, replication failure, correlated sources and disputed evidence.
5. Useful cross-domain hypothesis generation versus spurious semantic similarity.
6. Fraudulent artifacts, fabricated citations, coordinated abuse and reputation gaming.
7. Unauthorised traversal, inference leakage, prompt injection and export restrictions.
8. Retries, concurrency, conflicting reviews and interrupted transactions.
9. Dense graphs, high-degree nodes, long-running AI jobs and index rebuilds.
10. Novice onboarding, expert correction, review burden, explainability and accessibility.

Test layers: unit/property-based invariants; integration tests against actual database policies; contract tests; end-to-end journeys; red-team suites; load tests; AI evaluation sets; disaster recovery drills. Every test needs setup, action, expected result, failure interpretation and traceability to requirement IDs.

## 13. Delivery constraints

Plan thin, vertically complete slices ordered by risk retirement and demonstrable value. Each slice must include domain types, migrations, server validation, access policy, APIs, UI where appropriate, telemetry, tests and acceptance evidence. Do not treat a happy-path UI as a completed slice. **No implementation before §15 approval.**

## 14. Open architectural questions

The agent must explicitly resolve or flag:
- Boundaries between claims, hypotheses, results, evidence assessments and syntheses.
- Typed edges versus reified assessments/hyper-relations.
- Relational graph versus graph-native or hybrid persistence.
- Revision granularity, event sourcing and dependency invalidation.
- Shared-object permissions and cross-workspace references.
- AI review gates and consequential mutations.
- Ownership, licensing, embargoes and interoperability.
- Confidence representation and correlated evidence.
- Model/provider abstraction, evaluation budgets and observability.
- MVP scope, slice order and exit criteria.

## 15. Implementation-agent directive: documentation-first gate

You are the lead architect and engineering agent for a **greenfield Ideator implementation**. Treat this brief as intent and constraints, not a prescribed implementation. Identify ambiguity, challenge assumptions, compare alternatives, document decisions and explicitly distinguish requirements from hypotheses. **Do not write application code, migrations or scaffolding until the following documentation is complete and approved.**

### Required documentation

Create the following files (or equivalently comprehensive, clearly mapped documents):

1. `docs/00_PRODUCT_VISION.md` — problem, actors, journeys, non-goals, outcomes and assumptions.
2. `docs/01_DOMAIN_GLOSSARY.md` — precise taxonomy, ontology and epistemic terminology.
3. `docs/02_REQUIREMENTS.md` — stable requirement IDs, priorities and acceptance criteria.
4. `docs/03_SYSTEM_ARCHITECTURE.md` — context/container/component diagrams, boundaries, topology and tradeoffs.
5. `docs/04_DATA_MODEL.md` — schemas, identifiers, constraints, indexing, versioning and migration policy.
6. `docs/05_GRAPH_SEMANTICS.md` — edge semantics, reuse, invariants, equivalence, cycles and invalidation.
7. `docs/06_PROVENANCE_AND_EPISTEMICS.md` — lineage, evidence interpretation, uncertainty and retraction.
8. `docs/07_AI_ARCHITECTURE.md` — orchestration, retrieval, schemas, model governance and review.
9. `docs/08_SECURITY_PRIVACY_TRUST.md` — threat model, permissions, data lifecycle and abuse mitigation.
10. `docs/09_API_CONTRACTS.md` — operations, payloads, errors, authorisation and idempotency.
11. `docs/10_UX_INFORMATION_ARCHITECTURE.md` — journeys, states, interfaces and accessibility.
12. `docs/11_TEST_AND_EVALUATION_STRATEGY.md` — independently generated scenarios, fixtures, adversarial tests and AI benchmarks.
13. `docs/12_OPERATIONS_AND_OBSERVABILITY.md` — deployment, CI/CD, SLOs, monitoring, recovery and costs.
14. `docs/13_DECISION_LOG.md` — ADRs, alternatives, reasoning and reversal criteria.
15. `docs/14_DELIVERY_ROADMAP.md` — slices, dependencies, entry/exit gates and demonstrable outcomes.
16. `docs/15_RISK_REGISTER.md` — technical, epistemic, legal, operational and adoption risks.
17. `docs/16_TRACEABILITY_MATRIX.md` — requirements mapped to architecture, tests and slices.

### Required process

1. Identify ambiguities, contradictions and missing assumptions. Ask targeted questions only when answers materially affect architecture; otherwise document assumptions.
2. Independently generate representative and adversarial use cases across multiple domains. Include evidence reused across theses, contradictory interpretations, emergent hypotheses and permissions edge cases. Do not depend on previously supplied examples.
3. Compare at least two credible graph/persistence designs and two AI orchestration approaches against explicit criteria. Choose defaults with migration triggers.
4. Produce implementable schemas, sequence/state/data-flow diagrams, API contracts and threat scenarios rather than purely aspirational prose.
5. Define deterministic and model-evaluated tests for every important invariant; create a baseline evaluation corpus and expansion strategy.
6. Propose slices ordered by risk retirement and demonstrable user value, with measurable gates.
7. Self-review for contradictions, overengineering, weak assumptions, privilege leaks and unhandled failures; revise the documentation.
8. **STOP.** Present the full documentation set, unresolved questions, architectural decisions and recommended first slice for explicit human approval. Do not implement until authorised.

**Documentation acceptance criterion:** an independent engineer can understand the domain, reproduce the decisions, implement and verify the first slice, and identify outstanding risks without undocumented conversation history.
