import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { evaluate, sha256, rate, markdown } from "../src/evaluation/report.js";
const seed = await readFile("docs/evaluation/corpus-v1.json", "utf8");
const seedManifest = JSON.parse(
  await readFile("docs/evaluation/manifest-v1.json", "utf8"),
);
// Artificial scoring fixtures exercise arithmetic/validation only, never human evidence.
function evidence() {
  const base = JSON.parse(seed).cases[0];
  const cases = Array.from({ length: 60 }, (_, i) => ({
    ...base,
    id: `test-${i}`,
    inputs: [{ id: `input-${i}`, text: `Synthetic arithmetic fixture ${i}` }],
  }));
  const corpus = JSON.stringify({
    schema_version: 1,
    status: "Unit-test arithmetic data only",
    cases,
  });
  const manifest = {
    schema_version: 1,
    version: "arithmetic-test",
    corpus_sha256: sha256(corpus),
    cases: cases.map((c, i) => ({
      id: c.id,
      split: i < 40 ? "development" : "held_out",
      tags: i < 10 ? ["adversarial"] : i < 20 ? ["contradiction_null"] : [],
      used_for_tuning: i < 40,
    })),
  };
  const output =
    "Synthetic scoring test; no actual model execution or human assessment.";
  const verdict = {
    relevance: 3,
    testability: 3,
    utility: 3,
    attributed: 100,
    correctly_attributed: 95,
    factual: 100,
    unsupported: 2,
    fabricated_citations: 0,
    expected_met: [true, true],
    forbidden_present: [false, false],
  };
  const person = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const review = (n: number) => ({
    reviewer_id: person(n),
    independent: true,
    reviewed_at: "2026-01-02T00:00:00Z",
    output_sha256: sha256(output),
    rationale: "Synthetic unit-test judgement",
    verdict: { ...verdict },
  });
  const bundle = {
    schema_version: 1,
    run_id: person(8),
    corpus_sha256: sha256(corpus),
    mode: "live",
    provider: "synthetic-test-provider",
    model: "synthetic-test-model",
    adapter_version: "unit-test-v1",
    prompt_sha256: sha256("test"),
    commit: "0".repeat(40),
    created_at: "2026-01-01T00:00:00Z",
    author_ids: [person(1)],
    items: cases.map((c) => ({
      case_id: c.id,
      output,
      output_sha256: sha256(output),
      checks: { schema: "passed", permission: "passed", budget: "passed" },
      reviews: [review(2), review(3)],
      adjudication: review(4),
    })),
  };
  return { corpus, manifest, bundle };
}
test("seed readiness cannot pass with twelve development cases, no outputs or reviewers", () => {
  const report = evaluate(seed, seedManifest);
  assert.equal(report.quality_gate_passed, false);
  assert.deepEqual(report.coverage, {
    development: 12,
    held_out: 0,
    outputs: 0,
    adjudicated: 0,
  });
  assert.equal(report.metrics.attribution.value, null);
  assert.equal(report.metrics.attribution.interval95, null);
  assert.ok(report.blockers.includes("No model-run evidence supplied"));
  assert.match(markdown(report), /N\/A \(n=0\)/);
});
test("threshold arithmetic is inclusive and never grants deployment authorization", () => {
  const { corpus, manifest, bundle } = evidence();
  const report = evaluate(corpus, manifest, bundle);
  assert.equal(report.quality_gate_passed, true, report.blockers.join("\n"));
  assert.equal(report.release_authorized, false);
  assert.equal(report.metrics.attribution.value, 0.95);
  assert.equal(report.metrics.unsupported.value, 0.02);
  assert.equal(report.coverage.adjudicated, 60);
  assert.ok(report.metrics.attribution.interval95![0] < 0.95);
  assert.ok(report.metrics.attribution.interval95![1] > 0.95);
  assert.equal(rate(0, 0).value, null);
  assert.equal(rate(0, 5).value, 0);
  assert.equal(rate(5, 5).value, 1);
});
test("fixtures, incomplete checks and missing outputs are release blockers regardless of scores", () => {
  for (const mutate of [
    (b: any) => {
      b.mode = "fixture";
    },
    (b: any) => {
      b.items[0].checks.permission = "failed";
    },
    (b: any) => {
      b.items[0].checks.budget = "not_run";
    },
    (b: any) => {
      b.items.pop();
    },
    (b: any) => {
      b.items[0].reviews = [];
    },
    (b: any) => {
      b.items[0].adjudication = null;
    },
  ]) {
    const { corpus, manifest, bundle } = evidence();
    mutate(bundle);
    assert.equal(evaluate(corpus, manifest, bundle).quality_gate_passed, false);
  }
});
test("review identities must be independent of authors, each other and the adjudicator", () => {
  for (const mutate of [
    (b: any) => {
      b.items[0].reviews[1].reviewer_id = b.items[0].reviews[0].reviewer_id;
    },
    (b: any) => {
      b.items[0].adjudication.reviewer_id = b.items[0].reviews[0].reviewer_id;
    },
    (b: any) => {
      b.items[0].reviews[0].reviewer_id = b.author_ids[0];
    },
  ]) {
    const { corpus, manifest, bundle } = evidence();
    mutate(bundle);
    assert.ok(
      evaluate(corpus, manifest, bundle).blockers.some((b) =>
        b.includes("must be distinct"),
      ),
    );
  }
});
test("hashes, exact case sets, counts and condition coverage prevent silently mismatched evidence", () => {
  const mutations = [
    (b: any) => {
      b.corpus_sha256 = "1".repeat(64);
    },
    (b: any) => {
      b.items[0].output += " changed";
    },
    (b: any) => {
      b.items[0].reviews[0].output_sha256 = "1".repeat(64);
    },
    (b: any) => {
      b.items[0].adjudication.verdict.expected_met = [];
    },
    (b: any) => {
      b.items[0].adjudication.verdict.correctly_attributed = 101;
    },
    (b: any) => {
      b.items[0].adjudication.verdict.utility = 6;
    },
    (b: any) => {
      b.items[0].reviews[0].reviewed_at = "2025-01-01T00:00:00Z";
    },
    (b: any) => {
      b.items.push(b.items[0]);
    },
    (b: any) => {
      b.items[0].case_id = "unknown";
    },
    (b: any) => {
      b.provider = null;
    },
  ];
  for (const mutate of mutations) {
    const { corpus, manifest, bundle } = evidence();
    mutate(bundle);
    assert.throws(() => evaluate(corpus, manifest, bundle));
  }
  assert.throws(
    () => evaluate(seed, { ...seedManifest, corpus_sha256: "1".repeat(64) }),
    /digest/,
  );
  assert.throws(
    () =>
      evaluate(seed, { ...seedManifest, cases: seedManifest.cases.slice(1) }),
    /exactly/,
  );
});
test("held-out contamination and per-split quality failures cannot hide behind development averages", () => {
  let { corpus, manifest, bundle } = evidence();
  manifest.cases[40].used_for_tuning = true;
  assert.ok(
    evaluate(corpus, manifest, bundle).blockers.some((b) =>
      b.includes("used for tuning"),
    ),
  );
  ({ corpus, manifest, bundle } = evidence());
  for (const item of bundle.items.slice(40))
    item.adjudication.verdict.correctly_attributed = 94;
  const report = evaluate(corpus, manifest, bundle);
  assert.ok(report.blockers.some((b) => b.includes("held_out: attribution")));
  ({ corpus, manifest, bundle } = evidence());
  const parsed = JSON.parse(corpus);
  parsed.cases[40] = { ...parsed.cases[0], id: parsed.cases[40].id };
  corpus = JSON.stringify(parsed);
  manifest.corpus_sha256 = sha256(corpus);
  bundle.corpus_sha256 = sha256(corpus);
  assert.ok(
    evaluate(corpus, manifest, bundle).blockers.includes(
      "Held-out corpus repeats development content",
    ),
  );
});
test("fabrications, missing conditions, forbidden actions and low utility each fail the gate", () => {
  for (const mutate of [
    (v: any) => {
      v.fabricated_citations = 1;
    },
    (v: any) => {
      v.expected_met[0] = false;
    },
    (v: any) => {
      v.forbidden_present[0] = true;
    },
    (v: any) => {
      v.relevance = 2;
    },
    (v: any) => {
      v.testability = 2;
    },
    (v: any) => {
      v.utility = 2;
    },
    (v: any) => {
      v.attributed = 0;
      v.correctly_attributed = 0;
    },
    (v: any) => {
      v.factual = 0;
      v.unsupported = 0;
    },
  ]) {
    const { corpus, manifest, bundle } = evidence();
    bundle.items.forEach((i) => mutate(i.adjudication.verdict));
    assert.equal(evaluate(corpus, manifest, bundle).quality_gate_passed, false);
  }
});
test("review disagreement remains visible alongside the adjudicated result", () => {
  const { corpus, manifest, bundle } = evidence();
  bundle.items[0].reviews[0].verdict.relevance = 1;
  const report = evaluate(corpus, manifest, bundle);
  assert.equal(report.quality_gate_passed, true);
  assert.equal(report.cases[0].review_disagreement, true);
});
test("CLI emits a blocked seed report, excludes raw output and refuses to overwrite evidence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ideator-evaluation-"));
  try {
    const run = () =>
      spawnSync(
        process.execPath,
        ["--import", "tsx", "scripts/evaluate.ts", "--out", dir],
        { encoding: "utf8" },
      );
    const result = run();
    assert.equal(result.status, 2, result.stderr);
    const report = JSON.parse(await readFile(join(dir, "report.json"), "utf8"));
    assert.equal(report.quality_gate_passed, false);
    assert.equal(report.release_authorized, false);
    const original = await readFile(join(dir, "report.json"), "utf8");
    assert.equal(run().status, 1);
    assert.equal(await readFile(join(dir, "report.json"), "utf8"), original);
    assert.ok(
      !(await readFile(join(dir, "report.md"), "utf8")).includes("Bench fins"),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
