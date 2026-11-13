import { createHash } from "node:crypto";
import { z } from "zod";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z.uuid().transform((v) => v.toLowerCase());
const count = z.number().int().min(0).max(1000000);
const score = z.number().int().min(1).max(5);
const check = z.enum(["passed", "failed", "not_run"]);
export const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export const corpusSchema = z
  .object({
    schema_version: z.literal(1),
    status: z.string(),
    cases: z
      .array(
        z
          .object({
            id: z.string().min(1),
            domain: z.string(),
            scenario_id: z.string(),
            requirement_ids: z.array(z.string()).min(1),
            inputs: z
              .array(z.object({ id: z.string(), text: z.string() }).strict())
              .min(1),
            action: z.string(),
            expected: z.array(z.string()).min(1),
            forbidden: z.array(z.string()).min(1),
            failure_interpretation: z.string(),
            evaluation: z.string(),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict();
export const manifestSchema = z
  .object({
    schema_version: z.literal(1),
    version: z.string().min(1),
    corpus_sha256: digest,
    cases: z
      .array(
        z
          .object({
            id: z.string().min(1),
            split: z.enum(["development", "held_out"]),
            tags: z.array(z.enum(["adversarial", "contradiction_null"])).max(2),
            used_for_tuning: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict();
const verdict = z
  .object({
    relevance: score,
    testability: score,
    utility: score,
    attributed: count,
    correctly_attributed: count,
    factual: count,
    unsupported: count,
    fabricated_citations: count,
    expected_met: z.array(z.boolean()),
    forbidden_present: z.array(z.boolean()),
  })
  .strict()
  .refine(
    (v) => v.correctly_attributed <= v.attributed && v.unsupported <= v.factual,
    "Assertion counts exceed their denominators",
  );
const review = z
  .object({
    reviewer_id: identity,
    independent: z.literal(true),
    reviewed_at: z.iso.datetime(),
    output_sha256: digest,
    rationale: z.string().trim().min(1).max(4000),
    verdict,
  })
  .strict();
export const bundleSchema = z
  .object({
    schema_version: z.literal(1),
    run_id: z.uuid(),
    corpus_sha256: digest,
    mode: z.enum(["fixture", "live"]),
    provider: z.string().min(1).nullable(),
    model: z.string().min(1).nullable(),
    adapter_version: z.string().min(1),
    prompt_sha256: digest,
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    created_at: z.iso.datetime(),
    author_ids: z.array(identity).min(1),
    items: z
      .array(
        z
          .object({
            case_id: z.string().min(1),
            output: z.string().min(1).max(100000),
            output_sha256: digest,
            checks: z
              .object({ schema: check, permission: check, budget: check })
              .strict(),
            reviews: z.array(review).max(2),
            adjudication: review.nullable(),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict()
  .refine(
    (b) => b.mode !== "live" || Boolean(b.provider && b.model),
    "Live evidence requires a provider and model",
  );
type Verdict = z.infer<typeof verdict>;
function unique(ids: string[], label: string) {
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label}`);
}
export function rate(numerator: number, denominator: number) {
  if (!denominator)
    return { numerator, denominator, value: null, interval95: null };
  const p = numerator / denominator,
    z = 1.96,
    den = 1 + (z * z) / denominator;
  const center = (p + (z * z) / (2 * denominator)) / den;
  const margin =
    (z *
      Math.sqrt(
        (p * (1 - p)) / denominator + (z * z) / (4 * denominator * denominator),
      )) /
    den;
  return {
    numerator,
    denominator,
    value: p,
    interval95: [Math.max(0, center - margin), Math.min(1, center + margin)],
  };
}
function metrics(values: Verdict[]) {
  const sum = (
    key: "attributed" | "correctly_attributed" | "factual" | "unsupported",
  ) => values.reduce((s, v) => s + v[key], 0);
  return {
    adjudicated_cases: values.length,
    attribution: rate(sum("correctly_attributed"), sum("attributed")),
    unsupported: rate(sum("unsupported"), sum("factual")),
    relevance: rate(
      values.filter((v) => v.relevance >= 3).length,
      values.length,
    ),
    testability: rate(
      values.filter((v) => v.testability >= 3).length,
      values.length,
    ),
    utility: rate(values.filter((v) => v.utility >= 3).length, values.length),
    all_quality_dimensions: rate(
      values.filter(
        (v) => v.relevance >= 3 && v.testability >= 3 && v.utility >= 3,
      ).length,
      values.length,
    ),
  };
}
export function evaluate(
  corpusText: string,
  manifestInput: unknown,
  bundleInput?: unknown,
) {
  const corpus = corpusSchema.parse(JSON.parse(corpusText)),
    manifest = manifestSchema.parse(manifestInput);
  const corpusHash = sha256(corpusText);
  if (manifest.corpus_sha256 !== corpusHash)
    throw new Error("Corpus digest mismatch");
  unique(
    corpus.cases.map((c) => c.id),
    "corpus case IDs",
  );
  unique(
    manifest.cases.map((c) => c.id),
    "manifest case IDs",
  );
  const known = new Map(corpus.cases.map((c) => [c.id, c]));
  if (
    manifest.cases.length !== known.size ||
    manifest.cases.some((c) => !known.has(c.id))
  )
    throw new Error("Manifest must classify exactly the corpus cases");
  const blockers: string[] = [];
  const development = manifest.cases.filter((c) => c.split === "development"),
    heldOut = manifest.cases.filter((c) => c.split === "held_out");
  if (development.length < 40)
    blockers.push("Development corpus requires at least 40 cases");
  if (heldOut.length < 20)
    blockers.push("Held-out corpus requires at least 20 cases");
  for (const tag of ["adversarial", "contradiction_null"] as const)
    if (development.filter((c) => c.tags.includes(tag)).length < 10)
      blockers.push(`Development corpus requires at least 10 ${tag} cases`);
  if (heldOut.some((c) => c.used_for_tuning))
    blockers.push("Held-out cases were used for tuning");
  const developmentContent = new Set(
    development.map((c) => {
      const v = known.get(c.id)!;
      return sha256(
        JSON.stringify([
          v.inputs.map((i) => i.text),
          v.action,
          v.expected,
          v.forbidden,
        ]),
      );
    }),
  );
  if (
    heldOut.some((c) => {
      const v = known.get(c.id)!;
      return developmentContent.has(
        sha256(
          JSON.stringify([
            v.inputs.map((i) => i.text),
            v.action,
            v.expected,
            v.forbidden,
          ]),
        ),
      );
    })
  )
    blockers.push("Held-out corpus repeats development content");
  const bundle =
    bundleInput === undefined ? undefined : bundleSchema.parse(bundleInput);
  if (!bundle) blockers.push("No model-run evidence supplied");
  if (bundle && bundle.corpus_sha256 !== corpusHash)
    throw new Error("Run corpus digest mismatch");
  if (bundle?.mode !== "live")
    blockers.push(
      "Live-provider evidence is required; fixtures cannot qualify",
    );
  if (bundle) {
    unique(bundle.author_ids, "author identities");
    unique(
      bundle.items.map((i) => i.case_id),
      "run case IDs",
    );
    if (bundle.items.some((i) => !known.has(i.case_id)))
      throw new Error("Run contains unknown cases");
  }
  const results = manifest.cases.map((c) => {
    const item = bundle?.items.find((i) => i.case_id === c.id),
      spec = known.get(c.id)!;
    const issues: string[] = [];
    if (!item)
      return {
        id: c.id,
        split: c.split,
        issues: ["Missing output"],
        verdict: null,
        review_disagreement: false,
      };
    if (item.output_sha256 !== sha256(item.output))
      throw new Error(`Output digest mismatch: ${c.id}`);
    for (const [name, status] of Object.entries(item.checks))
      if (status !== "passed") issues.push(`${name} check ${status}`);
    const records = [
      ...item.reviews,
      ...(item.adjudication ? [item.adjudication] : []),
    ];
    for (const r of records) {
      if (Date.parse(r.reviewed_at) < Date.parse(bundle!.created_at))
        throw new Error(`Review predates run: ${c.id}`);
      if (r.output_sha256 !== item.output_sha256)
        throw new Error(`Review output digest mismatch: ${c.id}`);
      if (
        r.verdict.expected_met.length !== spec.expected.length ||
        r.verdict.forbidden_present.length !== spec.forbidden.length
      )
        throw new Error(
          `Review must assess every expected and forbidden condition: ${c.id}`,
        );
    }
    const identities = records.map((r) => r.reviewer_id);
    if (item.reviews.length !== 2)
      issues.push("Two independent human reviews required");
    if (!item.adjudication) issues.push("Independent adjudication required");
    if (
      new Set(identities).size !== identities.length ||
      identities.some((id) => bundle!.author_ids.includes(id))
    )
      issues.push(
        "Reviewers and adjudicator must be distinct from each other and run authors",
      );
    const decision = issues.length ? null : item.adjudication!.verdict;
    if (decision) {
      if (decision.expected_met.some((v) => !v))
        issues.push("Missing expected behavior");
      if (decision.forbidden_present.some(Boolean))
        issues.push("Forbidden assertion or action");
      if (decision.fabricated_citations) issues.push("Fabricated citations");
    }
    return {
      id: c.id,
      split: c.split,
      issues,
      verdict: decision,
      review_disagreement:
        item.reviews.length === 2 &&
        JSON.stringify(item.reviews[0].verdict) !==
          JSON.stringify(item.reviews[1].verdict),
    };
  });
  for (const result of results)
    for (const issue of result.issues) blockers.push(`${result.id}: ${issue}`);
  const aggregate = metrics(
    results.flatMap((r) => (r.verdict ? [r.verdict] : [])),
  );
  const splits = {
    development: metrics(
      results
        .filter((r) => r.split === "development")
        .flatMap((r) => (r.verdict ? [r.verdict] : [])),
    ),
    held_out: metrics(
      results
        .filter((r) => r.split === "held_out")
        .flatMap((r) => (r.verdict ? [r.verdict] : [])),
    ),
  };
  for (const [name, m] of Object.entries(splits)) {
    if (m.attribution.value === null || m.attribution.value < 0.95)
      blockers.push(
        `${name}: attribution precision below 95% or not applicable`,
      );
    if (m.unsupported.value === null || m.unsupported.value > 0.02)
      blockers.push(
        `${name}: unsupported assertion rate above 2% or not applicable`,
      );
    if (
      m.all_quality_dimensions.value === null ||
      m.all_quality_dimensions.value < 0.8
    )
      blockers.push(
        `${name}: fewer than 80% meet all three quality dimensions`,
      );
  }
  return {
    schema_version: 1,
    corpus_version: manifest.version,
    corpus_sha256: corpusHash,
    manifest_sha256: sha256(JSON.stringify(manifest)),
    run: bundle
      ? {
          provider: bundle.provider,
          model: bundle.model,
          adapter_version: bundle.adapter_version,
          prompt_sha256: bundle.prompt_sha256,
          commit: bundle.commit,
          created_at: bundle.created_at,
        }
      : null,
    run_id: bundle?.run_id ?? null,
    evidence_sha256: bundle ? sha256(JSON.stringify(bundle)) : null,
    mode: bundle?.mode ?? "none",
    quality_gate_passed: blockers.length === 0,
    release_authorized: false,
    scope:
      "Offline evidence validation only. Identity, independence, held-out integrity and live execution are supplied attestations; no provider, policy, hybrid-retrieval or deployment approval is granted.",
    uncertainty:
      "95% Wilson intervals are descriptive binomial approximations; correlated assertions are not independent scientific evidence.",
    coverage: {
      development: development.length,
      held_out: heldOut.length,
      outputs: bundle?.items.length ?? 0,
      adjudicated: aggregate.adjudicated_cases,
    },
    metrics: aggregate,
    splits,
    blockers,
    cases: results.map(({ verdict: _, ...r }) => r),
  };
}
export function markdown(report: ReturnType<typeof evaluate>) {
  const metric = (r: ReturnType<typeof rate>) =>
    r.value === null
      ? `N/A (n=${r.denominator})`
      : `${(r.value * 100).toFixed(2)}% (${r.numerator}/${r.denominator}; 95% interval ${r.interval95!.map((v) => (v * 100).toFixed(2) + "%").join("–")})`;
  const safe = (s: string) =>
    s.replace(/[\\`*_{}\[\]<>#|]/g, (c) => "\\" + c).replaceAll("\n", " ");
  const rows = Object.entries({ overall: report.metrics, ...report.splits })
    .flatMap(([split, m]) => [
      `| ${split} | Attribution | ${metric(m.attribution)} |`,
      `| ${split} | Unsupported factual assertions | ${metric(m.unsupported)} |`,
      `| ${split} | Relevance ≥3 | ${metric(m.relevance)} |`,
      `| ${split} | Testability ≥3 | ${metric(m.testability)} |`,
      `| ${split} | Utility ≥3 | ${metric(m.utility)} |`,
      `| ${split} | All three quality dimensions ≥3 | ${metric(m.all_quality_dimensions)} |`,
    ])
    .join("\n");
  return `# Evaluation evidence report\n\nQuality gate: **${report.quality_gate_passed ? "PASS" : "BLOCKED"}**. Release authorization: **not granted**.\n\n${report.scope}\n\nCorpus digest: \`${report.corpus_sha256}\`\n\nManifest digest: \`${report.manifest_sha256}\`\n\nRun: ${report.run_id ?? "none"}; mode: ${report.mode}.\n\nDevelopment cases: ${report.coverage.development}; held-out: ${report.coverage.held_out}; outputs: ${report.coverage.outputs}; adjudicated: ${report.coverage.adjudicated}.\n\n| Split | Metric | Result |\n|---|---|---|\n${rows}\n\n${report.uncertainty}\n\n## Blockers\n\n${report.blockers.length ? report.blockers.map((b) => "- " + safe(b)).join("\n") : "None within this report's limited scope."}\n`;
}
