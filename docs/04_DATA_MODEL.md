# Data model

Status: proposed logical schema; this document is not a migration. UUIDs are
server-generated and timestamps use UTC. Every workspace-scoped foreign key
includes workspace_id to prevent accidental cross-boundary references. Later
sharing uses explicit revision grants; no implicit cross-workspace foreign keys.

| Relation | Essential columns and constraints |
|---|---|
| users | id PK, oidc_issuer, oidc_subject; unique issuer/subject |
| workspaces | id PK, name, policy_version |
| memberships | workspace_id + user_id PK, role enum, revoked_at |
| projects | id PK, workspace_id, name, archived_at |
| objects | id PK, workspace_id, type, current_revision nullable, author_id, lifecycle, row_version, created_at, updated_at, access_policy_id; unique workspace/id |
| revisions | object_id + revision PK, workspace_id, schema_version, content JSONB, origin, actor_id, created_at, parent_revision, reason, integrity_metadata, external_identifiers; append only |
| project_objects | workspace_id + project_id + object_id PK; FKs to project/object; project deletion only deletes join rows |
| edges | id PK, workspace_id, from_id/revision, to_id/revision, type, lifecycle, valid_from/to, actor_id, provenance_id; immutable edge revisions |
| assessments | object_id PK/FK objects, workspace_id, claim_id/revision, evidence_id/revision, method_id/revision, scope, polarity, uncertainty JSONB, rationale, assessor_id, review_state |
| lineage | workspace_id, derived_id/revision, input_id/revision, transformation_id; unique tuple |
| tasks | object_id PK, status, assignee_id nullable, method_id/revision, criteria JSONB; dependencies are guarded edges |
| artifacts | object_id PK, kind, storage_key unique nullable for physical artifacts, sha256, byte_size, media_type, scan_state, license, retention_class |
| reviews | object_id PK/FK objects, workspace_id, target_id/revision, purpose, decision, rationale, reviewer_id, created_at; immutable |
| ai_runs | id PK, workspace_id, requester_id, state, input_manifest, model_version, prompt_version, schema_version, token_usage, cost, deadline |
| proposals | object_id PK, ai_run_id, disposition, disposition_actor, disposition_reason |
| audit_events | id PK, workspace_id, actor, action, target_id/revision, request_id, created_at; append only |
| outbox | event_id PK, workspace_id, kind, payload, attempts, available_at, delivered_at |
| idempotency | workspace_id + actor_id + route + key PK, request_hash, status_code, response, expires_at |
| invalidations | source_id/revision + dependent_id/revision PK, reason, event_id, processed_at |

## Content contracts

All object content has title (1–200 characters), body (0–50,000), language,
source_refs and optional usage_rights. Observation requires context and
observed_at or an explicit unknown time. Claim requires proposition, scope and
qualifiers. Hypothesis additionally requires prediction and falsification criteria.
Result requires method revision, outcome enum (positive, negative, null,
ambiguous, interrupted), measurement context and artifact references. Evidence
requires source and acquisition context. Assessment uncertainty records qualitative
level, rationale and optional calibrated numeric interval with method; a number
without a calibration method is rejected. Type-specific schemas reject unknown
fields and carry versions. No arbitrary executable expressions in content.

## Integrity and access

Slice-1 references must point to existing, permitted revisions in the same workspace.
Later cross-workspace references require the explicit grants defined below.
Published content is immutable; current_revision points to the most recent
published correction, while drafts are private. Historical revisions retain their
visibility rules; publication does not expose discarded private draft revisions.
Published objects cannot revert to private drafts. Retraction changes validity,
not history. A moderation restriction can remove distribution independently.

Use row-level security with transaction-local actor context and a non-owner
runtime database role. RLS expressions enforce active membership and draft
authorship. Composite keys/FKs reinforce RLS; connection-pool transactions must
clear context. Background service access is narrow and audited. Test RLS using
the actual runtime role, not an administrator.

Index objects(workspace_id, lifecycle, updated_at, id), membership(user_id,
workspace_id), edges(workspace_id, from_id, type) and reverse edges, revisions
(object_id, revision DESC), lineage(input_id, input_revision), and pending outbox
(available_at) where delivered_at is null. Use keyset pagination. Full-text GIN
indexes cover only authorized projections; do not place ACL logic in vector math.

## Evolution and retention

Use forward migrations with expand/backfill/contract; deploy readers compatible
with both versions before backfill. Never rewrite historical revision meaning.
Record migration IDs and schema versions in backups and exports. Back up before
destructive operations; rollback application only while schemas remain compatible.
Legal erasure may require content tombstoning and encrypted-blob key destruction;
retain minimal lawful audit metadata rather than promising permanent personal
content. Detailed retention periods require legal approval before production.

## First-slice storage details

