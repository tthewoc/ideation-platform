# Product vision

Status: proposed design; implementation approval pending. This document set refines
the [greenfield brief](GREENFIELD_TECHNICAL_SPECIFICATION.md), not deployed behavior.
Decisions and numerical budgets below are proposed defaults pending review.

## Problem and outcome

Researchers lose context when observations become project documents, evidence is
copied between teams, and AI summaries obscure their sources. Ideator gives each
knowledge object a stable identity and preserves attributable revisions and links.
The first useful outcome is a workspace in which people publish reusable atoms,
inspect their provenance, and challenge an evidence interpretation.

## Actors and journeys

| Actor | Journey | Outcome |
|---|---|---|
| Originator | Record observation, refine draft, publish | Original wording and authorship remain inspectable |
| Researcher | Link claim, method, task and result | Reproducible investigation with null outcomes supported |
| Reviewer | Inspect sources, assess evidence, dispute interpretation | Review is attributable and reversible through new revisions |
| Coordinator | Assemble thesis from shared atoms | No duplication or ownership transfer |
| Provider | Declare capability, accept or decline matching request | No automatic assignment |
| Steward | Moderate, restrict access, investigate audit history | Accountable governance |
| AI agent | Propose structured atoms and candidate links | Human disposition before authoritative mutation |

## Scope and sequence

The first slice covers authenticated workspaces, draft and published observations
and claims, immutable history, project references and permission-scoped retrieval.
Evidence assessments, tasks, artifacts, search and bounded AI follow as complete
vertical slices. A conversational interface is useful only after the same server
invariants protect both human and machine requests.

Non-goals: autonomous laboratory execution, patent advice, financial marketplaces,
universal ontology, automatic equivalence merging, and automatic acceptance of AI
claims. Public publishing, cross-organization federation, and model providers are
later decisions, not requirements for the first slice.

## Assumptions and measurement

Assume an initially small hosted installation, trusted identity provider, private
workspaces by default, adult professional participants, and human reviewers.
Validate jurisdiction, residency, retention and institutional identity requirements
before production. Workspace administrators govern membership but cannot silently
rewrite accepted records. Technical operators require audited break-glass access.

Measure draft-to-published completion, source-inspection success, reviewer time,
unauthorized disclosure incidents, and reuse without duplication. Establish a
baseline with five moderated sessions before setting adoption targets. A release
cannot trade a permissions failure for higher engagement.
