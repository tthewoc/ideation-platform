import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction, authDb, fail, missing } from "./db.js";
import { uuid, createObject, content, named, roles } from "./schema.js";
import { requireMfa } from "./auth.js";
type Result = { body: unknown; status?: number; etag?: string };
const etag = (v: number) => `"${v}"`;
function precondition(req: FastifyRequest, version: number) {
  if (!req.headers["if-match"])
    fail(428, "precondition_required", "If-Match is required");
  if (req.headers["if-match"] !== etag(version))
    fail(
      412,
      "version_conflict",
      "This item changed. Reload it before saving.",
    );
}
function params(req: FastifyRequest) {
  return req.params as Record<string, string>;
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
async function audit(
  c: PoolClient,
  req: FastifyRequest,
  w: string,
  action: string,
  target?: string,
  revision?: number,
) {
  const id = randomUUID();
  await c.query(
    "INSERT INTO audit_events(id,workspace_id,actor_id,action,target_id,revision,request_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      id,
      w,
      req.session!.user_id,
      action,
      target ?? null,
      revision ?? null,
      req.id,
    ],
  );
  await c.query(
    "INSERT INTO outbox(event_id,workspace_id,kind,payload) VALUES($1,$2,$3,$4)",
    [id, w, action, { target_id: target, revision }],
  );
}
async function workspace(c: PoolClient, w: string, lock = false) {
  uuid.parse(w);
  const r = await c.query(
    `SELECT * FROM workspaces WHERE id=$1 AND member(id) ${lock ? "FOR UPDATE" : ""}`,
    [w],
  );
  return r.rows[0] ?? missing();
}
async function mutation(
  req: FastifyRequest,
  reply: FastifyReply,
  fn: (c: PoolClient, w: string) => Promise<Result>,
) {
  const w = uuid.parse(params(req).w),
    key = uuid.parse(req.headers["idempotency-key"]);
  const route = `${req.method} ${req.url.split("?")[0]}`,
    hash = createHash("sha256")
      .update(stable(req.body ?? null))
      .digest("hex");
  const result = await transaction(req.session!.user_id, async (c) => {
    await workspace(c, w, true);
    const old = await c.query(
      "SELECT * FROM idempotency WHERE workspace_id=$1 AND actor_id=actor() AND route=$2 AND key=$3 AND expires_at>now()",
      [w, route, key],
    );
    if (old.rowCount) {
      if (old.rows[0].hash !== hash)
        fail(
          409,
          "idempotency_conflict",
          "This key was used with another request",
        );
      return {
        body: old.rows[0].response,
        status: old.rows[0].status,
        etag: old.rows[0].etag,
      };
    }
    const r = await fn(c, w);
    await c.query(
      "INSERT INTO idempotency(workspace_id,actor_id,route,key,hash,response,status,etag) VALUES($1,actor(),$2,$3,$4,$5,$6,$7) ON CONFLICT(workspace_id,actor_id,route,key) DO UPDATE SET hash=excluded.hash,response=excluded.response,status=excluded.status,etag=excluded.etag,expires_at=excluded.expires_at",
      [
        w,
        route,
        key,
        hash,
        JSON.stringify(r.body),
        r.status ?? 200,
        r.etag ?? null,
      ],
    );
    return r;
  });
  if (result.etag) reply.header("ETag", result.etag);
  return reply.code(result.status ?? 200).send(result.body);
}
async function object(c: PoolClient, w: string, id: string) {
  uuid.parse(id);
  const r = await c.query(
    "SELECT * FROM objects WHERE workspace_id=$1 AND id=$2",
    [w, id],
  );
  return r.rows[0] ?? missing();
}
async function editable(c: PoolClient, req: FastifyRequest, w: string) {
  const o = await object(c, w, params(req).id);
  if (o.author_id !== req.session!.user_id)
    fail(403, "forbidden", "Only the author can edit this object");
  precondition(req, o.version);
  return o;
}
async function refs(
  c: PoolClient,
  w: string,
  body: ReturnType<typeof content>,
  publishing = false,
) {
  for (const ref of body.source_refs) {
    const r = await c.query(
      `SELECT 1 FROM revisions WHERE workspace_id=$1 AND object_id=$2 AND revision=$3 ${publishing ? "AND published(workspace_id,object_id,revision)" : ""}`,
      [w, ref.id, ref.revision],
    );
    if (!r.rowCount)
      fail(
        422,
        "invalid_reference",
        "A source reference is unavailable for this audience",
      );
  }
}
async function append(
  c: PoolClient,
  w: string,
  o: any,
  body: unknown,
  reason: string,
  parent: number | null,
) {
  const revision = o.next_revision;
  await c.query(
    "INSERT INTO revisions(workspace_id,object_id,revision,content,actor_id,reason,parent_revision) VALUES($1,$2,$3,$4,actor(),$5,$6)",
    [w, o.id, revision, body, reason, parent],
  );
  await c.query(
    "UPDATE objects SET next_revision=next_revision+1,version=version+1,updated_at=now() WHERE id=$1",
    [o.id],
  );
  return revision;
}
async function view(c: PoolClient, w: string, id: string) {
  const o = await object(c, w, id);
  const drafts = await c.query(
    "SELECT revision FROM draft_heads WHERE workspace_id=$1 AND object_id=$2 AND author_id=actor()",
    [w, id],
  );
  const revision = drafts.rows[0]?.revision ?? o.current_revision;
  const r = await c.query(
    "SELECT * FROM revisions WHERE workspace_id=$1 AND object_id=$2 AND revision=$3",
    [w, id, revision],
  );
  const owner = (
    await c.query("SELECT actor() = $1::uuid AS yes", [o.author_id])
  ).rows[0].yes;
  return {
    id: o.id,
    workspace_id: o.workspace_id,
    type: o.type,
    author_id: o.author_id,
    current_revision: o.current_revision,
    created_at: o.created_at,
    updated_at: r.rows[0]?.created_at,
    revision,
    content: r.rows[0]?.content,
    origin: "human",
    review_state: "unreviewed",
    lifecycle: drafts.rowCount ? "draft" : "published",
    has_draft: !!drafts.rowCount,
    etag: etag(owner ? o.version : o.current_revision),
  };
}
function page(req: FastifyRequest) {
  const q = z
    .object({
      limit: z.coerce.number().int().min(1).max(100).default(25),
      cursor: uuid.optional(),
    })
    .parse(req.query);
  return q;
}
export async function installApi(app: FastifyInstance) {
  app.get("/v1/session", async (req) =>
    transaction(req.session!.user_id, async (c) => ({
      user: { id: req.session!.user_id, name: req.session!.name },
      csrf: req.session!.csrf,
      workspaces: (
        await c.query(
          "SELECT id,name,version FROM workspaces WHERE member(id) ORDER BY id",
        )
      ).rows,
    })),
  );
  app.post("/v1/workspaces", async (req, reply) => {
    const body = named.parse(req.body),
      key = uuid.parse(req.headers["idempotency-key"]);
    const result = await transaction(req.session!.user_id, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        req.session!.user_id,
      ]);
      const old = await c.query(
        "SELECT i.* FROM idempotency i WHERE actor_id=actor() AND route='POST /v1/workspaces' AND key=$1 AND expires_at>now()",
        [key],
      );
      const hash = stable(body);
      if (old.rowCount) {
        if (old.rows[0].hash !== hash)
          fail(409, "idempotency_conflict", "Key already used");
        return old.rows[0].response;
      }
      const count = await c.query(
        "SELECT count(*)::int n FROM workspaces WHERE created_by=actor() AND created_at>now()-interval '1 day'",
      );
      if (count.rows[0].n >= 5)
        fail(429, "rate_limit", "Workspace creation limit reached");
      const r = await c.query(
        "INSERT INTO workspaces(name,created_by) VALUES($1,actor()) RETURNING *",
        [body.name],
      );
      const w = r.rows[0];
      await c.query(
        "INSERT INTO memberships VALUES($1,actor(),ARRAY['member','admin'],NULL)",
        [w.id],
      );
      await audit(c, req, w.id, "workspace.created", w.id);
      const response = { ...w, etag: etag(w.version) };
      await c.query(
        "INSERT INTO idempotency(workspace_id,actor_id,route,key,hash,response,status) VALUES($1,actor(),'POST /v1/workspaces',$2,$3,$4,201)",
        [w.id, key, hash, response],
      );
      return response;
    });
    reply.header("ETag", result.etag).code(201);
    return result;
  });
  app.get("/v1/workspaces/:w/memberships", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      await workspace(c, params(req).w);
      return {
        items: (
          await c.query(
            "SELECT user_id,roles,revoked_at FROM memberships WHERE workspace_id=$1",
            [params(req).w],
          )
        ).rows,
      };
    }),
  );
  for (const method of ["POST", "DELETE"] as const)
    app.route({
      method,
      url:
        method === "POST"
          ? "/v1/workspaces/:w/memberships"
          : "/v1/workspaces/:w/memberships/:id",
      handler: async (req, reply) =>
        mutation(req, reply, async (c, w) => {
          const ws = await workspace(c, w);
          precondition(req, ws.version);
          requireMfa(req);
          if (
            !(await c.query("SELECT has_role($1,'admin') ok", [w])).rows[0].ok
          )
            fail(403, "forbidden", "Administrator role required");
          const b =
            method === "POST"
              ? z.object({ user_id: uuid, roles }).strict().parse(req.body)
              : { user_id: uuid.parse(params(req).id), roles: [] };
          if (
            !(
              await authDb.query("SELECT 1 FROM users WHERE id=$1", [b.user_id])
            ).rowCount
          )
            fail(422, "invalid_member", "Registered identity required");
          const admins = await c.query(
            "SELECT user_id FROM memberships WHERE workspace_id=$1 AND revoked_at IS NULL AND 'admin'=ANY(roles)",
            [w],
          );
          if (
            admins.rows.length === 1 &&
            admins.rows[0].user_id === b.user_id &&
            !b.roles.includes("admin")
          )
            fail(409, "last_admin", "Keep at least one administrator");
          if (method === "POST")
            await c.query(
              "INSERT INTO memberships VALUES($1,$2,$3,NULL) ON CONFLICT(workspace_id,user_id) DO UPDATE SET roles=excluded.roles,revoked_at=NULL",
              [w, b.user_id, b.roles],
            );
          else
            await c.query(
              "UPDATE memberships SET revoked_at=now() WHERE workspace_id=$1 AND user_id=$2",
              [w, b.user_id],
            );
          await c.query("UPDATE workspaces SET version=version+1 WHERE id=$1", [
            w,
          ]);
          await audit(
            c,
            req,
            w,
            method === "POST" ? "membership.granted" : "membership.revoked",
            b.user_id,
          );
          return { body: { user_id: b.user_id }, etag: etag(ws.version + 1) };
        }),
    });
  app.post("/v1/workspaces/:w/objects", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const b = createObject.parse(req.body);
      await refs(c, w, b.content);
      const r = await c.query(
        "INSERT INTO objects(workspace_id,type,author_id) VALUES($1,$2,actor()) RETURNING *",
        [w, b.type],
      );
      const o = r.rows[0],
        revision = await append(c, w, o, b.content, "Initial draft", null);
      await c.query("INSERT INTO draft_heads VALUES($1,$2,actor(),$3,NULL)", [
        w,
        o.id,
        revision,
      ]);
      await audit(c, req, w, "object.drafted", o.id, revision);
      const v = await view(c, w, o.id);
      return { body: v, status: 201, etag: v.etag };
    }),
  );
  app.get("/v1/workspaces/:w/objects", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const w = params(req).w;
      await workspace(c, w);
      const p = page(req);
      const r = await c.query(
        "SELECT id FROM objects WHERE workspace_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3",
        [w, p.cursor ?? null, p.limit + 1],
      );
      const items = await Promise.all(
        r.rows.slice(0, p.limit).map((o) => view(c, w, o.id)),
      );
      return {
        items,
        next_cursor: r.rows.length > p.limit ? items.at(-1)?.id : null,
      };
    }),
  );
  app.get("/v1/workspaces/:w/objects/:id", async (req, reply) =>
    transaction(req.session!.user_id, async (c) => {
      await workspace(c, params(req).w);
      const v = await view(c, params(req).w, params(req).id);
      reply.header("ETag", v.etag);
      return v;
    }),
  );
  app.get("/v1/workspaces/:w/objects/:id/revisions", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const { w, id } = params(req);
      await workspace(c, w);
      await object(c, w, id);
      const q = z
        .object({ before: z.coerce.number().int().positive().optional() })
        .parse(req.query);
      return {
        items: (
          await c.query(
            "SELECT r.*,published(workspace_id,object_id,revision) AS published FROM revisions r WHERE workspace_id=$1 AND object_id=$2 AND ($3::int IS NULL OR revision<$3) ORDER BY revision DESC LIMIT 25",
            [w, id, q.before ?? null],
          )
        ).rows,
      };
    }),
  );
  for (const correction of [false, true])
    app.route({
      method: correction ? "POST" : "PATCH",
      url: `/v1/workspaces/:w/objects/:id/${correction ? "corrections" : "draft"}`,
      handler: async (req, reply) =>
        mutation(req, reply, async (c, w) => {
          const o = await editable(c, req, w),
            b = z
              .object({
                content: z.unknown(),
                reason: z.string().trim().min(1).max(4000),
                ...(correction
                  ? { base_revision: z.number().int().positive() }
                  : {}),
              })
              .strict()
              .parse(req.body);
          const body = content(o.type, b.content);
          await refs(c, w, body);
          const d = await c.query(
            "SELECT * FROM draft_heads WHERE workspace_id=$1 AND object_id=$2 AND author_id=actor()",
            [w, o.id],
          );
          if (
            correction
              ? !!d.rowCount ||
                !o.current_revision ||
                b.base_revision !== o.current_revision
              : !d.rowCount
          )
            fail(409, "invalid_state", "Draft state changed");
          const revision = await append(
            c,
            w,
            o,
            body,
            b.reason,
            d.rows[0]?.revision ?? o.current_revision,
          );
          await c.query(
            "INSERT INTO draft_heads VALUES($1,$2,actor(),$3,$4) ON CONFLICT(workspace_id,object_id,author_id) DO UPDATE SET revision=excluded.revision",
            [w, o.id, revision, o.current_revision],
          );
          await audit(c, req, w, "object.revised", o.id, revision);
          const v = await view(c, w, o.id);
          return { body: v, etag: v.etag };
        }),
    });
  app.post("/v1/workspaces/:w/objects/:id/publish", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const o = await editable(c, req, w),
        b = z
          .object({
            revision: z.number().int().positive(),
            confirmation: z.literal(true),
          })
          .strict()
          .parse(req.body);
      const d = await c.query(
        "SELECT * FROM draft_heads WHERE workspace_id=$1 AND object_id=$2 AND author_id=actor()",
        [w, o.id],
      );
      if (!d.rowCount || d.rows[0].revision !== b.revision)
        fail(409, "invalid_state", "Draft changed");
      const r = await c.query(
        "SELECT content FROM revisions WHERE workspace_id=$1 AND object_id=$2 AND revision=$3",
        [w, o.id, b.revision],
      );
      const body = content(o.type, r.rows[0].content);
      await refs(c, w, body, true);
      const revision = await append(
        c,
        w,
        o,
        body,
        "Explicit workspace publication",
        b.revision,
      );
      await c.query(
        "INSERT INTO publications(workspace_id,object_id,revision,published_by) VALUES($1,$2,$3,actor())",
        [w, o.id, revision],
      );
      await c.query("UPDATE objects SET current_revision=$2 WHERE id=$1", [
        o.id,
        revision,
      ]);
      await c.query(
        "DELETE FROM draft_heads WHERE workspace_id=$1 AND object_id=$2 AND author_id=actor()",
        [w, o.id],
      );
      await audit(c, req, w, "object.published", o.id, revision);
      const v = await view(c, w, o.id);
      return { body: v, etag: v.etag };
    }),
  );
  app.post("/v1/workspaces/:w/projects", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const b = named.parse(req.body);
      const r = await c.query(
        "INSERT INTO projects(workspace_id,name,created_by) VALUES($1,$2,actor()) RETURNING *",
        [w, b.name],
      );
      await audit(c, req, w, "project.created", r.rows[0].id);
      return {
        body: { ...r.rows[0], etag: etag(1) },
        status: 201,
        etag: etag(1),
      };
    }),
  );
  app.get("/v1/workspaces/:w/projects", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const w = params(req).w;
      await workspace(c, w);
      const p = page(req);
      const r = await c.query(
        "SELECT * FROM projects WHERE workspace_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3",
        [w, p.cursor ?? null, p.limit + 1],
      );
      return {
        items: r.rows
          .slice(0, p.limit)
          .map((p) => ({ ...p, etag: etag(p.version) })),
        next_cursor: r.rows.length > p.limit ? r.rows[p.limit - 1].id : null,
      };
    }),
  );
  app.get("/v1/workspaces/:w/projects/:id/objects", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const { w, id } = params(req);
      await workspace(c, w);
      if (
        !(
          await c.query(
            "SELECT 1 FROM projects WHERE workspace_id=$1 AND id=$2",
            [w, uuid.parse(id)],
          )
        ).rowCount
      )
        missing();
      const p = page(req);
      const r = await c.query(
        "SELECT object_id FROM project_objects WHERE workspace_id=$1 AND project_id=$2 AND ($3::uuid IS NULL OR object_id>$3) ORDER BY object_id LIMIT $4",
        [w, id, p.cursor ?? null, p.limit + 1],
      );
      return {
        items: await Promise.all(
          r.rows.slice(0, p.limit).map((o) => view(c, w, o.object_id)),
        ),
        next_cursor:
          r.rows.length > p.limit ? r.rows[p.limit - 1].object_id : null,
      };
    }),
  );
  for (const action of ["add", "remove", "delete"])
    app.route({
      method: action === "add" ? "POST" : "DELETE",
      url: `/v1/workspaces/:w/projects/:id${action === "add" ? "/objects" : action === "remove" ? "/objects/:objectId" : ""}`,
      handler: async (req, reply) =>
        mutation(req, reply, async (c, w) => {
          const id = uuid.parse(params(req).id),
            r = await c.query(
              "SELECT *,has_role(workspace_id,'coordinator') coordinator FROM projects WHERE workspace_id=$1 AND id=$2",
              [w, id],
            );
          const p = r.rows[0] ?? missing();
          if (p.created_by !== req.session!.user_id && !p.coordinator)
            fail(403, "forbidden", "Project owner or coordinator required");
          precondition(req, p.version);
          if (action === "delete")
            await c.query("DELETE FROM projects WHERE id=$1", [id]);
          else {
            const oid = uuid.parse(
              action === "add"
                ? z.object({ object_id: uuid }).strict().parse(req.body)
                    .object_id
                : params(req).objectId,
            );
            const o = await object(c, w, oid);
            if (!o.current_revision)
              fail(
                422,
                "unpublished_reference",
                "Publish the object before sharing it through a project",
              );
            if (action === "add")
              await c.query(
                "INSERT INTO project_objects VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
                [w, id, oid],
              );
            else
              await c.query(
                "DELETE FROM project_objects WHERE workspace_id=$1 AND project_id=$2 AND object_id=$3",
                [w, id, oid],
              );
            await c.query("UPDATE projects SET version=version+1 WHERE id=$1", [
              id,
            ]);
          }
          await audit(c, req, w, `project.${action}`, id);
          return { body: { id }, etag: etag(p.version + 1) };
        }),
    });
}
