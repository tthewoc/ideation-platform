# Operations and observability

Status: proposed operational contract. The local first-slice workflow is now implemented; use the tested commands in
[README](../README.md). Production operation and release targets below remain
proposed until their individual checks are completed.

## Development and deployment

Target Node 24 LTS with npm lockfile, PostgreSQL 17, local test OIDC provider and
containerized integration dependencies. Pin exact versions and checksummed images
at implementation. First slice must provide scripts for frozen install, database
migration, development startup, typecheck, build and meaningful tests. Later add
quarantined object storage and worker services. Use existing cloud checkout;
do not create worktrees unless explicitly requested. No production credentials
are needed for local fixtures. Never fabricate provider keys.

Required runtime configuration names (proposed, not declared cloud requirements):
DATABASE_URL, OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, SESSION_SECRET,
APP_ORIGIN. Later: OBJECT_STORAGE_ENDPOINT/BUCKET, storage identity, model provider
identity and AI_DAILY_BUDGET. Decide actual destinations before requesting network
access; inspect existing bindings without printing values. Use local fixtures
where supported. Hosted OIDC/model endpoints require separate access validation.

## Release pipeline

1. Frozen dependency installation, license/dependency vulnerability review.
2. Typecheck, production build, unit/property and HTTP contract tests.
3. PostgreSQL migrations from empty and prior supported schema; actual-role RLS
   integration and concurrency/crash tests.
4. Browser publication/history/project journeys and accessibility checks.
5. Staging deployment with synthetic smoke tests, backup restore and rollback drill.
6. Human release review; progressive traffic, monitor error and latency budgets.

Model/prompt releases additionally require corpus evaluation and provider privacy
review. Keep app rollback compatible with expanded schema. A destructive schema
change needs verified backup, explicit maintenance plan and forward repair path.
CI failure blocks deployment; no automatic publishing of AI content.

## Provisional budgets and monitoring

| Signal | Initial target / response |
|---|---|
| Ordinary API latency | p95 reads <500 ms, writes <1 s at 20 concurrent synthetic users |
| Availability | Proposed 99.5% monthly for pilot; agree support coverage before commitment |
| Graph workload | 2-second statement budget, max 500 nodes/1,000 edges; return truncation |
| AI workload | 60-second deadline; explicit token/currency reservations and workspace cap |
| Outbox lag | Alert after 60 seconds; pause derived freshness claims until caught up |
| Recovery | Proposed RPO 15 minutes, RTO 4 hours; verify by restore drill before pilot |
| Permission failures | Alert on anomalous deny rates; any confirmed disclosure triggers incident procedure |

Instrument request IDs and trace IDs across API, transactions and jobs. Metrics:
route latency/error, pool saturation, query timeout, outbox attempts/lag,
invalidation backlog, job cancellation/deadline/cost and scan failures. Logs contain
IDs and error codes, not bodies, secrets, prompts or artifact bytes. Restrict audit
access separately from dashboards. Avoid sensitive high-cardinality metric labels.

## Recovery and incidents

Encrypted database base backups plus continuous WAL retention support point-in-time
recovery; version artifact storage and back up integrity manifests. Restore into
isolated infrastructure, verify schema/row integrity, RLS, artifact digests and
outbox deduplication, reapply erasure/revocation ledger, then smoke test before
traffic. Measure achieved RPO/RTO rather than inferring from backup success.

On suspected leak: restrict affected routes/jobs and revoke compromised access,
preserve minimal audit evidence, determine scope, notify operator under incident
policy, repair and regression test. On model failure disable AI independently of
registry operations. On stale projection rebuild from authoritative records;
never modify accepted records to match a broken index. Reconcile worker events
by event ID. Document pilot incident owner and escalation channel before launch.

## Durability and projection readiness

Acknowledge writes only after PostgreSQL commits with fsync and synchronous_commit
on. RPO is a disaster-recovery budget, not permission to acknowledge uncommitted
writes. If the deployment promises survival of primary loss, require synchronous
replication and document its failure policy before advertising that guarantee.

Run an outbox worker in slice 1 to demonstrate durable event delivery and replay;
later consumers are added by feature. Report content/policy epoch lag, revoked
input revalidation, vector generation coverage and rank quality per model version.
Never return stale authorization on worker outage. Hybrid retrieval and sharing
release checks include rebuilding projections during membership/grant revocation.
Workspace release policy, MFA assurance and embargo checks belong in smoke tests.

## Local proposal review deadlines

`FIXTURE_REVIEW_DAYS` is an optional integer from 1 to 90, default 30. The API
snapshots a deadline into each new local fixture run; changing the setting does not
extend existing proposals. Migration 020 backfills existing records from creation
time using 30 days. Expiry uses the PostgreSQL wall clock at mutation time, without
a worker sweep. It prevents review, linked resubmission and publication of expired
private proposals, while preserving history and published objects. Configure and
monitor database time consistently. This is not a data-deletion or legal-retention
policy, and does not enable a provider or live AI.
