import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { uuid, ref, reason, result as resultSchema } from "./schema.js";
import { transaction, fail, missing } from "./db.js";
import {
  mutation,
  params,
  workspace,
  append,
  view,
  precondition,
  etag,
  audit,
  object,
} from "./api.js";
import {
  pinned,
  validateReferences,
  insertEdge,
  requireFreshInputs,
  freshness,
} from "./graph-core.js";
async function role(c: PoolClient, w: string, r: string) {
  if (!(await c.query("SELECT has_role($1,$2) ok", [w, r])).rows[0].ok)
    fail(403, "forbidden", `The ${r} role is required`);
}
async function task(c: PoolClient, w: string, id: string) {
  uuid.parse(id);
  const t = (
    await c.query(
      "SELECT t.*,o.author_id,r.content FROM tasks t JOIN objects o ON o.id=t.object_id JOIN revisions r ON r.object_id=t.object_id AND r.revision=t.revision WHERE t.workspace_id=$1 AND t.object_id=$2",
      [w, id],
    )
  ).rows[0];
  return t ?? missing();
}
const state = (t: any) => ({ ...t, etag: etag(t.version) });
async function event(
  c: PoolClient,
  req: FastifyRequest,
  w: string,
  id: string,
  action: string,
  why: string,
  details: unknown = {},
) {
  await c.query(
    "INSERT INTO task_events(workspace_id,task_id,actor_id,action,reason,details) VALUES($1,$2,actor(),$3,$4,$5)",
    [w, id, action, why, details],
  );
  await audit(c, req, w, action, id);
}
async function active(c: PoolClient, w: string, t: any) {
  const p = await pinned(c, w, { id: t.object_id, revision: t.revision }, [
    "research_task",
  ]);
  if (p.validity !== "active" || p.current_revision !== t.revision)
    fail(
      409,
      "task_revision_changed",
      "This task definition is superseded or inactive; cancel it and open a new task",
    );
  const m = await pinned(c, w, t.content.method_ref, ["method"]);
  if (
    m.validity !== "active" ||
    m.current_revision !== t.content.method_ref.revision
  )
    fail(409, "method_changed", "Task method must be current and active");
}
async function dependencies(c: PoolClient, w: string, id: string) {
  return (
    await c.query(
      "SELECT r.to_id id,r.to_revision revision,t.status FROM edges e JOIN edge_revisions r ON r.edge_id=e.id AND r.revision=e.current_revision LEFT JOIN tasks t ON t.object_id=r.to_id AND t.revision=r.to_revision WHERE e.workspace_id=$1 AND r.from_id=$2 AND r.type='depends_on' AND r.state='active'",
      [w, id],
    )
  ).rows;
}
async function ready(c: PoolClient, w: string, id: string) {
  for (const d of await dependencies(c, w, id)) {
    const p = await pinned(c, w, d, ["research_task"]);
    if (
      d.status !== "completed" ||
      p.validity !== "active" ||
      p.current_revision !== d.revision
    )
      fail(
        409,
        "prerequisites_incomplete",
        "Every prerequisite must be completed on its pinned active revision",
      );
  }
}
export async function installResearch(app: FastifyInstance) {
  app.post("/v1/workspaces/:w/tasks/:id/open", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      await role(c, w, "coordinator");
      const { id } = params(req),
        o = await object(c, w, id);
      precondition(
        req,
        o.author_id === req.session!.user_id ? o.version : o.current_revision,
      );
      const b = z
        .object({ revision: z.number().int().positive(), reason })
        .strict()
        .parse(req.body);
      const r = await pinned(c, w, { id, revision: b.revision }, [
        "research_task",
      ]);
      if (r.current_revision !== b.revision || r.validity !== "active")
        fail(
          409,
          "invalid_state",
          "Open the current active published definition",
        );
      await validateReferences(c, w, "research_task", r.content, true);
      await c.query(
        "INSERT INTO tasks(workspace_id,object_id,revision,status) VALUES($1,$2,$3,'open')",
        [w, id, b.revision],
      );
      await active(c, w, await task(c, w, id));
      await event(c, req, w, id, "task.opened", b.reason);
      return { body: state(await task(c, w, id)), status: 201 };
    }),
  );
  app.get("/v1/workspaces/:w/tasks", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const { w } = params(req);
      await workspace(c, w);
      const q = z.object({ after: uuid.optional() }).parse(req.query);
      const rows = (
        await c.query(
          "SELECT t.*,r.content FROM tasks t JOIN revisions r ON r.object_id=t.object_id AND r.revision=t.revision WHERE t.workspace_id=$1 AND ($2::uuid IS NULL OR t.object_id>$2) ORDER BY t.object_id LIMIT 26",
          [w, q.after ?? null],
        )
      ).rows;
      return {
        items: rows.slice(0, 25).map(state),
        next_cursor: rows.length > 25 ? rows[24].object_id : null,
      };
    }),
  );
  app.get("/v1/workspaces/:w/tasks/:id", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const { w, id } = params(req);
      await workspace(c, w);
      const t = await task(c, w, id);
      return {
        ...state(t),
        result_freshness: t.result_id
          ? await freshness(c, w, {
              id: t.result_id,
              revision: t.result_revision,
            })
          : null,
        dependencies: await dependencies(c, w, id),
        invitations: (
          await c.query(
            "SELECT * FROM task_invitations WHERE workspace_id=$1 AND task_id=$2 ORDER BY created_at DESC LIMIT 25",
            [w, id],
          )
        ).rows.map((i) => ({ ...i, etag: etag(i.version) })),
        events: (
          await c.query(
            "SELECT * FROM task_events WHERE workspace_id=$1 AND task_id=$2 ORDER BY created_at,id LIMIT 100",
            [w, id],
          )
        ).rows,
      };
    }),
  );
  app.post("/v1/workspaces/:w/tasks/:id/assignment", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      await role(c, w, "coordinator");
      const { id } = params(req),
        t = await task(c, w, id);
      precondition(req, t.version);
      await active(c, w, t);
      if (t.status !== "open")
        fail(409, "invalid_state", "Only open tasks can receive invitations");
      const b = z
        .object({
          assignee_id: uuid,
          purpose: reason,
          expires_in_hours: z.number().int().min(1).max(168).default(72),
        })
        .strict()
        .parse(req.body);
      if (
        !(
          await c.query(
            "SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND revoked_at IS NULL",
            [w, b.assignee_id],
          )
        ).rowCount
      )
        fail(
          422,
          "invalid_assignee",
          "Assignee must be a current workspace member",
        );
      await c.query(
        "UPDATE task_invitations SET state='withdrawn',reason='Replaced by a new invitation',version=version+1 WHERE workspace_id=$1 AND task_id=$2 AND state='pending'",
        [w, id],
      );
      const i = (
        await c.query(
          "INSERT INTO task_invitations(workspace_id,task_id,assignee_id,proposed_by,purpose,expires_at) VALUES($1,$2,$3,actor(),$4,now()+$5*interval '1 hour') RETURNING *",
          [w, id, b.assignee_id, b.purpose, b.expires_in_hours],
        )
      ).rows[0];
      await c.query("UPDATE tasks SET version=version+1 WHERE object_id=$1", [
        id,
      ]);
      await event(c, req, w, id, "task.assignment_proposed", b.purpose, {
        invitation_id: i.id,
        assignee_id: b.assignee_id,
      });
      return { body: { ...i, etag: etag(i.version) }, status: 201 };
    }),
  );
  app.post(
    "/v1/workspaces/:w/tasks/:id/assignment/decisions",
    async (req, reply) =>
      mutation(req, reply, async (c, w) => {
        const { id } = params(req),
          t = await task(c, w, id),
          b = z
            .object({
              invitation_id: uuid,
              decision: z.enum(["accept", "decline"]),
              reason,
            })
            .strict()
            .parse(req.body);
        const i =
          (
            await c.query(
              "SELECT * FROM task_invitations WHERE workspace_id=$1 AND task_id=$2 AND id=$3",
              [w, id, b.invitation_id],
            )
          ).rows[0] ?? missing();
        precondition(req, i.version);
        if (i.assignee_id !== req.session!.user_id)
          fail(
            403,
            "consent_required",
            "Only the invited assignee may accept or decline",
          );
        if (
          t.status !== "open" ||
          i.state !== "pending" ||
          new Date(i.expires_at).getTime() <= Date.now()
        )
          fail(409, "invitation_closed", "Invitation is no longer current");
        await active(c, w, t);
        if (b.decision === "accept")
          await c.query(
            "UPDATE tasks SET status='assigned',assignee_id=actor(),version=version+1 WHERE object_id=$1",
            [id],
          );
        await c.query(
          "UPDATE task_invitations SET state=$2,reason=$3,version=version+1 WHERE id=$1",
          [i.id, b.decision === "accept" ? "accepted" : "declined", b.reason],
        );
        await event(
          c,
          req,
          w,
          id,
          b.decision === "accept"
            ? "task.assigned"
            : "task.assignment_declined",
          b.reason,
          { invitation_id: i.id },
        );
        return { body: state(await task(c, w, id)) };
      }),
  );
  app.post("/v1/workspaces/:w/tasks/:id/results", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const { id } = params(req),
        t = await task(c, w, id);
      precondition(req, t.version);
      await active(c, w, t);
      await ready(c, w, id);
      if (t.assignee_id !== req.session!.user_id)
        await role(c, w, "coordinator");
      if (!["in_progress", "returned_for_revision"].includes(t.status))
        fail(409, "invalid_state", "Start the task before recording results");
      const b = resultSchema.parse(req.body);
      if (
        b.method_ref.id !== t.content.method_ref.id ||
        b.method_ref.revision !== t.content.method_ref.revision
      )
        fail(
          422,
          "method_mismatch",
          "Result must retain the task method revision",
        );
      b.source_refs = [
        ...b.source_refs.filter((r) => r.id !== id),
        { id, revision: t.revision },
      ];
      await validateReferences(c, w, "result", b, true);
      const resultId = randomUUID();
      await c.query(
        "INSERT INTO objects(id,workspace_id,type,author_id) VALUES($1,$2,'result',actor())",
        [resultId, w],
      );
      await append(
        c,
        w,
        { id: resultId, next_revision: 1 },
        b,
        "Research result recorded",
        null,
      );
      await c.query(
        "INSERT INTO draft_heads(workspace_id,object_id,author_id,revision) VALUES($1,$2,actor(),1)",
        [w, resultId],
      );
      await c.query(
        "INSERT INTO task_results(workspace_id,task_id,result_id,submitted_by) VALUES($1,$2,$3,actor())",
        [w, id, resultId],
      );
      await event(
        c,
        req,
        w,
        id,
        "result.recorded",
        "Private result recorded; explicit publication required",
        { result_id: resultId },
      );
      return { body: await view(c, w, resultId), status: 201 };
    }),
  );
  app.post("/v1/workspaces/:w/tasks/:id/transitions", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const { id } = params(req),
        t = await task(c, w, id);
      precondition(req, t.version);
      const b = z
        .object({
          action: z.enum(["start", "submit", "complete", "return", "cancel"]),
          reason,
          result_ref: ref.optional(),
          acceptance_evidence: z.array(reason).max(100).optional(),
          conflict_declaration: z.literal("none").optional(),
        })
        .strict()
        .parse(req.body);
      if (["completed", "cancelled"].includes(t.status))
        fail(409, "terminal_task", "Task is terminal");
      let next: string;
      if (b.action === "cancel") {
        if (t.author_id !== req.session!.user_id)
          await role(c, w, "coordinator");
        next = "cancelled";
        await c.query(
          "UPDATE task_invitations SET state='withdrawn',reason='Task cancelled',version=version+1 WHERE task_id=$1 AND state='pending'",
          [id],
        );
      } else {
        await active(c, w, t);
        if (b.action === "start" || b.action === "submit") {
          if (t.assignee_id !== req.session!.user_id)
            fail(
              403,
              "assignee_required",
              "Only the consenting assignee may advance work",
            );
          await ready(c, w, id);
          if (b.action === "start") {
            if (t.status !== "assigned")
              fail(409, "invalid_state", "Task must be assigned");
            next = "in_progress";
          } else {
            if (
              !["in_progress", "returned_for_revision"].includes(t.status) ||
              !b.result_ref ||
              b.acceptance_evidence?.length !==
                t.content.acceptance_criteria.length
            )
              fail(
                422,
                "submission_required",
                "Provide a published result and evidence for every acceptance criterion",
              );
            const r = await pinned(c, w, b.result_ref, ["result"]);
            if (
              r.validity !== "active" ||
              r.current_revision !== b.result_ref.revision
            )
              fail(409, "invalid_result", "Result must be active and current");
            if (
              !(
                await c.query(
                  "SELECT 1 FROM task_results WHERE task_id=$1 AND result_id=$2",
                  [id, b.result_ref.id],
                )
              ).rowCount
            )
              fail(
                422,
                "invalid_result",
                "Result must be recorded for this task",
              );
            if (
              r.content.method_ref.id !== t.content.method_ref.id ||
              r.content.method_ref.revision !== t.content.method_ref.revision ||
              !r.content.source_refs.some(
                (p: any) => p.id === id && p.revision === t.revision,
              )
            )
              fail(
                422,
                "method_mismatch",
                "Result correction lost its task or method provenance",
              );
            await validateReferences(c, w, "result", r.content, true);
            await c.query(
              "UPDATE tasks SET result_id=$2,result_revision=$3 WHERE object_id=$1",
              [id, b.result_ref.id, b.result_ref.revision],
            );
            await insertEdge(c, w, {
              type: "produces",
              from: { id, revision: t.revision },
              to: b.result_ref,
              rationale: b.reason,
            });
            await c.query("SELECT bump_content_epoch($1)", [w]);
            next = "submitted";
          }
        } else {
          await role(c, w, "reviewer");
          if (t.status !== "submitted")
            fail(409, "invalid_state", "Task must be submitted for review");
          const r = await pinned(
            c,
            w,
            { id: t.result_id, revision: t.result_revision },
            ["result"],
          );
          if (
            [t.author_id, t.assignee_id, r.author_id].includes(
              req.session!.user_id,
            ) ||
            b.conflict_declaration !== "none"
          )
            fail(
              403,
              "independence_required",
              "An independent reviewer must declare no conflict",
            );
          if (b.action === "complete") {
            await requireFreshInputs(c, w, r.content);
            await ready(c, w, id);
            if (
              r.validity !== "active" ||
              r.current_revision !== t.result_revision
            )
              fail(
                409,
                "invalid_result",
                "Submitted result has changed or been withdrawn",
              );
            await validateReferences(c, w, "result", r.content, true);
          }
          next =
            b.action === "complete" ? "completed" : "returned_for_revision";
          await c.query(
            "INSERT INTO reviews(workspace_id,object_id,revision,decision,reason,conflict_declaration,reviewer_id) VALUES($1,$2,$3,$4,$5,'none',actor())",
            [
              w,
              t.result_id,
              t.result_revision,
              b.action === "complete" ? "accepted" : "needs_evidence",
              b.reason,
            ],
          );
          await c.query(
            "INSERT INTO revision_status(workspace_id,object_id,revision,review_state,last_reviewer) VALUES($1,$2,$3,$4,actor()) ON CONFLICT(workspace_id,object_id,revision) DO UPDATE SET review_state=excluded.review_state,last_reviewer=actor(),version=revision_status.version+1",
            [
              w,
              t.result_id,
              t.result_revision,
              b.action === "complete" ? "accepted" : "needs_evidence",
            ],
          );
        }
      }
      await c.query(
        "UPDATE tasks SET status=$2,version=version+1 WHERE object_id=$1",
        [id, next],
      );
      await event(c, req, w, id, `task.${next}`, b.reason, {
        result_ref: b.result_ref,
        acceptance_evidence: b.acceptance_evidence,
      });
      return { body: state(await task(c, w, id)) };
    }),
  );
}