All IDs are UUID; revisions and row_version are positive bigint; times are
`timestamptz`. Child relations carry workspace_id, even where the compact table
above omits it, with composite FKs to the parent's unique (workspace_id, id).
Objects.current_revision is nullable until first publication and references a
published revision. Draft content uses `draft_heads(workspace_id, object_id,
author_id, revision, base_published_revision, row_version)`; unique object/author.
Revision numbers are allocated while holding the object row lock. Editing a draft
appends a revision and moves only its author's draft pointer; it never changes the
published pointer. Publication appends a new revision and a publication record,
then removes the published draft head atomically. Reading history joins publication
records or the caller's own draft history, never all revisions of an accessible ID.

`publications(workspace_id, object_id, revision, audience_policy_id, published_by,
published_at)` has unique object/revision. `access_policies(id, workspace_id,
visibility, embargo_until, policy_version)` separates audience from validity.
`submission_grants(object_id, revision, reviewer_id, purpose, expires_at, revoked_at)`
grants only the exact submitted revision and explicitly included permitted inputs.
A reviewer cannot inspect earlier drafts. Published objects never depend on an
unpublished private revision visible only to their author.

Lifecycle events are append-only records `(id, workspace_id, object_id, revision,
axis, from_state, to_state, actor_id, reason, created_at)`; current status is a
projection. Runtime roles cannot UPDATE/DELETE revisions or lifecycle events.
Audit and outbox insertion must be part of each command's transaction. Use FORCE
RLS, no BYPASSRLS and separate schema-owner/migration credentials. Actor context
comes only from authenticated server code; never accept it from request bodies.

Workspace roles are additive memberships in member/reviewer/coordinator/admin/
moderator, not an implicit admin super-role. Project creation requires member;
project mutation/deletion requires its creator or coordinator; add created_by and
row_version to projects. Require (workspace_id, object_id, revision) unique on
revisions and composite FKs for every pinned reference. Delete restrictions retain
published atoms and provenance when a project is removed.

## Remaining type schemas

All following fields are required unless marked optional; strings are 1–50,000
characters, arrays at most 100 entries, references are `{id: UUID, revision: bigint}`.
The common title limit remains 200. Every array may be empty only where stated.

| Type | Required additional content |
|---|---|
| Problem/opportunity | context, affected_actors (nonempty), desired_outcome |
| Concept/proposal | mechanism, addresses_refs (nonempty), assumptions (may be empty) |
| Assumption | premise, reason_unverified, consequences_if_false |
| Question | question, scope, resolution_criteria |
| Method | ordered_steps (nonempty), metrics (nonempty), constraints, ethical_constraints (may be empty) |
| Research task | rationale, acceptance_criteria (nonempty), method_ref; optional dependency_refs |
| Capability/resource | provider_id, kind, qualifications, availability, geographic_constraints, access_conditions, cost_terms, conflicts; explicit unknown values allowed |
| Thesis/synthesis | interpretation, input_refs (nonempty), counterevidence_refs, limitations; last two may be empty with reason |
| Review/assessment | target refs, purpose, decision/polarity, rationale, conflict_declaration, assessor identity; evidence assessment also requires scope/method/uncertainty |
| Agent proposal | run_id, candidate_objects, candidate_edges, input_refs, rationale, uncertainty, safety_labels |
| Artifact | kind enum digital/physical, license, integrity_metadata; digital requires digest/size/storage record; physical requires custodian/location/access protocol |

Review and assessment types use objects/revisions for identity and history;
specialized tables are constrained projections, not independent identities.
Edge identities similarly require `edge_revisions(edge_id, revision, workspace_id,
type, endpoints, origin, provenance_refs, validity, review_state)` and current
pointers; endpoint changes append revisions. Self-edges are rejected for dependency,
derivation and supersession; other types follow declared endpoint semantics.

## Later-slice records

Add sessions and immutable turns (speaker, original_text, sequence, parent_turn,
attachment_refs), undo events and proposal source mappings. Add source_groups and
source_group_members to record shared datasets without implying independent
corroboration. Equivalence assertions have candidate/reviewed/rejected/revoked state,
pinned endpoints and immutable disposition records.

`revision_grants(id, owner_workspace_id, object_id, revision, target_workspace_id,
allowed_uses, expires_at, revoked_at, policy_version)` authorizes reads/reference/
AI/export separately. Target project joins reference grant IDs and the original
object ID; no copy is created. The owner policy controls the revision, target
membership controls the project, and both must allow each use. Visibility of a
relation requires visibility of both endpoints and its own provenance. Sharing
never permits mutation of the owner's object. Tenant-scoped cycle rules remain
local; cross-workspace dependency/derivation edges are disabled pending a reviewed
global cycle protocol. Cross-workspace relevance and thesis references are allowed
through explicit grants.
