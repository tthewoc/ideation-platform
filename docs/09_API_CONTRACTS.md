# API contracts

Status: proposed HTTP v1 contract. All routes require a secure authenticated
session, workspace membership and action authorization; object access is checked
again inside transactions. JSON bodies reject unknown fields. Max JSON body 128 KiB.

## Shared protocol

Prefix `/v1/workspaces/{workspace_id}`. Mutations require Idempotency-Key (UUID)
and CSRF token; changes to existing resources also require If-Match with the
returned opaque ETag. Store request hash and response for 24 hours, scoped to
actor/workspace/route. Same key and body returns original status/body; different
body is 409. Reauthorize before replaying a stored response. Expired keys receive
ordinary concurrency protection but no promise of response replay.

Errors: `{error:{code,message,request_id,fields?}}`; no stack traces or inaccessible
IDs. 400 malformed input, 401 missing/expired session, 403 known workspace action
denied, 404 absent or inaccessible object, 409 invalid state/idempotency conflict,
412 ETag mismatch, 422 schema/reference validation, 428 missing precondition,
429 rate limit, 503 temporary dependency/budget exhaustion. Error field details
must not disclose inaccessible references. Response includes request ID and ETag.

Lists use opaque policy-scoped keyset cursors, default 25/max 100; no global total.
Invalid or policy-stale cursor requires a fresh query. Initial limits per user:
120 reads/minute, 30 writes/minute, 5 graph requests/minute, 3 AI jobs/minute plus
workspace token/currency budget. Return Retry-After on 429. Tune against workload.

| Operation | Method / route | Payload → response | Guard / audit |
|---|---|---|---|
| create_draft | POST /objects | `{type,schema_version,content,origin}` → 201 `{id,revision,lifecycle,etag}` | Member; human cannot forge machine provenance; object.drafted |
| revise_draft | PATCH /objects/{id}/draft | `{content,reason}` → 200 revision | Author + ETag; object.revised |
| read | GET /objects/{id} | → object with provenance/freshness links | Draft owner or published reader |
| history | GET /objects/{id}/revisions | → permitted revision page | No discarded private drafts leaked |
| publish_atom | POST /objects/{id}/publish | `{revision,confirmation:true}` → published revision | Author, validated refs, ETag; object.published |
| correct_atom | POST /objects/{id}/corrections | `{base_revision,content,reason}` → private correction draft | Authorized author/reviewer; object.correction_drafted |
| link_atoms | POST /edges | `{type,from:{id,revision},to:{id,revision},rationale}` → 201 edge | Typed endpoints, graph guards; edge.created |
| assess_evidence | POST /assessments | `{claim_ref,evidence_ref,method_ref,polarity,scope,uncertainty,rationale}` → 201 assessment | Assessor identity, pinned refs; assessment.created |
| create_task | POST /tasks | `{title,criteria,method_ref,dependency_refs}` → 201 task | Member, no cycles; task.created |
| assign_task | POST /tasks/{id}/assignment | `{assignee_id,consent_ref}` → pending/accepted assignment | Coordinator, explicit assignee acceptance; task.assignment_changed |
| submit_result | POST /tasks/{id}/results | `{outcome,method_ref,context,artifact_refs}` → 201 result | Assignee or coordinator; result.submitted |
| register_artifact | POST /artifacts | `{filename,media_type,byte_size,sha256,license}` → quarantine upload instruction | Size/type policy; artifact.registered; not downloadable until scan |
| query_graph | POST /graph/query | `{root_ids,edge_types,depth,cursor?}` → `{nodes,edges,truncated,next_cursor}` | Every hop authorized, budgets; graph.queried metadata |
| retrieve_provenance | GET /objects/{id}/provenance | → bounded permitted lineage | Same graph budgets; provenance.read metadata |
| propose_atoms | POST /ai/intake | `{input_refs,instruction,budget}` → 202 `{job_id}` | Explicit provider consent; ai.queued |
| request_synthesis | POST /ai/synthesis | `{input_refs,question,budget}` → 202 job | Scoped retrieval, budget reservation; ai.queued |
| review_proposal | POST /proposals/{id}/dispositions | `{decision,reason,expected_revision}` → disposition | Human reviewer, no self-accept; proposal.disposed |
| job status/cancel | GET /jobs/{id}; POST /jobs/{id}/cancel | → state; cancellation receipt | Requester/reviewer; job.cancelled |
| export | POST /exports | `{object_ids,format:"json-v1"}` → 202 job | Reauthorize at generation/download; export.requested |

First slice implements only drafts, revisions, read/history, publication, projects
and project references. Project routes: POST /projects `{name}`, POST
/projects/{id}/objects `{object_id}`, DELETE /projects/{id}/objects/{object_id},
DELETE /projects/{id}. All mutations use shared preconditions and audit names
project.created/object_linked/object_unlinked/deleted. Delete never cascades atoms.

Example creation body:
`{"type":"claim","schema_version":1,"content":{"title":"Cooling trial","body":"Protocol A reduces peak temperature under conditions C","language":"en","source_refs":[],"proposition":"Lower peak temperature","scope":"Bench apparatus C","qualifiers":["Unverified"]},"origin":"human"}`.
Creation produces a private draft, never an accepted claim.

## Transaction and publication sequence

```mermaid
sequenceDiagram
  participant U as Human
  participant A as API
  participant D as PostgreSQL
  participant W as Worker
  U->>A: Publish(revision, If-Match, key)
  A->>D: BEGIN; set actor; authorize; lock object
  A->>D: Check key/hash, revision, state and references
  A->>D: Append published revision, audit, outbox, replay response
  A->>D: COMMIT
  A-->>U: 200 + ETag
  W->>D: Claim outbox event
  W->>D: Idempotent projection update / invalidation
```

## State guards

Draft → published: author confirms, schemas valid, referenced inputs permitted.
Published → corrected: create private correction then publish a new revision;
published → disputed/retracted/superseded requires reviewer/moderator reason and
retains history. Reviews are immutable decisions on revisions; later decisions
reference and supersede earlier ones. Task states: draft → open → assigned (with
consent) → in_progress → submitted → completed (reviewer checks criteria), with
cancelled from nonterminal states and returned_for_revision from submitted.
Result states: draft → submitted → reviewed; reviewed results can be disputed or
retracted, never silently overwritten. Artifact states: quarantined → scanning →
available or rejected; available → restricted/retracted. Synthesis follows object
publication with mandatory human review for AI origin. Every transition checks
role, ETag, input freshness, allowed source state and audit event in one transaction.
