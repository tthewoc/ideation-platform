# Domain glossary

Status: proposed; normative terms for this design set.

| Term | Meaning and boundary |
|---|---|
| Atom | Independently identified typed object; not a project-owned document fragment |
| Observation | Reported experience or measurement with context; not proof of a claim |
| Problem / opportunity | Need or potential value, without asserting a solution works |
| Concept / proposal | Suggested intervention requiring investigation |
| Claim | Scoped proposition that can be assessed |
| Hypothesis | Claim with predictive or explanatory content and stated test conditions |
| Assumption | Premise used without verification; must be explicitly marked |
| Question | Unresolved information need |
| Method / protocol | Repeatable procedure, constraints and metrics |
| Research task | Assignable work with criteria and dependencies |
| Result | Outcome under a method, including null or failed replication |
| Evidence item | Material contextualized for assessment; not intrinsically supportive |
| Assessment | Attributable interpretation of a specific evidence revision against a claim revision |
| Artifact | Integrity-checked reference to bytes or a physical-output record |
| Capability / resource | Offered expertise, equipment, data or access with availability and restrictions |
| Thesis / synthesis | Interpretation assembled from referenced atoms; does not own them |
| Review | Decision on a particular revision and purpose, with rationale |
| Agent proposal | Machine-generated candidate with inputs and run metadata awaiting human disposition |
| Revision | Immutable snapshot of content and its creation context |
| Project | Authorized organizational view referencing atoms without ownership |
| Workspace | Membership and policy boundary, initially the sole sharing boundary |
| Provenance | Recorded origin and transformations; not a guarantee of correctness |
| Confidence | Assessor's qualified belief, distinct from lifecycle and review state |
| Stale | Dependency changed after an interpretation was made; requires reassessment |
| Retraction | Withdrawal of validity while preserving permitted historical access |
| Supersession | Explicit replacement by a different object or revision |
| Equivalence candidate | Reversible suggestion of shared identity; never an automatic merge |

An object has a home policy workspace, which administers access but does not define
its identity. Its UUID remains stable across projects, theses and authorized sharing.
Cross-workspace references use explicit revision grants, described in the data and
security documents; they do not clone or transfer ownership of atoms. Slice 1
enforces same-workspace references until those grant controls are implemented.

Human, imported and machine authorship are separate origin categories. A human
accepting machine content does not convert its origin to human. Visibility,
publication, evidence polarity, confidence and acceptance are independent fields.
