import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuid, reason } from "./schema.js";
import { transaction, fail, missing } from "./db.js";
import {
  workspace,
  mutation,
  params,
  audit,
  etag,
  precondition,
} from "./api.js";
import { pinned } from "./graph-core.js";
export async function installExports(app: FastifyInstance) {
  app.get("/v1/workspaces/:w/objects/:id/export-policy", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const { w, id } = params(req);
      await workspace(c, w);
      const q = z
        .object({ revision: z.coerce.number().int().positive() })
        .parse(req.query);
      const p = await pinned(c, w, { id, revision: q.revision });
      const policy = (
        await c.query(
          "SELECT * FROM export_policies WHERE workspace_id=$1 AND object_id=$2 AND revision=$3",
          [w, id, q.revision],
        )
      ).rows[0];
      return {
        allowed: policy?.allowed ?? p.type !== "artifact",
        reason:
          policy?.reason ??
          (p.type === "artifact"
            ? "Artifact export requires an explicit license/usage decision"
            : "Workspace publication permits metadata export"),
        etag: etag(policy?.version ?? 0),
      };
    }),
  );
  app.post("/v1/workspaces/:w/objects/:id/export-policy", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const { id } = params(req),
        b = z
          .object({
            revision: z.number().int().positive(),
            allowed: z.boolean(),
            reason,
          })
          .strict()
          .parse(req.body);
      await pinned(c, w, { id, revision: b.revision });
      const prior = (
        await c.query(
          "SELECT version FROM export_policies WHERE workspace_id=$1 AND object_id=$2 AND revision=$3",
          [w, id, b.revision],
        )
      ).rows[0];
      precondition(req, prior?.version ?? 0);
      const p = (
        await c.query(
          "INSERT INTO export_policies(workspace_id,object_id,revision,allowed,reason,actor_id) VALUES($1,$2,$3,$4,$5,actor()) ON CONFLICT(workspace_id,object_id,revision) DO UPDATE SET allowed=excluded.allowed,reason=excluded.reason,actor_id=actor(),version=export_policies.version+1 RETURNING version",
          [w, id, b.revision, b.allowed, b.reason],
        )
      ).rows[0];
      await c.query(
        "INSERT INTO export_policy_events(workspace_id,object_id,revision,allowed,reason,actor_id) VALUES($1,$2,$3,$4,$5,actor())",
        [w, id, b.revision, b.allowed, b.reason],
      );
      await c.query("SELECT bump_content_epoch($1)", [w]);
      await audit(c, req, w, "export.policy_changed", id, b.revision);
      return { body: { ...b, etag: etag(p.version) } };
    }),
  );
  app.post("/v1/workspaces/:w/exports", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const b = z
        .object({
          object_ids: z.array(uuid).min(1).max(100),
          format: z.literal("json-v1"),
        })
        .strict()
        .parse(req.body);
      const roots = [];
      for (const id of new Set(b.object_ids)) {
        const o = (
          await c.query(
            "SELECT current_revision FROM objects WHERE workspace_id=$1 AND id=$2",
            [w, id],
          )
        ).rows[0];
        if (!o?.current_revision) missing();
        await pinned(c, w, { id, revision: o.current_revision });
        roots.push({ id, revision: o.current_revision });
      }
      if (
        (
          await c.query(
            "SELECT count(*)::int n FROM export_jobs WHERE workspace_id=$1 AND actor_id=actor() AND created_at>now()-interval '1 hour'",
            [w],
          )
        ).rows[0].n >= 10
      )
        fail(
          429,
          "export_quota",
          "Limit of ten export requests per hour reached",
        );
      const job = (
        await c.query(
          "INSERT INTO export_jobs(workspace_id,actor_id,roots) VALUES($1,actor(),$2) RETURNING id,state,expires_at",
          [w, JSON.stringify(roots)],
        )
      ).rows[0];
      await audit(c, req, w, "export.requested", job.id);
      return { body: job, status: 202 };
    }),
  );
  app.get("/v1/workspaces/:w/exports", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const { w } = params(req);
      await workspace(c, w);
      return {
        items: (
          await c.query(
            "SELECT id,state,created_at,expires_at FROM export_jobs WHERE workspace_id=$1 AND actor_id=actor() AND expires_at>now() ORDER BY created_at DESC LIMIT 25",
            [w],
          )
        ).rows,
      };
    }),
  );
  app.get("/v1/workspaces/:w/exports/:id", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const { w, id } = params(req),
        ws = await workspace(c, w);
      uuid.parse(id);
      const j =
        (
          await c.query(
            "SELECT id,state,created_at,expires_at,policy_version,content_epoch FROM export_jobs WHERE workspace_id=$1 AND id=$2 AND expires_at>now()",
            [w, id],
          )
        ).rows[0] ?? missing();
      return {
        id: j.id,
        state:
          j.state === "ready" &&
          (j.policy_version !== ws.version ||
            j.content_epoch !== ws.content_epoch)
            ? "stale"
            : j.state,
        expires_at: j.expires_at,
      };
    }),
  );
  app.get("/v1/workspaces/:w/exports/:id/download", async (req, reply) => {
    const data = await transaction(req.session!.user_id, async (c) => {
      const { w, id } = params(req),
        ws = await workspace(c, w, true);
      uuid.parse(id);
      const j =
        (
          await c.query(
            "SELECT * FROM export_jobs WHERE workspace_id=$1 AND id=$2 AND expires_at>now()",
            [w, id],
          )
        ).rows[0] ?? missing();
      if (j.state !== "ready")
        fail(409, "export_not_ready", "Export is not ready");
      if (
        j.policy_version !== ws.version ||
        j.content_epoch !== ws.content_epoch
      )
        fail(
          409,
          "export_stale",
          "Permissions or content changed. Request a new export",
        );
      const refs = j.manifest as { id: string; revision: number }[],
        ids = refs.map((r) => r.id),
        revs = refs.map((r) => r.revision);
      await c.query("SELECT set_config('statement_timeout','2000',true)");
      const objects = (
        await c.query(
          `SELECT o.id,o.type,o.author_id,r.revision,r.schema_version,r.content,r.origin,r.created_at,COALESCE(s.review_state,'unreviewed') review_state,COALESCE(s.validity,'active') validity,CASE WHEN f.epoch=$4 THEN f.status ELSE 'unknown' END freshness FROM unnest($2::uuid[],$3::integer[]) x(id,rev) JOIN revisions r ON r.workspace_id=$1 AND r.object_id=x.id AND r.revision=x.rev JOIN objects o ON o.id=r.object_id LEFT JOIN revision_status s ON s.workspace_id=r.workspace_id AND s.object_id=r.object_id AND s.revision=r.revision LEFT JOIN revision_freshness f ON f.workspace_id=r.workspace_id AND f.object_id=r.object_id AND f.revision=r.revision WHERE retrievable_revision($1,x.id,x.rev,true) ORDER BY o.id,r.revision`,
          [w, ids, revs, ws.content_epoch],
        )
      ).rows;
      if (objects.length !== refs.length)
        fail(
          409,
          "export_stale",
          "Export permission changed. Request a new export",
        );
      const edges = (
        await c.query(
          `SELECT e.id,r.revision,r.type,r.from_id,r.from_revision,r.to_id,r.to_revision,e.assessment_id,r.assessment_revision,r.rationale,r.condition,r.valid_from,r.valid_to,r.state,r.actor_id FROM edges e JOIN edge_revisions r ON r.edge_id=e.id AND r.revision=e.current_revision JOIN unnest($2::uuid[],$3::integer[]) a(id,rev) ON a.id=r.from_id AND a.rev=r.from_revision JOIN unnest($2::uuid[],$3::integer[]) b(id,rev) ON b.id=r.to_id AND b.rev=r.to_revision WHERE e.workspace_id=$1 AND (e.assessment_id IS NULL OR EXISTS(SELECT 1 FROM unnest($2::uuid[],$3::integer[]) x(id,rev) WHERE x.id=e.assessment_id AND x.rev=r.assessment_revision)) ORDER BY e.id LIMIT 1001`,
          [w, ids, revs],
        )
      ).rows;
      const lineage = (
        await c.query(
          `SELECT l.derived_id,l.derived_revision,l.input_id,l.input_revision FROM lineage l JOIN unnest($2::uuid[],$3::integer[]) a(id,rev) ON a.id=l.derived_id AND a.rev=l.derived_revision JOIN unnest($2::uuid[],$3::integer[]) b(id,rev) ON b.id=l.input_id AND b.rev=l.input_revision WHERE l.workspace_id=$1 ORDER BY l.derived_id,l.derived_revision,l.input_id LIMIT 2001`,
          [w, ids, revs],
        )
      ).rows;
      if (edges.length > 1000 || lineage.length > 2000)
        fail(413, "export_limit", "Choose fewer objects for this export");
      const reviews = (
        await c.query(
          `SELECT v.object_id,v.revision,v.decision,v.reason,v.conflict_declaration,v.reviewer_id,v.created_at FROM reviews v JOIN unnest($2::uuid[],$3::integer[]) x(id,rev) ON x.id=v.object_id AND (x.rev=v.revision OR v.revision=(SELECT review_source_revision FROM revision_status WHERE workspace_id=$1 AND object_id=x.id AND revision=x.rev)) WHERE v.workspace_id=$1 ORDER BY v.created_at,v.id LIMIT 1001`,
          [w, ids, revs],
        )
      ).rows;
      if (reviews.length > 1000)
        fail(413, "export_limit", "Choose fewer objects for this export");
      const body = JSON.stringify({
        format: "ideator-json-v1",
        schema_version: 1,
        exported_at: new Date().toISOString(),
        workspace_id: w,
        objects,
        edges,
        lineage,
        reviews,
        warnings: j.warning
          ? [
              "Some requested content was omitted because current permissions or usage restrictions do not allow export.",
            ]
          : [],
        artifact_bytes_included: false,
      });
      if (Buffer.byteLength(body) > 4 * 1024 * 1024)
        fail(413, "export_limit", "Export exceeds 4 MiB. Choose fewer objects");
      await audit(c, req, w, "export.downloaded", id);
      return body;
    });
    return reply
      .header("Content-Type", "application/json; charset=utf-8")
      .header(
        "Content-Disposition",
        'attachment; filename="ideator-export.json"',
      )
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff")
      .send(data);
  });
}
