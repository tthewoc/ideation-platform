# Data model

Status: proposed logical schema; this document is not a migration. UUIDs are
server-generated and timestamps use UTC. Every workspace-scoped foreign key
includes workspace_id to prevent accidental cross-boundary references.

| Relation | Essential columns and constraints |
|---|---|
| users | id PK, oidc_issuer, oidc_subject; unique issuer/subject |
| workspaces | id PK, name, policy_version |
| memberships | workspace_id + user_id PK, role enum, revoked_at |
| projects | id PK, workspace_id, name, archived_at |
| objects | id PK, workspace_id, type, current_revision, author_id, lifecycle, row_version, updated_at; unique workspace/id |
| revisions | object_id + revision PK, workspace_id, schema_version, content JSONB, origin, actor_id, created_at, parent_revision, reason; append only |
| project_objects | workspace_id + project_id + object_id PK; FKs to project/object; project deletion only deletes join rows |
| edges | id PK, workspace_id, from_id/revision, to_id/revision, type, lifecycle, valid_from/to, actor_id, provenance_id; immutable edge revisions |
| assessments | id PK, workspace_id, claim_id/revision, evidence_id/revision, method_id/revision, polarity, uncertainty JSONB, rationale, assessor_id, review_state |
| lineage | workspace_id, derived_id/revision, input_id/revision, transformation_id; unique tuple |
| tasks | object_id PK, status, assignee_id nullable, method_id/revision, criteria JSONB; dependencies are guarded edges |
| artifacts | object_id PK, storage_key unique, sha256, byte_size, media_type, scan_state, license, retention_class |
| reviews | id PK, target_id/revision, purpose, decision, rationale, reviewer_id, created_at; immutable |
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

References must point to existing, permitted revisions in the same workspace.
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
