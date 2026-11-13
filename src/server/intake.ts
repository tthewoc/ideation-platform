import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { transaction, fail, missing } from "./db.js";
import { mutation, workspace, params, precondition, etag } from "./api.js";
import { uuid, ref, reason } from "./schema.js";
async function session(c: PoolClient, w: string, id: string) {
  return (
    (
      await c.query(
        "SELECT * FROM intake_sessions WHERE workspace_id=$1 AND id=$2",
        [w, uuid.parse(id)],
      )
    ).rows[0] ?? missing()
  );
}
export async function installIntake(app: FastifyInstance) {
  app.post("/v1/workspaces/:w/sessions", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const b = z
        .object({ title: z.string().trim().min(1).max(200) })
        .strict()
        .parse(req.body);
      const count = (
        await c.query(
          "SELECT count(*)::int n FROM intake_sessions WHERE workspace_id=$1 AND created_at>now()-interval '1 day'",
          [w],
        )
      ).rows[0].n;
      if (count >= 50)
        fail(429, "intake_quota", "Daily private session limit reached");
      let id: string;
      try {
        id = (
          await c.query("SELECT create_intake_session($1,$2,$3) id", [
            w,
            b.title,
            req.id,
          ])
        ).rows[0].id;
      } catch (e) {
        if (
          (e as { code?: string }).code === "23514" &&
          (e as Error).message === "Intake session limit reached"
        )
          fail(429, "intake_quota", "Daily private session limit reached");
        throw e;
      }
      return {
        body: { id, active_turn: null, etag: etag(1) },
        etag: etag(1),
        status: 201,
      };
    }),
  );
  app.get("/v1/workspaces/:w/sessions", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const { w } = params(req);
      await workspace(c, w);
      const q = z.object({ after: uuid.optional() }).strict().parse(req.query);
      const rows = (
        await c.query(
          "SELECT id,title,active_turn,version,created_at FROM intake_sessions WHERE workspace_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT 26",
          [w, q.after ?? null],
        )
      ).rows;
      return {
        items: rows.slice(0, 25).map((s) => ({ ...s, etag: etag(s.version) })),
        next: rows.length > 25 ? rows[24].id : null,
      };
    }),
  );
  app.get("/v1/workspaces/:w/sessions/:id", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const { w, id } = params(req);
      await workspace(c, w);
      const s = await session(c, w, id);
      const turns = (
        await c.query(
          "SELECT id,sequence,parent_turn,speaker,original_text,attachment_refs,created_at FROM intake_turns WHERE workspace_id=$1 AND session_id=$2 ORDER BY sequence LIMIT 200",
          [w, id],
        )
      ).rows;
      const undo_events = (
        await c.query(
          "SELECT id,from_turn,target_turn,reason,created_at FROM intake_undo_events WHERE workspace_id=$1 AND session_id=$2 ORDER BY created_at,id LIMIT 200",
          [w, id],
        )
      ).rows;
      return { ...s, etag: etag(s.version), turns, undo_events };
    }),
  );
  app.post("/v1/workspaces/:w/sessions/:id/turns", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const b = z
        .object({
          text: z.string().max(8000),
          attachment_refs: z.array(ref).max(10).default([]),
          parent_turn: uuid.nullable(),
        })
        .strict()
        .refine(
          (b) => b.text.trim().length > 0 || b.attachment_refs.length > 0,
          "Text or an attachment is required",
        )
        .parse(req.body);
      const s = await session(c, w, params(req).id);
      precondition(req, s.version);
      if (s.active_turn !== b.parent_turn)
        fail(
          409,
          "parent_conflict",
          "Refresh before adding a turn to the active branch",
        );
      if (s.next_sequence > 200)
        fail(429, "intake_quota", "Session turn limit reached");
      for (const a of b.attachment_refs)
        if (
          !(
            await c.query("SELECT intake_attachment_readable($1,$2,$3) ok", [
              w,
              a.id,
              a.revision,
            ])
          ).rows[0].ok
        )
          fail(
            422,
            "invalid_attachment",
            "Attachments must be permitted clean digital artifact revisions",
          );
      const turn = (
        await c.query("SELECT append_intake_turn($1,$2,$3,$4,$5,$6,$7) id", [
          w,
          s.id,
          s.version,
          b.parent_turn,
          b.text,
          JSON.stringify(b.attachment_refs),
          req.id,
        ])
      ).rows[0].id;
      return {
        body: {
          id: s.id,
          turn_id: turn,
          active_turn: turn,
          etag: etag(s.version + 1),
        },
        etag: etag(s.version + 1),
        status: 201,
      };
    }),
  );
  app.post("/v1/workspaces/:w/sessions/:id/undo", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const b = z
        .object({ target_turn: uuid.nullable(), reason })
        .strict()
        .parse(req.body);
      const s = await session(c, w, params(req).id);
      precondition(req, s.version);
      if (s.active_turn === b.target_turn)
        fail(409, "unchanged_turn", "That turn is already active");
      if (
        b.target_turn &&
        !(
          await c.query(
            "SELECT 1 FROM intake_turns WHERE session_id=$1 AND id=$2",
            [s.id, b.target_turn],
          )
        ).rowCount
      )
        fail(422, "invalid_turn", "Choose a saved turn in this session");
      if (
        (
          await c.query(
            "SELECT count(*)::int n FROM intake_undo_events WHERE session_id=$1",
            [s.id],
          )
        ).rows[0].n >= 200
      )
        fail(429, "intake_quota", "Session undo limit reached");
      await c.query("SELECT undo_intake_session($1,$2,$3,$4,$5,$6)", [
        w,
        s.id,
        s.version,
        b.target_turn,
        b.reason,
        req.id,
      ]);
      return {
        body: {
          id: s.id,
          active_turn: b.target_turn,
          etag: etag(s.version + 1),
        },
        etag: etag(s.version + 1),
      };
    }),
  );
}
