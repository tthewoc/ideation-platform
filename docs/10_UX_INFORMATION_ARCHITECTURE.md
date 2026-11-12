# UX and information architecture

Status: proposed. Navigation: workspace switcher, inbox/proposals, knowledge,
projects/theses, research tasks, graph, and administration according to role.
First slice exposes only workspace, knowledge and projects; unavailable features
have no active controls that imply working behavior.

## Primary journeys

1. A member creates an observation or claim. The editor labels it private, saves
   revisions, preserves original text and presents type validation inline.
2. Preview shows exact content, references and the workspace audience. Explicit
   Publish confirms distribution; it does not label the claim accepted or true.
3. A second member reads the published revision and opens history/provenance.
   A project adds the existing ID; another project can add the same object.
4. Correction starts from a specified revision. A stale ETag presents a comparison
   and lets the author manually reconcile without dropping either version.
5. A reviewer sees machine origin, input revisions, contradictions, uncertainty,
   cost and freshness before accept/edit/reject/defer. An edit retains lineage.
6. A researcher records a null result, attaches a protocol and artifact, and
   creates a scoped evidence assessment. Contrary interpretations appear together.

## Interaction states

| Surface | Required states and actions |
|---|---|
| Editor | Empty, dirty, saving, saved, validation error, offline, conflict; retry preserves text |
| Publication | Audience preview, confirmation, submitting, success, denial; repeated clicks deduplicate |
| Knowledge detail | Lifecycle, review, origin, uncertainty, freshness, license and provenance always separate |
| Graph | Loading, empty, truncated, inaccessible root, selection, filtered accessible neighbors; list alternative |
| Job | Queued, running, validating, awaiting review, failed, cancelled, timed out; budget and cancellation visible |
| Review | Input missing/revoked, stale, accepted, rejected, deferred; disable acceptance when prerequisites fail |
| Artifact | Quarantined, scanning, available, rejected, restricted; no unsafe preview |
| Membership loss | Clear local cached content, show access change, preserve only permitted unsent input |

Do not show hidden-object titles, neighbor counts or distinct missing/denied
messages. Explain permitted staleness without revealing revoked source details.
Retraction banners link to the reason where authorized. Avoid color-only polarity
or confidence labels. Do not display a single scientific credibility score.

## Accessibility and evaluation

Target WCAG 2.2 AA: semantic headings/forms, labels and error associations,
visible focus, logical tab order, sufficient contrast, reduced motion and announced
async updates. All graph actions must have a keyboard-operable table/list path.
Modal publication confirmation traps/restores focus and supports Escape before
submission. Mobile layouts preserve audience and provenance indicators.

Evaluate with novice and expert sessions: publish without confusing review state,
find a source, identify a contradiction, correct a stale draft and reuse an atom
without copying. Record completion, errors and time; iterate with consented,
anonymized observations. Automated accessibility scans supplement keyboard and
screen-reader checks, not replace them.
