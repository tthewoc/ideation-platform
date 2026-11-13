import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { transaction, fail, missing } from "./db.js";
import { mutation, workspace, params, precondition, etag } from "./api.js";
import { uuid, reason } from "./schema.js";
export const outlineKinds = [
  "claim",
  "assumption",
  "alternative_hypothesis",
  "question",
  "ethical_constraint",
  "success_criterion",
  "method",
  "task",
] as const;
const canonicalUUID = uuid.transform((v) => v.toLowerCase());
const item = z
  .object({
    id: canonicalUUID,
    kind: z.enum(outlineKinds),
    text: z.string().trim().min(1).max(1000),
    basis: z.enum(["quoted", "human_conjecture", "unknown"]),
    source_turn_ids: z.array(canonicalUUID).min(1).max(10),
    rationale: z.string().max(1000),
    steps: z.array(z.string().trim().min(1).max(200)).max(5),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.kind === "task" && !v.rationale.trim())
      c.addIssue({
        code: "custom",
        message: "Explain why this task is necessary",
      });
    if (v.kind === "method" && !v.steps.length)
      c.addIssue({
        code: "custom",
        message: "Supply at least one method step",
      });
    if (v.kind !== "method" && v.steps.length)
      c.addIssue({
        code: "custom",
        message: "Only methods have ordered steps",
      });
    if (new Set(v.source_turn_ids).size !== v.source_turn_ids.length)
      c.addIssue({ code: "custom", message: "Source turns must be unique" });
  });
export const outlineSave = z
  .object({ items: z.array(item).max(30), reason })
  .strict()
  .refine(
    (v) => new Set(v.items.map((i) => i.id)).size === v.items.length,
    "Outline item IDs must be unique",
  );
export async function installIntakeOutline(app: FastifyInstance) {
  app.get("/v1/workspaces/:w/sessions/:id/outline", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const { w, id } = params(req);
      uuid.parse(id);
      await workspace(c, w);
      const q = z
        .object({ revision: z.coerce.number().int().positive().optional() })
        .strict()
        .parse(req.query);
      const s =
        (
          await c.query(
            "SELECT * FROM intake_sessions WHERE workspace_id=$1 AND id=$2",
            [w, id],
          )
        ).rows[0] ?? missing();
      const revision = q.revision ?? s.outline_version;
      const outline = revision
        ? ((
            await c.query(
              "SELECT revision,items,reason,created_at,origin FROM intake_outline_revisions WHERE workspace_id=$1 AND session_id=$2 AND revision=$3",
              [w, id, revision],
            )
          ).rows[0] ?? missing())
        : {
            revision: 0,
            items: [],
            reason: null,
            created_at: null,
            origin: "human",
          };
      const history = (
        await c.query(
          "SELECT revision,reason,created_at FROM intake_outline_revisions WHERE workspace_id=$1 AND session_id=$2 ORDER BY revision DESC LIMIT 50",
          [w, id],
        )
      ).rows;
      const sources = revision
        ? (
            await c.query(
              "SELECT item_id,turn_id FROM intake_outline_sources WHERE workspace_id=$1 AND session_id=$2 AND outline_revision=$3 ORDER BY item_id,turn_id",
              [w, id, revision],
            )
          ).rows
        : [];
      const branch = (
        await c.query(
          "WITH RECURSIVE branch AS (SELECT id,parent_turn FROM intake_turns WHERE session_id=$1 AND id=$2 UNION ALL SELECT t.id,t.parent_turn FROM intake_turns t JOIN branch b ON t.id=b.parent_turn WHERE t.session_id=$1) SELECT id FROM branch LIMIT 200",
          [id, s.active_turn],
        )
      ).rows.map((r) => r.id);
      return {
        ...outline,
        session_id: id,
        session_etag: etag(s.version),
        latest_revision: s.outline_version,
        history,
        sources,
        missing_categories: outlineKinds.filter(
          (k) => !outline.items.some((i: any) => i.kind === k),
        ),
        outside_active_branch: sources.some((a) => !branch.includes(a.turn_id)),
      };
    }),
  );
  app.post("/v1/workspaces/:w/sessions/:id/outline", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const b = outlineSave.parse(req.body),
        id = uuid.parse(params(req).id);
      const s =
        (
          await c.query(
            "SELECT * FROM intake_sessions WHERE workspace_id=$1 AND id=$2",
            [w, id],
          )
        ).rows[0] ?? missing();
      precondition(req, s.version);
      if (s.outline_version >= 50)
        fail(429, "outline_quota", "Notebook outline revision limit reached");
      const turns = (
        await c.query(
          "SELECT id,original_text FROM intake_turns WHERE workspace_id=$1 AND session_id=$2",
          [w, id],
        )
      ).rows;
      for (const i of b.items) {
        if (i.source_turn_ids.some((id) => !turns.some((t) => t.id === id)))
          fail(
            422,
            "invalid_source_turn",
            "Use saved source turns from this notebook",
          );
        if (
          i.basis === "quoted" &&
          !turns.some(
            (t) =>
              i.source_turn_ids.includes(t.id) &&
              t.original_text.includes(i.text),
          )
        )
          fail(
            422,
            "invalid_quotation",
            "A quotation must occur exactly in a selected source turn",
          );
      }
      const revision = (
        await c.query(
          "SELECT save_intake_outline($1,$2,$3,$4,$5,$6) revision",
          [w, id, s.version, JSON.stringify(b.items), b.reason, req.id],
        )
      ).rows[0].revision;
      return {
        body: { session_id: id, revision, etag: etag(s.version + 1) },
        etag: etag(s.version + 1),
        status: 201,
      };
    }),
  );
}
