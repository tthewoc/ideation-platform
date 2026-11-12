import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { artifact, uuid, reason } from "./schema.js";
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
} from "./api.js";
import {
  digest,
  storeArtifact,
  readArtifact,
  validMedia,
  MAX_ARTIFACT_BYTES,
} from "./artifact-storage.js";
async function record(c: PoolClient, w: string, id: string) {
  uuid.parse(id);
  const a = (
    await c.query(
      "SELECT a.*,o.author_id FROM artifacts a JOIN objects o ON o.id=a.object_id WHERE a.workspace_id=$1 AND a.object_id=$2",
      [w, id],
    )
  ).rows[0];
  return a ?? missing();
}
function publicState(a: any) {
  return {
    id: a.object_id,
    kind: a.kind,
    state: a.state,
    etag: etag(a.version),
    scan_verdict: a.scan_verdict,
    scanner_version: a.scanner_version,
    scanned_at: a.scanned_at,
  };
}
async function event(
  c: PoolClient,
  req: FastifyRequest,
  w: string,
  id: string,
  state: string,
  why: string,
) {
  await c.query(
    "INSERT INTO artifact_events(workspace_id,object_id,state,reason,actor_id) VALUES($1,$2,$3,$4,actor())",
    [w, id, state, why],
  );
  await audit(c, req, w, `artifact.${state}`, id);
}
export async function installArtifacts(app: FastifyInstance) {
  app.post("/v1/workspaces/:w/artifacts", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const b = artifact.parse(req.body),
        id = randomUUID();
      const count = await c.query(
        "SELECT count(*)::int n FROM artifacts WHERE workspace_id=$1 AND created_at>now()-interval '1 day'",
        [w],
      );
      if (count.rows[0].n >= 100)
        fail(
          429,
          "artifact_quota",
          "Workspace artifact registration limit reached",
        );
      await c.query(
        "INSERT INTO objects(id,workspace_id,type,author_id) VALUES($1,$2,'artifact',actor())",
        [id, w],
      );
      await append(
        c,
        w,
        { id, next_revision: 1 },
        b,
        "Artifact registered",
        null,
      );
      await c.query(
        "INSERT INTO draft_heads(workspace_id,object_id,author_id,revision) VALUES($1,$2,actor(),1)",
        [w, id],
      );
      const state = b.kind === "physical" ? "available" : "registered";
      await c.query(
        "INSERT INTO artifacts(workspace_id,object_id,kind,state) VALUES($1,$2,$3,$4)",
        [w, id, b.kind, state],
      );
      await event(
        c,
        req,
        w,
        id,
        state,
        b.kind === "physical"
          ? "Physical custody record; no digital scan applies"
          : "Awaiting upload",
      );
      return {
        body: {
          object: await view(c, w, id),
          artifact: publicState(await record(c, w, id)),
        },
        status: 201,
      };
    }),
  );
  app.get("/v1/workspaces/:w/artifacts", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const { w } = params(req);
      await workspace(c, w);
      const q = z.object({ after: uuid.optional() }).parse(req.query);
      const rows = (
        await c.query(
          "SELECT * FROM artifacts WHERE workspace_id=$1 AND ($2::uuid IS NULL OR object_id>$2) ORDER BY object_id LIMIT 26",
          [w, q.after ?? null],
        )
      ).rows;
      return {
        items: rows.slice(0, 25).map(publicState),
        next_cursor: rows.length > 25 ? rows[24].object_id : null,
      };
    }),
  );
  app.get("/v1/workspaces/:w/artifacts/:id", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const { w, id } = params(req);
      await workspace(c, w);
      return {
        ...publicState(await record(c, w, id)),
        events: (
          await c.query(
            "SELECT state,reason,actor_id,created_at FROM artifact_events WHERE workspace_id=$1 AND object_id=$2 ORDER BY created_at,id LIMIT 100",
            [w, id],
          )
        ).rows,
      };
    }),
  );
  app.post(
    "/v1/workspaces/:w/artifacts/:id/upload",
    { bodyLimit: 1500000 },
    async (req, reply) =>
      mutation(req, reply, async (c, w) => {
        const { id } = params(req),
          a = await record(c, w, id);
        precondition(req, a.version);
        if (a.author_id !== req.session!.user_id)
          fail(403, "forbidden", "Only the registrant can upload");
        if (a.kind !== "digital" || a.state !== "registered")
          fail(
            409,
            "invalid_state",
            "Upload already completed or not applicable",
          );
        const b = z
          .object({
            base64: z
              .string()
              .min(1)
              .max(1400000)
              .regex(
                /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
              ),
          })
          .strict()
          .parse(req.body);
        const bytes = Buffer.from(b.base64, "base64"),
          meta = (await view(c, w, id, 1)).content as any;
        let rejected =
          bytes.length > MAX_ARTIFACT_BYTES ||
          bytes.length !== meta.byte_size ||
          digest(bytes) !== meta.sha256
            ? "integrity_mismatch"
            : !validMedia(bytes, meta.media_type)
              ? "invalid_type"
              : null;
        const key = rejected ? null : randomUUID();
        if (key) await storeArtifact(key, bytes);
        await c.query(
          "UPDATE artifacts SET state=$3,storage_key=$4,scan_verdict=$5,version=version+1 WHERE workspace_id=$1 AND object_id=$2",
          [w, id, rejected ? "rejected" : "quarantined", key, rejected],
        );
        await event(
          c,
          req,
          w,
          id,
          rejected ? "rejected" : "quarantined",
          rejected ?? "Integrity checked; awaiting malware scan",
        );
        return { body: publicState(await record(c, w, id)), status: 202 };
      }),
  );
  app.post("/v1/workspaces/:w/artifacts/:id/transitions", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const { id } = params(req),
        a = await record(c, w, id),
        b = z
          .object({ state: z.enum(["restricted", "retracted"]), reason })
          .strict()
          .parse(req.body);
      precondition(req, a.version);
      if (
        a.author_id !== req.session!.user_id &&
        !(await c.query("SELECT has_role($1,'moderator') ok", [w])).rows[0].ok
      )
        fail(403, "forbidden", "Owner or moderator required");
      if (
        !["available", "restricted"].includes(a.state) ||
        (a.state === "restricted" && b.state !== "retracted")
      )
        fail(409, "invalid_state", "Artifact cannot make this transition");
      await c.query(
        "UPDATE artifacts SET state=$3,version=version+1 WHERE workspace_id=$1 AND object_id=$2",
        [w, id, b.state],
      );
      // Invalidate every published pin without deleting the historical metadata.
      await c.query(
        "INSERT INTO revision_status(workspace_id,object_id,revision,validity) SELECT workspace_id,object_id,revision,'retracted' FROM publications WHERE workspace_id=$1 AND object_id=$2 ON CONFLICT(workspace_id,object_id,revision) DO UPDATE SET validity='retracted',version=revision_status.version+1",
        [w, id],
      );
      await c.query("SELECT bump_content_epoch($1)", [w]);
      await event(c, req, w, id, b.state, b.reason);
      return { body: publicState(await record(c, w, id)) };
    }),
  );
  app.get("/v1/workspaces/:w/artifacts/:id/download", async (req, reply) => {
    const output = await transaction(req.session!.user_id, async (c) => {
      const { w, id } = params(req);
      await workspace(c, w);
      const a = await record(c, w, id);
      if (a.kind !== "digital" || a.state !== "available") missing();
      const meta = (await view(c, w, id)).content as any;
      const bytes = await readArtifact(a.storage_key);
      if (bytes.length !== meta.byte_size || digest(bytes) !== meta.sha256)
        fail(
          409,
          "integrity_mismatch",
          "Stored bytes no longer match the registered digest",
        );
      return { bytes, filename: meta.filename };
    });
    return reply
      .header("Cache-Control", "private, no-store")
      .header("Content-Type", "application/octet-stream")
      .header(
        "Content-Disposition",
        `attachment; filename="${output.filename}"`,
      )
      .header("X-Content-Type-Options", "nosniff")
      .send(output.bytes);
  });
}
