import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { mutation, params, workspace, precondition, etag } from "./api.js";
import { transaction, fail, missing } from "./db.js";
import { uuid, reason } from "./schema.js";
const columns =
  "id,outline_revision,author_id,reviewer_id,state,version,expires_at,created_at,(expires_at<=clock_timestamp()) AS expired";
async function request(c: PoolClient, w: string, id: string) {
  return (
    (
      await c.query(
        `SELECT ${columns} FROM intake_review_requests WHERE workspace_id=$1 AND id=$2`,
        [w, uuid.parse(id)],
      )
    ).rows[0] ?? missing()
  );
}
export async function installIntakeReview(app: FastifyInstance) {
  app.post(
    "/v1/workspaces/:w/sessions/:id/outline-reviews",
    async (req, reply) =>
      mutation(req, reply, async (c, w) => {
        const b = z
          .object({
            outline_revision: z.number().int().positive(),
            reviewer_id: uuid,
            expires_days: z.number().int().min(1).max(30).default(7),
            purpose: reason,
            share_sources_confirmation: z.literal(true),
          })
          .strict()
          .parse(req.body);
        const s =
          (
            await c.query(
              "SELECT id,version FROM intake_sessions WHERE workspace_id=$1 AND id=$2",
              [w, uuid.parse(params(req).id)],
            )
          ).rows[0] ?? missing();
        precondition(req, s.version);
        if (b.reviewer_id === req.session!.user_id)
          fail(
            403,
            "independence_required",
            "Choose a different independent reviewer",
          );
        if (
          !(
            await c.query(
              "SELECT 1 FROM intake_outline_revisions WHERE session_id=$1 AND revision=$2 AND jsonb_array_length(items)>0",
              [s.id, b.outline_revision],
            )
          ).rowCount
        )
          fail(
            422,
            "invalid_outline",
            "Select a saved, nonempty outline revision",
          );
        let id: string;
        try {
          id = (
            await c.query(
              "SELECT request_outline_review($1,$2,$3,$4,$5,$6,$7,$8) id",
              [
                w,
                s.id,
                s.version,
                b.outline_revision,
                b.reviewer_id,
                b.expires_days,
                b.purpose,
                req.id,
              ],
            )
          ).rows[0].id;
        } catch (e) {
          if ((e as any).code === "42501")
            fail(
              403,
              "review_scope_unavailable",
              "Choose a current independent reviewer and ensure every cited attachment revision is published and available.",
            );
          if ((e as any).code === "23514")
            fail(429, "review_quota", "Notebook review request limit reached");
          throw e;
        }
        return {
          body: {
            id,
            state: "pending",
            etag: etag(1),
            session_etag: etag(s.version + 1),
          },
          etag: etag(1),
          status: 201,
        };
      }),
  );
  app.get("/v1/workspaces/:w/outline-reviews", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const { w } = params(req);
      await workspace(c, w);
      const q = z.object({ after: uuid.optional() }).strict().parse(req.query);
      const rows = (
        await c.query(
          `SELECT ${columns} FROM intake_review_requests WHERE workspace_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT 26`,
          [w, q.after ?? null],
        )
      ).rows;
      return {
        items: rows.slice(0, 25).map((r) => ({ ...r, etag: etag(r.version) })),
        next: rows.length > 25 ? rows[24].id : null,
      };
    }),
  );
  app.get("/v1/workspaces/:w/outline-reviews/:id", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const { w, id } = params(req);
      await workspace(c, w);
      await request(c, w, id);
      let packet: any;
      try {
        packet = (
          await c.query("SELECT outline_review_packet($1,$2) packet", [w, id])
        ).rows[0].packet;
      } catch (e) {
        if ((e as any).code === "42501") missing();
        throw e;
      }
      return { ...packet, etag: etag(packet.version) };
    }),
  );
  app.post(
    "/v1/workspaces/:w/outline-reviews/:id/decisions",
    async (req, reply) =>
      mutation(req, reply, async (c, w) => {
        const b = z
          .object({
            disposition: z.enum([
              "accepted",
              "rejected",
              "deferred",
              "needs_evidence",
            ]),
            reason,
            conflict_declaration: z.literal("none"),
          })
          .strict()
          .parse(req.body);
        const r = await request(c, w, params(req).id);
        precondition(req, r.version);
        if (r.reviewer_id !== req.session!.user_id)
          fail(
            403,
            "independence_required",
            "Only the named independent reviewer may decide",
          );
        if (r.state !== "pending" || r.expired)
          fail(409, "review_closed", "Review is no longer open");
        await c.query("SELECT decide_outline_review($1,$2,$3,$4,$5,$6,$7)", [
          w,
          r.id,
          r.version,
          b.disposition,
          b.reason,
          b.conflict_declaration,
          req.id,
        ]);
        return {
          body: {
            id: r.id,
            state: "decided",
            disposition: b.disposition,
            etag: etag(r.version + 1),
          },
          etag: etag(r.version + 1),
        };
      }),
  );
  app.post("/v1/workspaces/:w/outline-reviews/:id/revoke", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const b = z.object({ reason }).strict().parse(req.body),
        r = await request(c, w, params(req).id);
      precondition(req, r.version);
      if (r.author_id !== req.session!.user_id)
        fail(403, "forbidden", "Only the author may revoke this grant");
      if (r.state === "revoked")
        fail(409, "review_closed", "The grant is already revoked");
      await c.query("SELECT revoke_outline_review($1,$2,$3,$4,$5)", [
        w,
        r.id,
        r.version,
        b.reason,
        req.id,
      ]);
      return {
        body: { id: r.id, state: "revoked", etag: etag(r.version + 1) },
        etag: etag(r.version + 1),
      };
    }),
  );
}
