# Slice 5 preparation: evaluation evidence runner

This increment implements offline evidence validation and report generation. It
makes no model calls, generates no human scores, and does not complete slice 5.
The original 12 seed cases and their IDs are unchanged. Their versioned manifest
classifies them as development data already available for tuning. There is no
held-out corpus yet. The runner reports this honestly as blocked.

## Run the seed readiness check

```sh
npm run evaluate
```

This writes `report.json` and `report.md` into a new private `.local/evaluation-*`
directory. Exit codes are 0 for the limited quality gate passing, 2 for a valid
but blocked report, and 1 for malformed inputs or filesystem errors. The seed
check is expected to exit 2: it has 12 development cases, no held-out cases, no
model outputs and no human adjudications. Zero assertion denominators appear as
not applicable, never 100% precision or a demonstrated 0% unsupported rate.

```sh
npm run evaluate -- --corpus path/to/corpus.json --manifest path/to/manifest.json \
  --evidence path/to/evidence.json --out .local/my-evaluation
```

The command does not overwrite existing report files. Inputs are capped at 16 MiB
each. Reports contain case IDs, counts, blockers and provenance metadata; raw
outputs, source text and reviewer rationales remain in the supplied evidence file.
No network or application/database credentials are needed. The command does not
change feature flags, publish proposals, or deploy a model.

## Corpus manifest

`docs/evaluation/manifest-v1.json` binds the seed corpus's exact UTF-8 bytes by
SHA-256. Every corpus ID must appear exactly once in the manifest, with a
`development` or `held_out` split, `adversarial` / `contradiction_null` tags where
applicable, and an explicit `used_for_tuning` boolean. Changing corpus contents
requires a matching versioned manifest digest. Keep original cases and IDs when
curating later versions; this tool validates one snapshot, not repository history.

The gate requires at least 40 development cases, including ten adversarial and ten
contradiction/null cases, plus twenty held-out cases. Tuning on held-out cases
blocks the report. Exact duplicate case content across splits is detected even
when IDs differ. Semantic near-duplicates, case labels, and actual held-out
secrecy still require independent human curation. Do not relabel the existing
seed or synthetic arithmetic unit-test data as unseen evaluation evidence.

## Evidence contract

The strict executable schemas are in `src/evaluation/report.ts`. The checked-in
`docs/evaluation/fixture-example.json` is an incomplete, explicitly synthetic
example. It contains no human reviews and cannot pass the gate.

An evidence bundle includes:

- `schema_version: 1`, UUID `run_id`, the exact `corpus_sha256`, and `mode` (`fixture`
  or `live`). Fixture evidence always blocks live-model qualification.
- Provider/model (required for live evidence), adapter version, prompt-template
  SHA-256, 40-character commit hash, execution timestamp and run-author UUIDs.
- One output per case: `case_id`, raw `output`, its SHA-256, and schema/permission/
  budget check results (`passed`, `failed`, or `not_run`). Every required case must
  have output and all three checks must have passed. These execution results are
  supplied attestations, not independently executed by this offline tool.
- Exactly two independent human reviews and a separate adjudication for each
  case. Each record supplies reviewer UUID, `independent: true`, review timestamp,
  output SHA-256, rationale, and a verdict. All three identities must differ from
  one another and from run authors. Review timestamps cannot predate the run.
  The CLI validates identity declarations; it does not authenticate humans or
  establish that a declared review actually happened.

Every review/adjudication verdict contains integer relevance, testability and
utility scores from 1 through 5; counts `attributed`, `correctly_attributed`,
`factual`, `unsupported`, and `fabricated_citations`; and boolean arrays
`expected_met` and `forbidden_present` in the exact order of the corpus case's
conditions. Numerators cannot exceed their denominators. Unknown fields, unknown
or duplicate IDs, mismatched output hashes, incomplete condition coverage, and
invalid counts are rejected. Reviewer disagreement is retained in the report;
valid independent adjudication determines the scored verdict. Missing reviews
or adjudication block qualification rather than receiving default scores.

## Scoring and limits

Development and held-out splits must each meet at least 95% attribution precision,
at most 2% unsupported factual assertions, and at least 80% of proposals scoring
3 or higher in **all three** quality dimensions. Any forbidden action/assertion,
missing expected behavior, fabricated citation, failed/not-run deterministic
check or incomplete evidence blocks the result regardless of average scores.

Reports include raw numerators/denominators, individual quality dimensions, joint
quality scores, and descriptive 95% Wilson intervals. The documented thresholds
apply to point estimates, not interval bounds. These intervals assume binomial
sampling and do not establish independence among correlated assertions or
scientific validity. A zero denominator leaves the corresponding gate unresolved.

`quality_gate_passed` covers this report's arithmetic, completeness and supplied
attestations only. `release_authorized` is always false. Provider/privacy approval,
authenticated human review, trustworthy execution evidence, hybrid retrieval,
formalisation coverage, operational checks and actual held-out integrity remain
separate release requirements. A hand-authored bundle labeled live is not proof
of live execution. Never use this report alone to enable the provider.

## Verification

Synthetic unit tests cover threshold boundaries, missing evidence, fixtures,
independent identities, tampering and schema failures, held-out contamination,
per-split failures, fabricated citations, all rubric dimensions, zero denominators,
disagreement, CLI exit codes and report overwrite protection. These tests validate
the reporting tool; their artificial passing bundles are not quality evaluations.

Completed checkpoint: type checking, production build, formatting and all 59
application/tool tests passed, including nine evaluator tests. The seed CLI
produced a valid blocked report with 24 blockers (12 development cases, zero
held-out cases, zero outputs, zero adjudications). The documentation fixture
produced a valid blocked report with 27 blockers. Both returned exit code 2 as
specified. No new browser journey or database migration was introduced here.
