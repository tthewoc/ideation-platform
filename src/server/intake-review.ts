import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import {
  append,
  audit,
  mutation,
  params,
  workspace,
  precondition,
  etag,
} from "./api.js";
import { transaction, fail, missing } from "./db.js";
import { claim, uuid, reason, type Ref } from "./schema.js";
import {
  edgeInput,
  insertEdge,
  onPublication,
  validateReferences,
  requireFreshInputs,
} from "./graph-core.js";
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
async function checkedPacket(c: PoolClient, w: string, id: string) {
  try {
    return (
      await c.query("SELECT outline_review_packet($1,$2) packet", [w, id])
    ).rows[0].packet;
  } catch (e) {
    if ((e as any).code === "42501") missing();
    throw e;
  }
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
      const packet = await checkedPacket(c, w, id);
      return { ...packet, etag: etag(packet.version) };
    }),
  );
  async function prepareClaim(c: PoolClient, req: FastifyRequest) {
    const { w, id } = params(req);
    const fields = z
      .object({
        item_id: uuid,
        title: claim.shape.title,
        scope: claim.shape.scope,
        language: claim.shape.language.trim().min(2),
      })
      .strict()
      .parse(req.body);
    await workspace(c, w, true);
    const r = await request(c, w, id);
    if (r.author_id !== req.session!.user_id)
      fail(
        403,
        "author_required",
        "Only the notebook author can prepare a claim",
      );
    precondition(req, r.version);
    const packet = await checkedPacket(c, w, id);
    if (
      packet.state !== "decided" ||
      packet.expired ||
      packet.decision?.disposition !== "accepted"
    )
      fail(
        409,
        "accepted_review_required",
        "Select an accepted review with an active grant",
      );
    const item = packet.outline.items.find(
      (entry: { id: string; kind: string }) =>
        entry.id === fields.item_id && entry.kind === "claim",
    );
    if (!item)
      fail(
        422,
        "invalid_claim_item",
        "Choose a claim from the reviewed revision",
      );
    const pins = new Map<string, Ref>();
    for (const turn of packet.source_turns) {
      if (item.source_turn_ids.includes(turn.id))
        for (const ref of turn.attachment_refs)
          pins.set(ref.id + ":" + ref.revision, ref);
    }
    const content = claim.parse({
      title: fields.title,
      language: fields.language,
      scope: fields.scope,
      body: item.rationale,
      proposition: item.text,
      qualifiers: [item.basis],
      source_refs: [...pins.values()],
    });

    return {
      type: "claim",
      schema_version: 1,
      content,
      provenance: {
        review_id: id,
        outline_revision: packet.outline.revision,
        item_id: item.id,
        source_turn_ids: item.source_turn_ids,
        basis: item.basis,
      },
      audience: "author",
      reviewed_fields: ["proposition", "body", "qualifiers"],
      author_supplied_fields: ["title", "scope", "language"],
    };
  }
  app.post(
    "/v1/workspaces/:w/outline-reviews/:id/claim-preview",
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      return transaction(req.session!.user_id, (c) => prepareClaim(c, req));
    },
  );
  const candidates = "/v1/workspaces/:w/outline-reviews/:id/claim-candidates";
  app.post(candidates, async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const candidate = await prepareClaim(c, req),
        id = candidate.provenance.review_id;
      const version = (
        await c.query(
          "SELECT COALESCE(max(version),0)+1 AS version FROM outline_claim_candidates WHERE review_id=$1",
          [id],
        )
      ).rows[0].version;
      if (version > 50)
        fail(
          429,
          "candidate_limit",
          "This review already has 50 saved candidates",
        );
      await c.query(
        "INSERT INTO outline_claim_candidates(review_id,version,workspace_id,candidate) VALUES($1,$2,$3,$4)",
        [id, version, w, candidate],
      );
      await audit(c, req, w, "outline.candidate_saved", id, version);
      return { status: 201, body: { review_id: id, version } };
    }),
  );
  app.post(candidates + "/publish", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const id = uuid.parse(params(req).id),
        versionSchema = z.number().int().positive(),
        disclosure = z.object({
          audience: z.literal("workspace"),
          confirmation: z.literal(true),
        }),
        b = z
          .union([
            disclosure.extend({ version: versionSchema }).strict(),
            disclosure
              .extend({
                relationship: z
                  .object({
                    type: z.enum(["cites", "derived_from", "relevant_to"]),
                    from_version: versionSchema,
                    to_version: versionSchema,
                    rationale: reason,
                  })
                  .strict()
                  .optional(),
                versions: z
                  .array(versionSchema)
                  .min(1)
                  .max(50)
                  .refine((v) => new Set(v).size === v.length),
              })
              .strict(),
          ])
          .parse(req.body);
      const review = await request(c, w, id);
      precondition(req, review.version);
      if (review.author_id !== req.session!.user_id)
        fail(403, "author_required", "Only the author may publish this claim");
      const published = [];
      for (const version of "versions" in b ? b.versions : [b.version]) {
        const saved =
          (
            await c.query(
              "SELECT candidate FROM outline_claim_candidates WHERE workspace_id=$1 AND review_id=$2 AND version=$3",
              [w, id, version],
            )
          ).rows[0] ?? missing();
        if (
          (
            await c.query(
              "SELECT 1 FROM outline_claim_publications WHERE review_id=$1 AND version=$2",
              [id, version],
            )
          ).rowCount
        )
          fail(
            409,
            "already_published",
            "This candidate version has already been published",
          );
        const body = claim.parse(saved.candidate.content);
        await validateReferences(c, w, "claim", body, true);
        await requireFreshInputs(c, w, body);
        const obj = (
          await c.query(
            "INSERT INTO objects(workspace_id,type,author_id) VALUES($1,'claim',actor()) RETURNING *",
            [w],
          )
        ).rows[0];
        const revision = await append(
          c,
          w,
          obj,
          body,
          "Author confirmed workspace publication of a reviewed outline claim",
          null,
        );
        await c.query(
          "INSERT INTO publications(workspace_id,object_id,revision,published_by) VALUES($1,$2,$3,actor())",
          [w, obj.id, revision],
        );
        await c.query("UPDATE objects SET current_revision=$2 WHERE id=$1", [
          obj.id,
          revision,
        ]);
        await onPublication(c, w, obj.id, revision, revision, "claim", body);
        await c.query(
          "INSERT INTO outline_claim_publications(review_id,version,workspace_id,object_id,revision) VALUES($1,$2,$3,$4,$5)",
          [id, version, w, obj.id, revision],
        );
        await audit(c, req, w, "object.published", obj.id, revision);
        published.push({ version, object_id: obj.id, revision });
      }
      if ("versions" in b && b.relationship) {
        const link = b.relationship;
        const from = published.find((v) => v.version === link.from_version);
        const to = published.find((v) => v.version === link.to_version);
        if (!from || !to || from === to)
          fail(
            422,
            "invalid_endpoint",
            "Select two different batch candidates for the relationship",
          );
        const edge = await insertEdge(
          c,
          w,
          edgeInput.parse({
            type: link.type,
            rationale: link.rationale,
            from: { id: from.object_id, revision: from.revision },
            to: { id: to.object_id, revision: to.revision },
          }),
        );
        await c.query("SELECT bump_content_epoch($1)", [w]);
        await audit(c, req, w, "edge.created", edge.id, edge.current_revision);
        return {
          status: 201,
          body: {
            published,
            relationship: { id: edge.id, revision: edge.current_revision },
          },
        };
      }
      const first = published[0]!;
      return {
        status: 201,
        body:
          "versions" in b
            ? { published }
            : { object_id: first.object_id, revision: first.revision },
      };
    }),
  );
  app.get(candidates, async (req, reply) =>
    transaction(req.session!.user_id, async (c) => {
      const { w, id } = params(req);
      await workspace(c, w);
      uuid.parse(id);
      reply.header("Cache-Control", "no-store");
      return {
        items: (
          await c.query(
            "SELECT c.version,c.candidate,p.object_id FROM outline_claim_candidates c LEFT JOIN outline_claim_publications p USING(workspace_id,review_id,version) WHERE c.workspace_id=$1 AND c.review_id=$2 ORDER BY c.version DESC",
            [w, id],
          )
        ).rows,
      };
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
