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

States: queued → running → validating → awaiting_review; running/validating may
end failed, cancelled or timed_out. Awaiting review becomes accepted, rejected or
deferred. Acceptance uses the ordinary publication transaction and reauthorizes
all inputs. Cancellation races cannot publish a proposal: publication checks job
state and policy again. Deferred proposals remain private and expire under policy.

Initial limits: 20 retrieved objects, 16,000 input tokens, 2,000 output tokens,
60-second job deadline and one retry for transient errors within the same budget.
Per-workspace daily currency cap is required configuration before enablement;
reserve budget atomically before dispatch. Unknown provider pricing blocks
dispatch. Honor Retry-After; no retries for schema or authorization failures.

## Retrieval and controls

Use permission-scoped lexical search and bounded graph traversal. Add vector
similarity only when labeled retrieval evaluation demonstrates benefit; keep
indexes rebuildable and filter before reranking and again before prompt creation.
Retrieve challenges and contradictory assessments alongside support. Similarity
does not establish novelty, equivalence or truth. User documents are quoted data,
never tool instructions. Tools expose read-only, narrowly scoped records.

Evaluation gates are specified in the test strategy: deterministic schema and
permission checks, adjudicated attribution and utility scores, hostile-content
tests, cancellation and budget tests. Every model/prompt upgrade reruns the same
versioned corpus. A failing permission case disables deployment regardless of
average quality. A declined proposal changes no accepted graph state.
