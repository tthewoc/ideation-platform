# Graph semantics

Status: proposed. All edges are directed unless explicitly defined symmetric.
General graph cycles are legal; task dependency and derivation cycles are not.

| Edge | Direction / meaning | Guard |
|---|---|---|
| supports / contradicts / qualifies | Evidence → claim | Represent as an assessment with rationale, scope and pinned revisions |
| derived_from | Output → input | Require transformation provenance; reject cycle |
| tests | Method or task → hypothesis | Both revisions exist and are readable |
| depends_on | Task → prerequisite task | Same workspace; reject cycle |
| addresses | Concept → problem | Interpretation recorded, not proof of efficacy |
| uses_method | Task/result → method | Pin protocol revision |
| produces | Task → result/artifact | Require producing actor and method context |
| relevant_to | Atom → atom | Relevance only; inverse not implied |
| part_of | Atom → thesis | Reference, never ownership or cascade deletion |
| supersedes | Replacement → old object | Human review and reason; reject replacement cycles |
| cites | Atom → source | Source access and integrity status visible |
| requires_capability | Task → capability | Requirement does not imply provider consent |
| motivates | Observation/problem → question/concept | Traceable rationale |

Edges themselves have stable IDs, revisions, author, origin, validity interval,
lifecycle and review state. An assessment is a first-class reified relation and
can be reviewed or contradicted without overwriting another assessor's judgment.
Many evidence items may assess many claims; do not infer aggregate certainty
from edge counts. `relevant_to` may be rendered bidirectionally only with an
explicit UI label that neither reverse direction nor identity is asserted.

## Atomic insertion and traversal

For guarded edges, serialize writes by workspace and graph kind using a
transaction-scoped advisory lock. Under that lock, run a bounded recursive cycle
check and insert edge, audit and outbox together. Treat cycle-check budget
exhaustion as rejection, not evidence of acyclicity. Optimize locking only after
concurrency evidence justifies finer partitions.

Query graph defaults: depth 2, maximum depth 4, 500 visible nodes, 1,000 edges,
2-second database statement timeout. Filter every hop using the runtime role.
Return a truncation marker and authorized continuation cursor, never hidden-node
counts. An absent and an inaccessible root both return 404. Rate limit repeated
explorations and prevent expensive degree-count side channels.

## Revision and invalidation rules

Assessments and lineage pin revisions. Ordinary navigation can resolve latest
permitted object revision but must label it separately from the historical input.
A correction creates an outbox event and marks the source as having pending
invalidation in the same transaction. Until propagation completes, derived views
display freshness unknown. Workers walk reverse lineage with visited sets and
idempotent records; downstream interpretations become stale, never auto-corrected.
Retraction shows a prominent source warning even before asynchronous propagation.

Equivalence candidates contain two IDs, reasons, origin and disposition. Approval
adds a reversible equivalence assertion; physical merging/deletion is excluded
from MVP. Projects and theses reference IDs: deleting a view deletes only its
joins. Referenced published atoms use tombstones on withdrawal.
