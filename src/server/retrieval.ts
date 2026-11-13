import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { transaction, fail } from "./db.js";
import { workspace, params, mutation, audit } from "./api.js";
import { uuid, objectType } from "./schema.js";
import { pinned } from "./graph-core.js";
const querySchema = z
  .object({
    q: z.string().trim().max(200).default(""),
    channels: z.enum(["lexical", "graph", "lexical,graph"]).default("lexical"),
    root_id: uuid.optional(),
    type: objectType.optional(),
    outcome: z
      .enum(["positive", "negative", "null", "ambiguous", "interrupted"])
      .optional(),
    cursor: uuid.optional(),
  })
  .strict();
export async function installRetrieval(app: FastifyInstance) {
  app.get("/v1/workspaces/:w/search/status", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const { w } = params(req),
        ws = await workspace(c, w);
      const s = (
        await c.query("SELECT * FROM search_state WHERE workspace_id=$1", [w])
      ).rows[0];
      return {
        state: s?.active_generation
          ? s.requested || s.active_epoch !== ws.content_epoch
            ? "updating"
            : "ready"
          : "pending",
        vector_channel: "disabled",
        retrying: s?.last_error ?? false,
        updated_at: s?.updated_at ?? null,
      };
    }),
  );
  app.post("/v1/workspaces/:w/search/rebuild", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      z.object({}).strict().parse(req.body);
      await c.query("SELECT request_search_rebuild($1)", [w]);
      await audit(c, req, w, "search.rebuild_requested");
      return { body: { state: "queued" }, status: 202 };
    }),
  );
  app.get(
    "/v1/workspaces/:w/search",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req) =>
      transaction(req.session!.user_id, async (c) => {
        const { w } = params(req),
          ws = await workspace(c, w, true),
          q = querySchema.parse(req.query),
          { cursor, ...query } = q;
        if (q.channels.includes("lexical") && !q.q)
          fail(422, "query_required", "Enter a search phrase");
        if (q.channels.includes("graph") && !q.root_id)
          fail(422, "root_required", "Select a published starting object");
        await c.query("SELECT set_config('statement_timeout','2000',true)");
        const s = (
          await c.query("SELECT * FROM search_state WHERE workspace_id=$1", [w])
        ).rows[0];
        let afterScore: string | null = null,
          afterId: string | null = null;
        if (cursor) {
          const old = (
            await c.query(
              "SELECT * FROM search_cursors WHERE id=$1 AND workspace_id=$2 AND actor_id=actor() AND expires_at>now()",
              [cursor, w],
            )
          ).rows[0];
          if (
            !old ||
            old.policy_version !== ws.version ||
            old.content_epoch !== ws.content_epoch ||
            old.generation !== s?.active_generation ||
            [
              ...new Set([...Object.keys(query), ...Object.keys(old.query)]),
            ].some(
              (k) => (old.query[k] ?? null) !== ((query as any)[k] ?? null),
            )
          )
            fail(409, "stale_cursor", "Search changed. Start a new search");
          afterScore = old.last_score;
          afterId = old.last_id;
        }
        let neighbors: string[] = [],
          graphTruncated = false;
        if (q.root_id) {
          const root = (
            await c.query(
              "SELECT current_revision FROM objects WHERE workspace_id=$1 AND id=$2",
              [w, q.root_id],
            )
          ).rows[0];
          if (!root?.current_revision)
            fail(404, "not_found", "Resource not found");
          await pinned(c, w, {
            id: q.root_id,
            revision: root.current_revision,
          });
          if (
            !(
              await c.query("SELECT retrievable_revision($1,$2,$3,false) ok", [
                w,
                q.root_id,
                root.current_revision,
              ])
            ).rows[0].ok
          )
            fail(404, "not_found", "Resource not found");
          if (q.channels.includes("graph")) {
            const rows = (
              await c.query(
                `SELECT DISTINCT x.id FROM (
    (SELECT r.to_id id FROM edge_revisions r JOIN edges e ON e.id=r.edge_id AND e.current_revision=r.revision JOIN objects n ON n.id=r.to_id AND n.current_revision=r.to_revision WHERE r.workspace_id=$1 AND r.from_id=$2 AND r.from_revision=$3 AND r.state='active' AND retrievable_revision($1,n.id,n.current_revision,false) AND (e.assessment_id IS NULL OR EXISTS(SELECT 1 FROM objects a WHERE a.id=e.assessment_id AND a.current_revision=r.assessment_revision AND retrievable_revision($1,a.id,a.current_revision,false))) ORDER BY r.edge_id LIMIT 201)
    UNION ALL
    (SELECT r.from_id id FROM edge_revisions r JOIN edges e ON e.id=r.edge_id AND e.current_revision=r.revision JOIN objects n ON n.id=r.from_id AND n.current_revision=r.from_revision WHERE r.workspace_id=$1 AND r.to_id=$2 AND r.to_revision=$3 AND r.state='active' AND retrievable_revision($1,n.id,n.current_revision,false) AND (e.assessment_id IS NULL OR EXISTS(SELECT 1 FROM objects a WHERE a.id=e.assessment_id AND a.current_revision=r.assessment_revision AND retrievable_revision($1,a.id,a.current_revision,false))) ORDER BY r.edge_id LIMIT 201)
   ) x ORDER BY x.id LIMIT 201`,
                [w, q.root_id, root.current_revision],
              )
            ).rows;
            neighbors = rows.slice(0, 200).map((r) => r.id);
            graphTruncated = rows.length > 200;
          }
        }
        if (!s?.active_generation)
          return {
            items: [],
            next_cursor: null,
            index_state: "pending",
            graph_truncated: graphTruncated,
            vector_channel: "disabled",
          };
        const candidates = (
          await c.query(
            `SELECT object_id FROM search_candidate_ids($1,$2,$3,$4,$5,$6)`,
            [
              w,
              s.active_generation,
              q.channels === "graph" ? "" : q.q,
              neighbors,
              q.type ?? null,
              q.outcome ?? null,
            ],
          )
        ).rows;
        const candidateIds = candidates.slice(0, 1000).map((r) => r.object_id);
        const rows = (
          await c.query(
            `WITH hits AS MATERIALIZED(
   SELECT o.id,o.type,r.revision,r.content,r.origin,o.author_id,
    round((CASE WHEN $3<>'' AND d.document@@plainto_tsquery('simple',$3) THEN ts_rank_cd(d.document,plainto_tsquery('simple',$3)) ELSE 0 END + CASE WHEN o.id=ANY($4::uuid[]) THEN 0.05 ELSE 0 END)::numeric,6) score,
    ($3<>'' AND d.document@@plainto_tsquery('simple',$3)) lexical_match,(o.id=ANY($4::uuid[])) graph_match,
    COALESCE(st.review_state,'unreviewed') review_state,COALESCE(st.validity,'active') validity,
    CASE WHEN f.epoch=$9 THEN f.status ELSE 'unknown' END freshness
   FROM unnest($10::uuid[]) wanted(id) CROSS JOIN LATERAL (SELECT * FROM search_documents WHERE workspace_id=$1 AND generation=$2 AND object_id=wanted.id OFFSET 0) d JOIN objects o ON o.id=d.object_id AND o.current_revision=d.revision JOIN revisions r ON r.workspace_id=d.workspace_id AND r.object_id=d.object_id AND r.revision=d.revision
   LEFT JOIN revision_status st ON st.workspace_id=r.workspace_id AND st.object_id=r.object_id AND st.revision=r.revision
   LEFT JOIN revision_freshness f ON f.workspace_id=r.workspace_id AND f.object_id=r.object_id AND f.revision=r.revision
   WHERE d.object_id=ANY($10::uuid[]) AND d.workspace_id=$1 AND d.generation=$2 AND (($3<>'' AND d.document@@plainto_tsquery('simple',$3)) OR o.id=ANY($4::uuid[])) AND ($5::text IS NULL OR o.type=$5) AND ($6::text IS NULL OR (o.type='result' AND r.content->>'outcome'=$6))
  ) SELECT id,type,revision,content->>'title' title,left(COALESCE(content->>'body',''),240) excerpt,content->>'outcome' outcome,origin,author_id,score,lexical_match,graph_match,review_state,validity,freshness FROM hits WHERE $7::numeric IS NULL OR score<$7 OR (score=$7 AND id>$8::uuid) ORDER BY score DESC,id LIMIT 26`,
            [
              w,
              s.active_generation,
              q.channels === "graph" ? "" : q.q,
              neighbors,
              q.type ?? null,
              q.outcome ?? null,
              afterScore,
              afterId,
              ws.content_epoch,
              candidateIds,
            ],
          )
        ).rows;
        const items = rows.slice(0, 25);
        let next: string | null = null;
        if (rows.length > 25) {
          const last = items.at(-1)!;
          next = (
            await c.query(
              "INSERT INTO search_cursors(workspace_id,actor_id,policy_version,content_epoch,generation,query,last_score,last_id) VALUES($1,actor(),$2,$3,$4,$5,$6,$7) RETURNING id",
              [
                w,
                ws.version,
                ws.content_epoch,
                s.active_generation,
                query,
                last.score,
                last.id,
              ],
            )
          ).rows[0].id;
        }
        return {
          items,
          next_cursor: next,
          index_state:
            s.requested || s.active_epoch !== ws.content_epoch
              ? "updating"
              : "ready",
          graph_truncated: graphTruncated,
          retrieval_truncated: candidates.length > 1000,
          vector_channel: "disabled",
        };
      }),
  );
}
