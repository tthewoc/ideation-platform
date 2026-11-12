# Requirements

Status: proposed. MUST denotes a release gate; P0 is first slice, P1 a later MVP
slice, P2 deferred. IDs remain stable when implementation details change.

| ID | Priority | Requirement and acceptance criterion |
|---|---|---|
| IAM-01 | P0 | Authenticate users and enforce workspace roles on every read/write. Nonmember requests expose no object metadata, including history, errors and counts. |
| IAM-02 | P0 | Private drafts are readable only by their author until explicitly submitted to named reviewers; publication grants only the confirmed audience access. Revoked sessions cannot continue through cached responses. |
| OBJ-01 | P0 | Stable UUID identity, validated type/version, immutable revision history. Stale ETag writes fail without changing state. |
| OBJ-02 | P0 | Published revisions cannot be edited; corrections create attributable revisions and invalidation events. |
| PRJ-01 | P0 | Many projects reference one atom. Removing a project removes only references. |
| TXN-01 | P0 | Mutation, audit and outbox records commit together; idempotent retries return the original response and conflicting payload reuse fails. |
| GRF-01 | P1 | Edges have identity, type, scope and provenance. Queries are bounded and permission-filtered at every hop. |
| GRF-02 | P1 | Dependency and derivation graphs reject cycles atomically, including concurrent edge inserts. General relevance graphs allow cycles. |
| EVD-01 | P1 | Evidence assessments bind specific evidence/claim revisions, method, polarity and uncertainty. Contradictory interpretations coexist. |
| PROV-01 | P0 | Every mutation records actor, origin, timestamp, request ID and lineage. Export/history obey the same access policy. |
| PROV-02 | P1 | Corrections/retractions mark dependent interpretations stale and visibly incomplete until propagation finishes. |
| RES-01 | P1 | Tasks support dependencies, consent to assignment, null results and replication links with method versions. |
| ART-01 | P1 | Artifact registration enforces size/type limits, quarantine, malware scan, digest verification and license metadata before download. |
| AI-01 | P1 | Bounded jobs produce schema-validated proposals with input revisions, model/prompt versions, cost and human disposition. No AI job directly publishes or assigns work. |
| AI-02 | P1 | Retrieval and prompts recheck permissions at execution; hostile documents cannot authorize tools or reveal hidden atoms. |
| SRCH-01 | P1 | Hybrid lexical, graph and vector retrieval is permission-scoped; indexes rebuild from authoritative revisions. Similarity never merges identity. |
| GOV-01 | P1 | Reviews, disputes, supersession and retraction retain authorship and history; moderators can restrict distribution without silently changing evidence. |
| UX-01 | P0 | Draft, publication, conflict, denial and history flows support keyboard navigation and explicit confirmation; target WCAG 2.2 AA. |
| OPS-01 | P0 | Correlated privacy-safe telemetry, migration/rollback procedure and verified backup restoration accompany releases. |
| PORT-01 | P1 | Authorized JSON export includes versioned schema, stable IDs, provenance and integrity manifest; excludes inaccessible references. |
| MATCH-01 | P1 | Match expertise/equipment/data/funding against availability, qualifications, permissions, geography, conflicts and cost; explain rank and unknowns, support decline/override, and require consent before assignment. |
| FED-01 | P1 | Discover and reuse explicitly shared revisions across workspaces without duplicating identity; revocation hides references, projections and queued AI inputs. External federation transport remains P2. |
| INTAKE-01 | P1 | Preserve original conversational turns; support partial saves, undo, attachments and proportionate clarification before editable proposals and explicit publication. |
| FORM-01 | P1 | Formalisation produces claims, assumptions, alternative hypotheses, questions, ethical constraints, success criteria, methods and tasks with rationale and source revisions. |
| VIS-01 | P1 | Private, workspace, embargoed and public audiences have explicit policy transitions; embargo expiry alone never publishes content. |
| EQV-01 | P1 | Candidate equivalence can be reviewed, rejected and revoked without merging/deleting IDs or changing evidence independence. |
| BATCH-01 | P1 | Publish an approved proposal's objects, edges, lineage, audit and outbox atomically; an invalid reference or conflicting revision publishes none. |
| MFA-01 | P0 | Honor configured OIDC assurance requirements; administrator role changes require fresh MFA when production policy enables it. |

P0 does not claim complete MVP coverage. P1 features remain inaccessible until
their full server, UI, policy and test slice passes. Numeric API and model budgets
are defined in the operations and AI documents and require workload validation.
