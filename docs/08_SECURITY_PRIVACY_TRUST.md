# Security, privacy and trust

Status: proposed threat model. Production identity, jurisdiction and retention
choices remain release blockers; they do not block local documentation review.

## Authorization model

Active members may read published workspace content and create their own drafts.
Authors may edit their own drafts. Reviewer role may accept/reject publication
submissions but cannot review their own consequential submission. Administrators
manage membership and workspace policy; moderation is an explicit audited
permission. Providers must consent to task assignments. Machine identities can
read only job-scoped inputs and write proposals, never publish or grant roles.
Any role elevation requires administrator action and audit. Default deny applies
to unknown types, transitions and actions.

First slice uses self-publication of observations/claims with explicit confirmation,
marked unreviewed. Acceptance as reviewed knowledge remains a separate reviewer
action in the governance slice. No route may equate published with accepted.

## Threat scenarios

| Threat | Controls | Verification |
|---|---|---|
| Guessed ID or cross-workspace reference | RLS, composite FKs, indistinguishable 404 | Actual database role integration tests |
| Traversal/count/export leakage | Per-hop filtering, opaque cursors, uniform errors | Hidden neighbor and revoked-member fixtures |
| Session theft / CSRF | OIDC authorization code + PKCE, HttpOnly Secure SameSite cookies, CSRF token, origin checks | Invalid state/nonce and cross-origin mutation tests |
| Injection / stored XSS | Parameterized queries, strict schema, sanitized Markdown, CSP | Malicious SQL/HTML and link schemes |
| Prompt injection / exfiltration | Read-only tools, untrusted input isolation, destination allowlist, scoped manifests | Hostile artifact cannot fetch secrets or hidden objects |
| Forged evidence / citations | Quarantine, digest check, citation status, review and dispute | Altered upload and nonexistent citation |
| Upload abuse / SSRF | Byte and MIME limits, no arbitrary URL fetch, separate ingestion identity | Oversize, polyglot, redirect-to-private-network tests |
| Reputation gaming / coordinated reviews | Rate limits, conflict declaration, no opaque global score | Self-review and repeated-account scenarios |
| Worker replay / race | Idempotency, transactional outbox, concurrency guards | Crash/retry and simultaneous acceptance tests |
| Operator misuse | Least-privilege roles, audited break-glass, restore audit | Access review and incident exercise |

## Data handling

Encrypt in transit and at rest; store signing and provider credentials in the
deployment secret system. Never log tokens, full prompts, artifact bytes or draft
bodies. Audit actor/action/IDs separately from general application logs. Downloads
require fresh authorization and short-lived signed URLs after scan completion.
Cache keys include policy version; membership revocation invalidates caches and
jobs. Avoid public CDN caching of authenticated responses.

Record license, consent, embargo and source-use restrictions. Export applies the
same current policy and redacts inaccessible content and references rather than
returning hidden counts. Account erasure and lawful retention may conflict with
provenance; minimize identity metadata and use tombstones/key destruction under
approved policy. Backups require time-bounded retention and reapplication of
erasure records on restore. Define exact retention/residency with the operator
before production, including model provider retention and training terms.

Abuse reports can temporarily restrict distribution while retaining authorized
appeal evidence. Log moderation reason and reviewer; allow appeal. Sensitive
research routing and dual-use review are human decisions before external sharing.
No automated capability matching is enabled until that policy is reviewed.

## Submission, visibility and assurance

Explicit submission grants named reviewers access to the selected immutable
revision until disposition/withdrawal/expiry; it does not expose earlier drafts.
Reject self-review when the reviewer is the author, proposal requester or an editor
of the reviewed revision. Recheck conflicts on acceptance. An edited proposal needs
a new submission. Production policy can require recent OIDC MFA via verified
acr/amr/auth_time for membership and role changes; absence of required assurance
fails closed. Local synthetic identity fixtures must be labelled development-only.

Visibility is private, workspace, embargoed or public; publication is a separate
axis. An embargo has an allowed reviewer set and release_not_before timestamp.
Expiry makes release eligible but requires explicit human release and renewed
rights/sensitivity checks. Public publication requires moderator release permission,
license review and source-audience compatibility. Published public reads use a
separate policy-limited endpoint; they do not open authenticated workspace routes.

Cross-workspace reads require active source revision grants and active target
membership. Every read/AI/export rechecks allowed_uses, expiry, revocation and
source policy epoch. Revocation blocks derived views synchronously by their input
grants; asynchronous jobs evict projections afterward. Queued notifications check
recipient access at delivery. A signed artifact URL has a bounded residual access
window (maximum 60 seconds); strict immediate-revocation deployments must proxy
downloads with per-request policy checks. Do not promise recall of downloaded bytes.
