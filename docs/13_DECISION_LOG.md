# Decision log

Status: all decisions proposed for documentation review, not implementation approval.

| ADR | Decision | Alternatives and reason | Reversal trigger |
|---|---|---|---|
| ADR-001 | Modular monolith and one authoritative database | Microservices increase distributed transaction/recovery work before scale evidence | Independently measured deployment/scaling needs and stable context contracts |
| ADR-002 | PostgreSQL typed JSONB + explicit edges/assessments | Graph-native hybrid improves traversals but complicates policy and atomicity | Representative bounded queries miss agreed SLO after indexing; add derived graph first |
| ADR-003 | Immutable revisions with mutable current pointers | Full event sourcing increases replay/schema complexity; mutable rows lose history | Projection/replay needs demonstrably exceed revision/outbox design |
| ADR-004 | Assessment is a first-class relation pinned to revisions | Simple supports/contradicts boolean edge cannot represent scope, method and disagreement | No expected simplification; evolve schema with versions |
| ADR-005 | One workspace policy boundary initially | Immediate federated object ACLs enlarge inference and sharing risks | Reviewed cross-workspace access/revocation contract and adversarial fixtures |
| ADR-006 | Explicit AI job pipeline, human publication | Autonomous planners increase budget/tool surface and evaluation cost | Measured missing utility plus independently passing planner safety evaluation |
| ADR-007 | Lexical + graph search first | Vector similarity adds indexing/privacy work before labeled retrieval evidence | Corpus demonstrates improved recall without permission/precision regression |
| ADR-008 | Separate publication from acceptance | Treating publish as scientific approval conflates distribution and knowledge status | Governance review only; never conflate truth with visibility |
| ADR-009 | No aggregated confidence or identity auto-merge | Scores hide correlation; embeddings confuse relevance with equivalence | Validated domain calibration or reversible reviewed equivalence design |
| ADR-010 | Node 24/TypeScript, Fastify, React, PostgreSQL 17 | Python/Django offers batteries; TS shares schemas and keeps initial stack small | Team expertise, official support lifetime or measured library needs change |
| ADR-011 | OIDC and server-side secure sessions | Custom password/auth adds credential lifecycle risk | Deployment cannot supply approved identity provider; review alternative explicitly |
| ADR-012 | Transactional outbox and idempotent consumers | External queue dual-writes can lose or duplicate transitions | Outbox throughput measured insufficient; preserve atomic intent |
| ADR-013 | Serialize guarded graph writes per workspace | Fine-grained locking permits concurrent cycle races if poorly designed | Lock contention demonstrated, replacement proven under concurrency tests |

## Ambiguities resolved by default

The brief's shared atoms are reused across independent theses inside a workspace
first, with cross-network discovery deferred. Human self-publication is allowed
for unreviewed ordinary observations/claims; reviewed acceptance and consequential
AI mutations require a distinct reviewer. A claim correction creates a new
revision and freshness warning rather than erasing the old statement. Public
discovery, global reputation, legal trust scores and automatic routing are excluded
from early MVP. These choices are reversible scope defaults, not hidden requirements.

## Questions that remain before production

Who operates and reviews the pilot? Which institutions, identity issuer, jurisdiction,
residency and retention obligations apply? Which provider terms permit sending
workspace content? What spending/support budgets and abuse escalation process are
approved? Who approves sensitive research routing? None requires secrets in chat.
First-slice local implementation can proceed after documentation approval using
synthetic users and a test identity provider; production and AI enablement cannot.
