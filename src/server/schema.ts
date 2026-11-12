import { z } from "zod";
export const uuid = z.uuid();
const text = z.string().trim().min(1).max(50000);
export const ref = z
  .object({ id: uuid, revision: z.number().int().positive() })
  .strict();
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
export const createObject = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("claim"),
      schema_version: z.literal(1),
      content: claim,
    })
    .strict(),
  z
    .object({
      type: z.literal("observation"),
      schema_version: z.literal(1),
      content: observation,
    })
    .strict(),
]);
export function content(type: string, value: unknown) {
  return (type === "claim" ? claim : observation).parse(value);
}
export const named = z
  .object({ name: z.string().trim().min(1).max(200) })
  .strict();
export const roles = z
  .array(z.enum(["member", "admin", "coordinator", "reviewer", "moderator"]))
  .min(1)
  .max(5);
