import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { transaction, fail, missing } from "./db.js";
import {
  audit,
  workspace,
  mutation,
  object,
  view,
  append,
  precondition,
  params,
  etag,
} from "./api.js";
import {
  uuid,
  reason,
  ref,
  assessmentFields,
  assessment,
  references,
  content,
} from "./schema.js";
import {
  state,
  pinned,
  validateReferences,
  requireFreshInputs,
  insertEdge,
  revisionData,
} from "./graph-core.js";
async function statusRow(
  c: PoolClient,
  w: string,
  r: { id: string; revision: number },
) {
  await c.query(
    "INSERT INTO revision_status(workspace_id,object_id,revision) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [w, r.id, r.revision],
  );
  return state(c, w, r);
}
async function transition(
  c: PoolClient,
  req: FastifyRequest,
  w: string,
  r: { id: string; revision: number },
  axis: "review" | "validity",
  from: string,
  to: string,
  why: string,
) {
  await c.query(
    "INSERT INTO lifecycle_events(workspace_id,object_id,revision,axis,from_state,to_state,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,actor())",
    [w, r.id, r.revision, axis, from, to, why],
  );
  const column = axis === "review" ? "review_state" : "validity";
  await c.query(
    `UPDATE revision_status SET ${column}=$4,version=version+1 WHERE workspace_id=$1 AND object_id=$2 AND revision=$3`,
    [w, r.id, r.revision, to],
  );
  await audit(
    c,
    req,
    w,
    axis === "review" ? "review.changed" : `object.${to}`,
    r.id,
    r.revision,
  );
}
async function role(c: PoolClient, w: string, name: string) {
  if (!(await c.query("SELECT has_role($1,$2) yes", [w, name])).rows[0].yes)
    fail(403, "forbidden", `${name} role required`);
}
export async function installReviews(app: FastifyInstance) {
  app.post("/v1/workspaces/:w/assessments", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const b = z.object(assessmentFields).strict().parse(req.body);
      const body = assessment.parse({
        title: `${b.polarity}: evidence assessment`,
        body: b.rationale,
        language: "en",
        source_refs: [],
        ...b,
      });
      await validateReferences(c, w, "assessment", body, true);
      const o = (
        await c.query(
          "INSERT INTO objects(workspace_id,type,author_id) VALUES($1,'assessment',actor()) RETURNING *",
          [w],
        )
      ).rows[0];
      const revision = await append(
        c,
        w,
        o,
        body,
        "Evidence assessment draft",
        null,
      );
      await c.query("INSERT INTO draft_heads VALUES($1,$2,actor(),$3,NULL)", [
        w,
        o.id,
        revision,
      ]);
      await audit(c, req, w, "assessment.created", o.id, revision);
      const v = await view(c, w, o.id);
      return { body: v, status: 201, etag: v.etag };
    }),
  );
  app.get("/v1/workspaces/:w/assessments", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const { w } = params(req);
      await workspace(c, w);
      const q = z
        .object({ claim_id: uuid.optional(), cursor: uuid.optional() })
        .parse(req.query);
      const rows = await c.query(
        "SELECT o.id FROM objects o JOIN revisions r ON r.object_id=o.id AND r.revision=o.current_revision WHERE o.workspace_id=$1 AND o.type='assessment' AND ($2::uuid IS NULL OR r.content->'claim_ref'->>'id'=$2::text) AND ($3::uuid IS NULL OR o.id>$3) ORDER BY o.id LIMIT 26",
        [w, q.claim_id ?? null, q.cursor ?? null],
      );
      return {
        items: await Promise.all(
          rows.rows.slice(0, 25).map((o) => view(c, w, o.id)),
        ),
        next_cursor: rows.rows.length > 25 ? rows.rows[24].id : null,
      };
    }),
  );
  app.post("/v1/workspaces/:w/objects/:id/submissions", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const o = await object(c, w, params(req).id);
      if (o.author_id !== req.session!.user_id)
        fail(403, "forbidden", "Only the author can submit a revision");
      precondition(req, o.version);
      const b = z
        .object({
          revision: z.number().int().positive(),
          reviewer_ids: z.array(uuid).min(1).max(10),
          purpose: reason,
        })
        .strict()
        .parse(req.body);
      const target = { id: o.id, revision: b.revision };
      const record = await revisionData(c, w, target);
      const currentDraft = (
        await c.query(
          "SELECT revision FROM draft_heads WHERE workspace_id=$1 AND object_id=$2 AND author_id=actor()",
          [w, o.id],
        )
      ).rows[0]?.revision;
      if (b.revision !== (currentDraft ?? o.current_revision))
        fail(
          409,
          "obsolete_revision",
          "Submit the current draft or published revision",
        );
      const reviewers = [...new Set(b.reviewer_ids)];
      if (
        reviewers.includes(o.author_id) ||
        reviewers.includes(record.actor_id)
      )
        fail(
          403,
          "self_review",
          "Authors and editors cannot review their own revision",
        );
      const eligible = await c.query(
        "SELECT user_id FROM memberships WHERE workspace_id=$1 AND user_id=ANY($2::uuid[]) AND revoked_at IS NULL AND 'reviewer'=ANY(roles)",
        [w, reviewers],
      );
      if (eligible.rowCount !== reviewers.length)
        fail(422, "invalid_reviewer", "Select active workspace reviewers");
      const body = content(o.type, record.content);
      await validateReferences(c, w, o.type, body, true);
      const s = await statusRow(c, w, target);
      if (
        !["unreviewed", "rejected", "needs_evidence"].includes(s.review_state)
      )
        fail(
          409,
          "invalid_state",
          "This revision cannot be submitted in its current state",
        );
      await c.query(
        "UPDATE submissions SET state='withdrawn',version=version+1 WHERE workspace_id=$1 AND object_id=$2 AND state='submitted' AND expires_at<=now()",
        [w, o.id],
      );
      const submission = (
        await c.query(
          "INSERT INTO submissions(workspace_id,object_id,revision,author_id,reviewer_ids,purpose) VALUES($1,$2,$3,actor(),$4,$5) RETURNING *",
          [w, o.id, b.revision, reviewers, b.purpose],
        )
      ).rows[0];
      await transition(
        c,
        req,
        w,
        target,
        "review",
        s.review_state,
        "submitted",
        b.purpose,
      );
      return {
        body: { ...submission, etag: etag(submission.version) },
        status: 201,
        etag: etag(submission.version),
      };
    }),
  );
  app.get("/v1/workspaces/:w/submissions", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const { w } = params(req);
      await workspace(c, w);
      const q = z.object({ cursor: uuid.optional() }).parse(req.query);
      const rows = await c.query(
        "SELECT * FROM submissions WHERE workspace_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT 26",
        [w, q.cursor ?? null],
      );
      return {
        items: rows.rows
          .slice(0, 25)
          .map((s) => ({ ...s, etag: etag(s.version) })),
        next_cursor: rows.rows.length > 25 ? rows.rows[24].id : null,
      };
    }),
  );
  app.post("/v1/workspaces/:w/submissions/:id/decisions", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const b = z
        .object({
          decision: z.enum(["accepted", "rejected", "needs_evidence"]),
          reason,
          conflict_declaration: z.literal("none"),
        })
        .strict()
        .parse(req.body);
      const sub =
        (
          await c.query(
            "SELECT * FROM submissions WHERE workspace_id=$1 AND id=$2",
            [w, uuid.parse(params(req).id)],
          )
        ).rows[0] ?? missing();
      precondition(req, sub.version);
      await role(c, w, "reviewer");
      if (
        !sub.reviewer_ids.includes(req.session!.user_id) ||
        sub.author_id === req.session!.user_id
      )
        fail(
          403,
          "self_review",
          "An assigned independent reviewer is required",
        );
      if (
        sub.state !== "submitted" ||
        new Date(sub.expires_at).getTime() <= Date.now()
      )
        fail(409, "invalid_state", "Submission is no longer open");
      const target = { id: sub.object_id, revision: sub.revision },
        o = await object(c, w, target.id),
        record = await revisionData(c, w, target);
      if (record.actor_id === req.session!.user_id)
        fail(403, "self_review", "An editor cannot review this revision");
      const body = content(o.type, record.content);
      await validateReferences(c, w, o.type, body, true);
      if (b.decision === "accepted") await requireFreshInputs(c, w, body);
      const s = await statusRow(c, w, target);
      if (s.validity !== "active" || s.review_state !== "submitted")
        fail(409, "invalid_state", "Revision state changed");
      const review = (
        await c.query(
          "INSERT INTO reviews(workspace_id,object_id,revision,submission_id,decision,reason,conflict_declaration,reviewer_id) VALUES($1,$2,$3,$4,$5,$6,$7,actor()) RETURNING id",
          [
            w,
            target.id,
            target.revision,
            sub.id,
            b.decision,
            b.reason,
            b.conflict_declaration,
          ],
        )
      ).rows[0];
      await transition(
        c,
        req,
        w,
        target,
        "review",
        s.review_state,
        b.decision,
        b.reason,
      );
      await c.query(
        "UPDATE revision_status SET last_reviewer=actor() WHERE workspace_id=$1 AND object_id=$2 AND revision=$3",
        [w, target.id, target.revision],
      );
      // Revoke the temporary grant only after all writes needing it have completed.
      await c.query(
        "UPDATE submissions SET state=$2,version=version+1 WHERE id=$1",
        [sub.id, b.decision],
      );
      return {
        body: { id: review.id, decision: b.decision },
        etag: etag(sub.version + 1),
      };
    }),
  );
  app.post("/v1/workspaces/:w/submissions/:id/withdraw", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const b = z.object({ reason }).strict().parse(req.body),
        sub =
          (
            await c.query(
              "SELECT * FROM submissions WHERE workspace_id=$1 AND id=$2",
              [w, uuid.parse(params(req).id)],
            )
          ).rows[0] ?? missing();
      precondition(req, sub.version);
      if (sub.author_id !== req.session!.user_id)
        fail(403, "forbidden", "Only the author may withdraw");
      if (sub.state !== "submitted")
        fail(409, "invalid_state", "Submission is closed");
      const target = { id: sub.object_id, revision: sub.revision };
      await statusRow(c, w, target);
      await transition(
        c,
        req,
        w,
        target,
        "review",
        "submitted",
        "unreviewed",
        b.reason,
      );
      await c.query(
        "UPDATE submissions SET state='withdrawn',version=version+1 WHERE id=$1",
        [sub.id],
      );
      return {
        body: { id: sub.id, state: "withdrawn" },
        etag: etag(sub.version + 1),
      };
    }),
  );
  app.post("/v1/workspaces/:w/objects/:id/transitions", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const b = z
        .object({
          axis: z.enum(["review", "validity"]),
          to_state: z.enum([
            "disputed",
            "accepted",
            "rejected",
            "retracted",
            "superseded",
          ]),
          revision: z.number().int().positive(),
          reason,
          replacement_ref: ref.optional(),
          conflict_declaration: z.literal("none").optional(),
        })
        .strict()
        .parse(req.body);
      const o = await object(c, w, params(req).id),
        target = { id: o.id, revision: b.revision };
      await pinned(c, w, target);
      const s = await statusRow(c, w, target);
      precondition(req, s.version);
      if (o.type === "artifact" && b.axis === "validity")
        fail(
          422,
          "artifact_transition_required",
          "Use artifact access transitions to revoke downloads and invalidate references",
        );
      if (b.axis === "review") {
        if (s.validity !== "active")
          fail(
            409,
            "invalid_transition",
            "Inactive revisions cannot receive new review decisions",
          );
        await role(c, w, "reviewer");
        if (
          o.author_id === req.session!.user_id ||
          s.last_reviewer === req.session!.user_id ||
          b.conflict_declaration !== "none"
        )
          fail(
            403,
            "independence_required",
            "A different independent reviewer must declare no conflict",
          );
        if (!(
          (s.review_state === "accepted" && b.to_state === "disputed") ||
          (s.review_state === "disputed" &&
            ["accepted", "rejected"].includes(b.to_state))
        ))
          fail(409, "invalid_transition", "Review transition is not allowed");
        if (b.to_state === "accepted")
          await requireFreshInputs(
            c,
            w,
            content(o.type, (await revisionData(c, w, target)).content),
          );
        await c.query(
          "INSERT INTO reviews(workspace_id,object_id,revision,decision,reason,conflict_declaration,reviewer_id) VALUES($1,$2,$3,$4,$5,$6,actor())",
          [w, o.id, b.revision, b.to_state, b.reason, b.conflict_declaration],
        );
        await transition(
          c,
          req,
          w,
          target,
          "review",
          s.review_state,
          b.to_state,
          b.reason,
        );
        await c.query(
          "UPDATE revision_status SET last_reviewer=actor() WHERE workspace_id=$1 AND object_id=$2 AND revision=$3",
          [w, o.id, b.revision],
        );
      } else {
        if (o.author_id !== req.session!.user_id) await role(c, w, "moderator");
        if (
          s.validity !== "active" ||
          !["retracted", "superseded"].includes(b.to_state)
        )
          fail(409, "invalid_transition", "Validity transition is not allowed");
        if (b.to_state === "superseded") {
          if (!b.replacement_ref)
            fail(422, "replacement_required", "Select a replacement revision");
          await insertEdge(c, w, {
            type: "supersedes",
            from: b.replacement_ref,
            to: target,
            rationale: b.reason,
          });
        }
        await transition(
          c,
          req,
          w,
          target,
          "validity",
          s.validity,
          b.to_state,
          b.reason,
        );
        await c.query("SELECT bump_content_epoch($1)", [w]);
      }
      return {
        body: {
          id: o.id,
          revision: b.revision,
          ...(await state(c, w, target)),
        },
        etag: etag(s.version + 1),
      };
    }),
  );
  app.get("/v1/workspaces/:w/objects/:id/reviews", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const { w, id } = params(req);
      await workspace(c, w);
      await object(c, w, id);
      const q = z
        .object({ revision: z.coerce.number().int().positive() })
        .parse(req.query);
      await revisionData(c, w, { id, revision: q.revision });
      return {
        reviews: (
          await c.query(
            "SELECT * FROM reviews WHERE workspace_id=$1 AND object_id=$2 AND (revision=$3 OR revision=(SELECT review_source_revision FROM revision_status WHERE workspace_id=$1 AND object_id=$2 AND revision=$3)) ORDER BY created_at,id LIMIT 100",
            [w, id, q.revision],
          )
        ).rows,
        events: (
          await c.query(
            "SELECT * FROM lifecycle_events WHERE workspace_id=$1 AND object_id=$2 AND (revision=$3 OR revision=(SELECT review_source_revision FROM revision_status WHERE workspace_id=$1 AND object_id=$2 AND revision=$3)) ORDER BY created_at,id LIMIT 100",
            [w, id, q.revision],
          )
        ).rows,
      };
    }),
  );
  app.post("/v1/workspaces/:w/equivalences", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const b = z
        .object({ left_ref: ref, right_ref: ref, rationale: reason })
        .strict()
        .parse(req.body);
      await pinned(c, w, b.left_ref);
      await pinned(c, w, b.right_ref);
      if (b.left_ref.id === b.right_ref.id)
        fail(422, "same_identity", "Choose two distinct identities");
      const row = (
        await c.query(
          "INSERT INTO equivalences(workspace_id,left_id,left_revision,right_id,right_revision,author_id,rationale) VALUES($1,$2,$3,$4,$5,actor(),$6) RETURNING *",
          [
            w,
            b.left_ref.id,
            b.left_ref.revision,
            b.right_ref.id,
            b.right_ref.revision,
            b.rationale,
          ],
        )
      ).rows[0];
      await audit(c, req, w, "equivalence.proposed", row.id);
      return { body: { ...row, etag: etag(1) }, status: 201, etag: etag(1) };
    }),
  );
  app.get("/v1/workspaces/:w/equivalences", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const { w } = params(req);
      await workspace(c, w);
      const q = z.object({ cursor: uuid.optional() }).parse(req.query);
      const rows = await c.query(
        "SELECT * FROM equivalences WHERE workspace_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT 26",
        [w, q.cursor ?? null],
      );
      return {
        items: rows.rows
          .slice(0, 25)
          .map((e) => ({ ...e, etag: etag(e.version) })),
        next_cursor: rows.rows.length > 25 ? rows.rows[24].id : null,
      };
    }),
  );
  app.post("/v1/workspaces/:w/equivalences/:id/decisions", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const b = z
        .object({
          decision: z.enum(["reviewed", "rejected", "revoked"]),
          reason,
        })
        .strict()
        .parse(req.body);
      await role(c, w, "reviewer");
      const e =
        (
          await c.query(
            "SELECT * FROM equivalences WHERE workspace_id=$1 AND id=$2",
            [w, uuid.parse(params(req).id)],
          )
        ).rows[0] ?? missing();
      precondition(req, e.version);
      if (e.author_id === req.session!.user_id)
        fail(403, "self_review", "An independent reviewer is required");
      if (!(
        (e.state === "candidate" &&
          ["reviewed", "rejected"].includes(b.decision)) ||
        (e.state === "reviewed" && b.decision === "revoked")
      ))
        fail(
          409,
          "invalid_transition",
          "Equivalence transition is not allowed",
        );
      await c.query(
        "INSERT INTO equivalence_decisions(workspace_id,equivalence_id,decision,reason,actor_id) VALUES($1,$2,$3,$4,actor())",
        [w, e.id, b.decision, b.reason],
      );
      await c.query(
        "UPDATE equivalences SET state=$2,version=version+1 WHERE id=$1",
        [e.id, b.decision],
      );
      await audit(c, req, w, "equivalence.disposed", e.id);
      return {
        body: {
          ...e,
          state: b.decision,
          version: e.version + 1,
          etag: etag(e.version + 1),
        },
        etag: etag(e.version + 1),
      };
    }),
  );
}
