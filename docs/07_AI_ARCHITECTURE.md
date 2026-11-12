# AI architecture

Status: proposed; AI is disabled until provider, retention and evaluation review.

## Alternatives and choice

| Criterion | Explicit job pipeline | Autonomous multi-agent planner |
|---|---|---|
| Reproducible provenance | Fixed step/input manifests | Requires tracing variable tool chains |
| Permission boundary | Recheck at each stage | Tool delegation broadens review surface |
| Cost and cancellation | Predefined budgets | Unpredictable branching |
| Exploratory breadth | Bounded candidate generation | Potentially broader, harder to evaluate |

Choose an explicit pipeline: authorize → retrieve → generate → schema/grounding
validate → save private proposal → human review. Intake, research design, linking,
synthesis, challenge and matching are prompt roles in the same pipeline, not
independent agents with mutation privileges. Reconsider bounded planners only
after measured pipeline limitations and a separate adversarial evaluation.

## Execution contract

Job input: workspace_id, requester_id, purpose enum, input object/revision IDs,
prompt_version, output_schema_version, idempotency_key, deadline and budget.
Server resolves content through permissions immediately before provider dispatch.
Proposal output: candidate_id, object_type, content, input_refs, assertions with
source_refs, uncertainty, safety_labels and rationale. Reject unknown input IDs,
unbounded text, malformed schemas and citations absent from the supplied manifest.
Schema conformance does not establish scientific correctness.

Persist model/provider version, prompt-template digest, retrieval manifest,
parameters, timestamps, token counts, cost, tool decisions, validation failures and
human disposition. Version the provider adapter; use a deterministic fake in CI
and a separately permissioned live evaluation environment. Do not put provider
secrets in the client or repository. External URL browsing is disabled initially.

Run states: queued → running → validating → succeeded; any nonterminal state may
end failed, cancelled or timed_out. A successful run creates a separate proposal
with pending/accepted/rejected/deferred/needs_evidence disposition. Acceptance
records review only; explicit publication separately reauthorizes all inputs.
Cancellation races cannot publish a proposal: publication checks run completion,
proposal disposition and policy again. Deferred proposals remain private and
expire under policy.

Initial limits: 20 retrieved objects, 16,000 input tokens, 2,000 output tokens,
60-second job deadline and one retry for transient errors within the same budget.
Per-workspace daily currency cap is required configuration before enablement;
reserve budget atomically before dispatch. Unknown provider pricing blocks
dispatch. Honor Retry-After; no retries for schema or authorization failures.

## Retrieval and controls

Combine permission-scoped lexical search, bounded graph traversal and vector
similarity for the target workflow. Validate each channel and fused ranking; keep
indexes rebuildable and filter before reranking and again before prompt creation.
Retrieve challenges and contradictory assessments alongside support. Similarity
does not establish novelty, equivalence or truth. User documents are quoted data,
never tool instructions. Tools expose read-only, narrowly scoped records.

Evaluation gates are specified in the test strategy: deterministic schema and
permission checks, adjudicated attribution and utility scores, hostile-content
tests, cancellation and budget tests. Every model/prompt upgrade reruns the same
versioned corpus. A failing permission case disables deployment regardless of
average quality. A declined proposal changes no accepted graph state.

## Formalisation and matching outputs

Formalisation returns separately typed claims, assumptions, at least one alternative
hypothesis or an explicit insufficiency reason, research questions, ethical
constraints, success criteria, methods and justified tasks. Map each statement to
original turn/input revisions or label it inference. Clarification requests explain
which unresolved field blocks a useful next step; do not force all fields before
partial save. Linking/synthesis includes novelty comparison against permitted
inputs and candidate relationships only, with requests for further evidence as a
first-class review decision.

Capability suggestions contain provider/capability refs, required versus matched
qualifications, availability, location, cost, conflicts, access restrictions,
ranking rationale and unknowns. Permission and availability are hard filters;
unknown qualification/cost blocks automatic recommendation as eligible. Human
coordinators can override ranking with recorded reasons, not override access or
provider consent. Provider decline has no adverse reputation inference.

Vector projections store object/revision, embedding model/version and policy epoch;
re-embedding creates a new projection generation. Rerank authorized candidates
using provenance and domain labels; reject stale permissions before returning
results or sending prompts. Disable the feature on policy failures; record a
quality shortfall as a release blocker for the relevant target slice.
