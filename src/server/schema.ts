import { z } from "zod";
export const uuid = z.uuid();
export const text = z.string().trim().min(1).max(50000);
export const reason = z.string().trim().min(1).max(4000);
export const ref = z
  .object({ id: uuid, revision: z.number().int().positive() })
  .strict();
export type Ref = z.infer<typeof ref>;
const common = {
  title: z.string().trim().min(1).max(200),
  body: z.string().max(50000),
  language: z.string().min(2).max(20),
  source_refs: z.array(ref).max(100),
};
export const claim = z
  .object({
    ...common,
    proposition: text,
    scope: text,
    qualifiers: z.array(text).max(100),
  })
  .strict();
export const observation = z
  .object({
    ...common,
    context: text,
    observed_at: z.iso.datetime().nullable(),
  })
  .strict();
export const hypothesis = claim
  .extend({ prediction: text, falsification_criteria: text })
  .strict();
export const method = z
  .object({
    ...common,
    ordered_steps: z.array(text).min(1).max(100),
    metrics: z.array(text).min(1).max(100),
    constraints: z.array(text).max(100),
    ethical_constraints: z.array(text).max(100),
  })
  .strict();
export const result = z
  .object({
    ...common,
    method_ref: ref,
    outcome: z.enum([
      "positive",
      "negative",
      "null",
      "ambiguous",
      "interrupted",
    ]),
    measurement_context: text,
    artifact_refs: z.array(ref).max(100),
  })
  .strict();
export const evidence = z
  .object({
    ...common,
    source: text,
    acquisition_context: text,
    source_group_ids: z.array(uuid).max(100).default([]),
  })
  .strict();
export const uncertainty = z
  .object({
    level: z.enum(["low", "medium", "high", "unknown"]),
    rationale: text,
    interval: z
      .tuple([z.number().min(0).max(1), z.number().min(0).max(1)])
      .optional(),
    calibration_method: text.optional(),
  })
  .strict()
  .refine(
    (v) =>
      !v.interval || (!!v.calibration_method && v.interval[0] <= v.interval[1]),
    "An ordered interval and calibration method are required together",
  );
export const assessmentFields = {
  claim_ref: ref,
  evidence_ref: ref,
  method_ref: ref,
  polarity: z.enum(["supports", "contradicts", "qualifies", "inconclusive"]),
  scope: text,
  uncertainty,
  rationale: text,
};
export const assessment = z.object({ ...common, ...assessmentFields }).strict();
export const thesis = z
  .object({
    ...common,
    interpretation: text,
    input_refs: z.array(ref).min(1).max(100),
    counterevidence_refs: z.array(ref).max(100),
    limitations: text,
  })
  .strict();
export const task = z
  .object({
    ...common,
    rationale: text,
    acceptance_criteria: z.array(text).min(1).max(100),
    method_ref: ref,
  })
  .strict();
export const artifact = z.discriminatedUnion("kind", [
  z
    .object({
      ...common,
      kind: z.literal("digital"),
      filename: z
        .string()
        .min(1)
        .max(150)
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9._ -]*$/),
      media_type: z.enum(["text/plain", "text/csv", "application/json"]),
      byte_size: z
        .number()
        .int()
        .min(1)
        .max(1024 * 1024),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      license: reason,
      retention_class: z.literal("workspace").default("workspace"),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("physical"),
      license: reason,
      custodian: reason,
      location: reason,
      access_protocol: reason,
      integrity_metadata: reason,
    })
    .strict(),
]);
export const schemas = {
  artifact,
  claim,
  observation,
  hypothesis,
  method,
  result,
  evidence,
  assessment,
  thesis,
  research_task: task,
};
export const objectType = z.enum([
  "artifact",
  "claim",
  "observation",
  "hypothesis",
  "method",
  "result",
  "evidence",
  "assessment",
  "thesis",
  "research_task",
]);
export const createObject = z
  .object({
    type: objectType,
    schema_version: z.literal(1),
    content: z.unknown(),
  })
  .strict()
  .transform((v) => ({ ...v, content: schemas[v.type].parse(v.content) }));
export function content(type: string, value: unknown) {
  return schemas[objectType.parse(type)].parse(value);
}
export type Content = ReturnType<typeof content>;
export function references(body: Content): Ref[] {
  const refs: Ref[] = [...body.source_refs];
  for (const key of ["claim_ref", "evidence_ref", "method_ref"] as const)
    if (key in body) refs.push((body as any)[key]);
  for (const key of [
    "artifact_refs",
    "input_refs",
    "counterevidence_refs",
  ] as const)
    if (key in body) refs.push(...(body as any)[key]);
  return [...new Map(refs.map((r) => [`${r.id}:${r.revision}`, r])).values()];
}
export const named = z
  .object({ name: z.string().trim().min(1).max(200) })
  .strict();
export const roles = z
  .array(z.enum(["member", "admin", "coordinator", "reviewer", "moderator"]))
  .min(1)
  .max(5);
