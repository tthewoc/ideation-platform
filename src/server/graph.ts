import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { transaction, fail, missing } from "./db.js";
import {
  audit,
  workspace,
  mutation,
  params,
  precondition,
  view,
  etag,
} from "./api.js";
import { uuid, reason, type Ref } from "./schema.js";
import {
  edgeInput,
  insertEdge,
  pinned,
  mutableDependencies,
} from "./graph-core.js";
const allTypes = [
  "supports",
  "contradicts",
  "qualifies",
  "inconclusive",
  "derived_from",
  "tests",
  "depends_on",
  "uses_method",
  "produces",
  "relevant_to",
  "part_of",
  "supersedes",
  "cites",
] as const;
type Queue = { ref: Ref; depth: number; after: string | null };
type Traversal = {
  roots: string[];
  types: string[];
  depth: number;
  queue: Queue[];
  seen: string[];
  edges: string[];
};
const key = (r: Ref) => `${r.id}:${r.revision}`;
export async function installGraph(app: FastifyInstance) {
  app.post("/v1/workspaces/:w/edges", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const b = edgeInput.parse(req.body);
      if (b.type === "supersedes")
        fail(
          422,
          "transition_required",
          "Use the validity transition to supersede an object",
        );
      const edge = await insertEdge(c, w, b);
      await c.query("SELECT bump_content_epoch($1)", [w]);
      await audit(c, req, w, "edge.created", edge.id, edge.current_revision);
      return { body: edge, status: 201, etag: edge.etag };
    }),
  );
  app.post("/v1/workspaces/:w/edges/:id/retract", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const b = z.object({ reason }).strict().parse(req.body),
        id = uuid.parse(params(req).id);
      const q = await c.query(
        "SELECT e.*,r.* FROM edges e JOIN edge_revisions r ON r.edge_id=e.id AND r.revision=e.current_revision WHERE e.workspace_id=$1 AND e.id=$2",
        [w, id],
      );
      const e = q.rows[0] ?? missing();
      if (e.type === "depends_on") await mutableDependencies(c, w, e.from_id);
      precondition(req, e.current_revision);
      if (e.assessment_id)
        fail(
          409,
          "assessment_projection",
          "Retract or correct the assessment instead",
        );
      if (
        e.author_id !== req.session!.user_id &&
        !(await c.query("SELECT has_role($1,'moderator') yes", [w])).rows[0].yes
      )
        fail(403, "forbidden", "Edge author or moderator required");
      if (e.state !== "active")
        fail(409, "invalid_state", "Edge already retracted");
      const rev = e.current_revision + 1;
      await c.query(
        "INSERT INTO edge_revisions(workspace_id,edge_id,revision,type,from_id,from_revision,to_id,to_revision,rationale,condition,valid_from,valid_to,state,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'retracted',actor())",
        [
          w,
          id,
          rev,
          e.type,
          e.from_id,
          e.from_revision,
          e.to_id,
          e.to_revision,
          b.reason,
          e.condition,
          e.valid_from,
          e.valid_to,
        ],
      );
      await c.query("UPDATE edges SET current_revision=$2 WHERE id=$1", [
        id,
        rev,
      ]);
      await c.query("SELECT bump_content_epoch($1)", [w]);
      await audit(c, req, w, "edge.retracted", id, rev);
      return {
        body: { id, revision: rev, state: "retracted" },
        etag: etag(rev),
      };
    }),
  );
  app.get("/v1/workspaces/:w/edges/:id/revisions", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const { w, id } = params(req);
      await workspace(c, w);
      const r = await c.query(
        "SELECT * FROM edge_revisions WHERE workspace_id=$1 AND edge_id=$2 ORDER BY revision DESC LIMIT 100",
        [w, uuid.parse(id)],
      );
      if (!r.rowCount) missing();
      return { items: r.rows };
    }),
  );
  app.post(
    "/v1/workspaces/:w/graph/query",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
          keyGenerator: (req) => `${req.session?.user_id ?? req.ip}:graph`,
        },
      },
    },
    async (req) =>
      transaction(req.session!.user_id, async (c) => {
        const { w } = params(req),
          ws = await workspace(c, w);
        const b = z
          .object({
            root_ids: z.array(uuid).min(1).max(25),
            edge_types: z
              .array(z.enum(allTypes))
              .min(1)
              .max(allTypes.length)
              .default([...allTypes]),
            depth: z.number().int().min(1).max(4).default(2),
            cursor: uuid.optional(),
          })
          .strict()
          .parse(req.body);
        await c.query("SELECT set_config('statement_timeout','2000',true)");
        let traversal: Traversal;
        if (b.cursor) {
          const row =
            (
              await c.query(
                "SELECT * FROM graph_cursors WHERE id=$1 AND workspace_id=$2 AND expires_at>now()",
                [b.cursor, w],
              )
            ).rows[0] ?? missing();
          if (
            row.policy_version !== ws.version ||
            row.content_epoch !== ws.content_epoch
          )
            fail(
              409,
              "stale_cursor",
              "The graph or permissions changed. Start a new query.",
            );
          traversal = row.state;
          if (
            JSON.stringify(traversal.roots) !== JSON.stringify(b.root_ids) ||
            traversal.depth !== b.depth ||
            JSON.stringify(traversal.types) !== JSON.stringify(b.edge_types)
          )
            fail(
              422,
              "cursor_query_mismatch",
              "Continue with the original graph query",
            );
        } else {
          const roots: Ref[] = [];
          for (const id of b.root_ids) {
            const row = (
              await c.query(
                "SELECT current_revision FROM objects WHERE workspace_id=$1 AND id=$2",
                [w, id],
              )
            ).rows[0];
            if (!row?.current_revision) missing();
            roots.push({ id, revision: row.current_revision });
          }
          traversal = {
            roots: b.root_ids,
            types: b.edge_types,
            depth: b.depth,
            queue: roots.map((ref) => ({ ref, depth: 0, after: null })),
            seen: roots.map(key),
            edges: [],
          };
        }
        const seen = new Set(traversal.seen),
          seenEdges = new Set(traversal.edges),
          nodes = new Map<string, Ref>(),
          edges: any[] = [];
        const deadline = Date.now() + 1500;
        let bounded = false;
        if (!b.cursor)
          for (const root of traversal.queue.slice(0, 25))
            nodes.set(key(root.ref), root.ref);
        while (
          traversal.queue.length &&
          edges.length < 1000 &&
          Date.now() < deadline
        ) {
          const item = traversal.queue[0];
          if (item.depth >= traversal.depth) {
            traversal.queue.shift();
            continue;
          }
          const rows = await c.query(
            `SELECT e.id,e.assessment_id,r.*,COALESCE(s.review_state,'unreviewed') review_state,COALESCE(s.validity,'active') assessment_validity FROM edges e JOIN edge_revisions r ON r.edge_id=e.id AND r.revision=e.current_revision LEFT JOIN objects a ON a.id=e.assessment_id LEFT JOIN revision_status s ON s.workspace_id=e.workspace_id AND s.object_id=e.assessment_id AND s.revision=r.assessment_revision WHERE e.workspace_id=$1 AND r.state='active' AND r.type=ANY($2::text[]) AND ((r.from_id=$3 AND r.from_revision=$4) OR (r.to_id=$3 AND r.to_revision=$4)) AND ($5::uuid IS NULL OR e.id>$5) AND (e.assessment_id IS NULL OR a.current_revision=r.assessment_revision) ORDER BY e.id LIMIT 101`,
            [w, traversal.types, item.ref.id, item.ref.revision, item.after],
          );
          let consumed = 0;
          for (const e of rows.rows.slice(0, 100)) {
            const a = { id: e.from_id, revision: e.from_revision },
              b = { id: e.to_id, revision: e.to_revision };
            const added = [a, b].filter((r) => !nodes.has(key(r)));
            if (nodes.size + added.length > 500 || edges.length >= 1000) {
              bounded = true;
              break;
            }
            item.after = e.id;
            consumed++;
            if (seenEdges.has(e.id)) continue;
            seenEdges.add(e.id);
            edges.push({ ...e, etag: etag(e.revision) });
            for (const r of [a, b]) {
              nodes.set(key(r), r);
              if (!seen.has(key(r))) {
                seen.add(key(r));
                traversal.queue.push({
                  ref: r,
                  depth: item.depth + 1,
                  after: null,
                });
              }
            }
          }
          if (bounded) break;
          if (rows.rows.length <= 100 && consumed === rows.rows.length)
            traversal.queue.shift();
          if (seen.size >= 10000 || seenEdges.size >= 20000) {
            bounded = true;
            break;
          }
        }
        if (!nodes.size && !b.cursor)
          for (const root of traversal.queue.slice(0, 25))
            nodes.set(key(root.ref), root.ref);
        let next_cursor: string | null = null;
        const query_limit = seen.size >= 10000 || seenEdges.size >= 20000;
        if (traversal.queue.length && !query_limit) {
          traversal.seen = [...seen];
          traversal.edges = [...seenEdges];
          next_cursor = (
            await c.query(
              "INSERT INTO graph_cursors(workspace_id,actor_id,policy_version,content_epoch,state) VALUES($1,actor(),$2,$3,$4) RETURNING id",
              [w, ws.version, ws.content_epoch, traversal],
            )
          ).rows[0].id;
        }
        await c.query(
          "DELETE FROM graph_cursors WHERE actor_id=actor() AND expires_at<=now()",
        );
        return {
          nodes: (
            await c.query(
              `SELECT o.id,o.workspace_id,o.type,o.author_id,o.current_revision,r.revision,r.content,r.origin,r.created_at AS updated_at,'published' AS lifecycle,false AS has_draft,COALESCE(s.review_state,'unreviewed') AS review_state,COALESCE(s.validity,'active') AS validity,'"'||COALESCE(s.version,1)||'"' AS state_etag,'"'||r.revision||'"' AS etag,CASE WHEN f.epoch=ws.content_epoch THEN f.status ELSE 'unknown' END AS freshness FROM unnest($2::uuid[],$3::integer[]) wanted(id,rev) JOIN objects o ON o.id=wanted.id JOIN revisions r ON r.workspace_id=o.workspace_id AND r.object_id=o.id AND r.revision=wanted.rev JOIN workspaces ws ON ws.id=o.workspace_id LEFT JOIN revision_status s ON s.workspace_id=r.workspace_id AND s.object_id=r.object_id AND s.revision=r.revision LEFT JOIN revision_freshness f ON f.workspace_id=r.workspace_id AND f.object_id=r.object_id AND f.revision=r.revision WHERE o.workspace_id=$1`,
              [
                w,
                [...nodes.values()].map((r) => r.id),
                [...nodes.values()].map((r) => r.revision),
              ],
            )
          ).rows,
          edges,
          truncated: !!traversal.queue.length,
          next_cursor,
          query_limit,
        };
      }),
  );
  app.get("/v1/workspaces/:w/objects/:id/provenance", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const { w, id } = params(req);
      await workspace(c, w);
      const b = z
        .object({ revision: z.coerce.number().int().positive() })
        .parse(req.query);
      await pinned(
        c,
        w,
        { id: uuid.parse(id), revision: b.revision },
        undefined,
        false,
      );
      const rows = await c.query(
        "SELECT * FROM lineage WHERE workspace_id=$1 AND derived_id=$2 AND derived_revision=$3 ORDER BY input_id,input_revision LIMIT 101",
        [w, id, b.revision],
      );
      return {
        inputs: rows.rows.slice(0, 100),
        truncated: rows.rows.length > 100,
      };
    }),
  );
}
