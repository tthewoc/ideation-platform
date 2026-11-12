import type { PoolClient } from "pg";
import { z } from "zod";
import { fail, missing } from "./db.js";
import {
  content,
  references,
  ref,
  reason,
  type Ref,
  type Content,
} from "./schema.js";
export const edgeType = z.enum([
  "derived_from",
  "tests",
  "depends_on",
  "uses_method",
  "produces",
  "relevant_to",
  "part_of",
  "supersedes",
  "cites",
]);
export const edgeInput = z
  .object({
    type: edgeType,
    from: ref,
    to: ref,
    rationale: reason,
    condition: reason.nullable().default(null),
    valid_from: z.iso.datetime().nullable().default(null),
    valid_to: z.iso.datetime().nullable().default(null),
  })
  .strict()
  .refine(
    (v) => !v.valid_from || !v.valid_to || v.valid_to > v.valid_from,
    "Validity end must follow start",
  );
export async function state(c: PoolClient, w: string, r: Ref) {
  const q = await c.query(
    "SELECT * FROM revision_status WHERE workspace_id=$1 AND object_id=$2 AND revision=$3",
    [w, r.id, r.revision],
  );
  return (
    q.rows[0] ?? {
      review_state: "unreviewed",
      validity: "active",
      version: 1,
      last_reviewer: null,
    }
  );
}
export async function pinned(
  c: PoolClient,
  w: string,
  r: Ref,
  types?: string[],
  publishedOnly = true,
) {
  const q = await c.query(
    `SELECT r.*,o.type,o.author_id,o.current_revision,COALESCE(s.validity,'active') validity FROM revisions r JOIN objects o ON o.id=r.object_id LEFT JOIN revision_status s ON s.workspace_id=r.workspace_id AND s.object_id=r.object_id AND s.revision=r.revision WHERE r.workspace_id=$1 AND r.object_id=$2 AND r.revision=$3 ${publishedOnly ? "AND published(r.workspace_id,r.object_id,r.revision)" : ""}`,
    [w, r.id, r.revision],
  );
  const row = q.rows[0];
  if (!row)
    fail(422, "invalid_reference", "A referenced revision is unavailable");
  if (types && !types.includes(row.type))
    fail(
      422,
      "invalid_endpoint",
      "Reference type is not valid for this relationship",
    );
  return row;
}
export async function validateReferences(
  c: PoolClient,
  w: string,
  type: string,
  body: Content,
  publishing: boolean,
) {
  for (const r of references(body))
    await pinned(c, w, r, undefined, publishing);
  const b = body as any;
  if (b.method_ref) await pinned(c, w, b.method_ref, ["method"], publishing);
  if (type === "assessment") {
    await pinned(c, w, b.claim_ref, ["claim", "hypothesis"], publishing);
    await pinned(c, w, b.evidence_ref, ["evidence"], publishing);
  }
  if (type === "result")
    for (const r of b.artifact_refs) {
      const pin = await pinned(c, w, r, ["artifact"], publishing);
      const a = await c.query(
        "SELECT state FROM artifacts WHERE workspace_id=$1 AND object_id=$2",
        [w, r.id],
      );
      if (a.rows[0]?.state !== "available" || pin.validity !== "active")
        fail(
          422,
          "artifact_unavailable",
          "Referenced artifacts must be scanned and available",
        );
    }
}
export async function freshness(c: PoolClient, w: string, r: Ref) {
  const q = await c.query(
    "SELECT f.status,f.epoch=w.content_epoch valid FROM revision_freshness f JOIN workspaces w ON w.id=f.workspace_id WHERE f.workspace_id=$1 AND f.object_id=$2 AND f.revision=$3",
    [w, r.id, r.revision],
  );
  return q.rows[0]?.valid ? q.rows[0].status : "unknown";
}
export async function requireFreshInputs(
  c: PoolClient,
  w: string,
  body: Content,
) {
  for (const r of references(body)) {
    const p = await pinned(c, w, r);
    if (
      p.current_revision !== r.revision ||
      p.validity !== "active" ||
      (await freshness(c, w, r)) !== "current"
    )
      fail(
        409,
        "stale_inputs",
        "Review requires current, active and revalidated source revisions",
      );
  }
}
export async function cycleGuard(
  c: PoolClient,
  w: string,
  type: string,
  from: Ref,
  to: Ref,
) {
  if (!["depends_on", "derived_from", "supersedes"].includes(type)) return;
  await c.query("SELECT set_config('statement_timeout','2000',true)");
  const revisionAware = type === "derived_from";
  const a = revisionAware ? `${from.id}:${from.revision}` : from.id,
    b = revisionAware ? `${to.id}:${to.revision}` : to.id;
  if (a === b) fail(409, "cycle", "This relationship would create a cycle");
  const links = revisionAware
    ? `SELECT l.derived_id::text||':'||l.derived_revision a,l.input_id::text||':'||l.input_revision b FROM lineage l LEFT JOIN edges e ON e.id=l.edge_id LEFT JOIN edge_revisions er ON er.edge_id=e.id AND er.revision=e.current_revision WHERE l.workspace_id=$1 AND (l.edge_id IS NULL OR er.state='active')`
    : `SELECT er.from_id::text a,er.to_id::text b FROM edges e JOIN edge_revisions er ON er.edge_id=e.id AND er.revision=e.current_revision WHERE e.workspace_id=$1 AND er.type=$4 AND er.state='active'`;
  const values = revisionAware ? [w, b, a] : [w, b, a, type];
  const q = await c.query(
    `WITH RECURSIVE links AS (${links}), reach(node) AS (SELECT $2::text UNION SELECT l.b FROM links l JOIN reach r ON l.a=r.node) SELECT 1 FROM reach WHERE node=$3 LIMIT 1`,
    values,
  );
  if (q.rowCount) fail(409, "cycle", "This relationship would create a cycle");
}
export async function insertEdge(
  c: PoolClient,
  w: string,
  body: z.infer<typeof edgeInput> | any,
  assessment?: { id: string; revision: number },
) {
  const from = await pinned(c, w, body.from),
    to = await pinned(c, w, body.to);
  if (!assessment) {
    const endpoints: Record<string, [string[] | null, string[] | null]> = {
      depends_on: [["research_task"], ["research_task"]],
      tests: [["method", "research_task"], ["hypothesis"]],
      uses_method: [["research_task", "result"], ["method"]],
      produces: [["research_task"], ["result"]],
      part_of: [null, ["thesis"]],
      supersedes: [[from.type], [from.type]],
    };
    const types = endpoints[body.type];
    if (
      types &&
      ((types[0] && !types[0].includes(from.type)) ||
        (types[1] && !types[1].includes(to.type)))
    )
      fail(
        422,
        "invalid_endpoint",
        "Object types do not match this relationship",
      );
  }
  if (body.type === "depends_on") await mutableDependencies(c, w, body.from.id);
  await cycleGuard(c, w, body.type, body.from, body.to);
  let edge;
  if (assessment)
    edge = (
      await c.query(
        "SELECT * FROM edges WHERE workspace_id=$1 AND assessment_id=$2",
        [w, assessment.id],
      )
    ).rows[0];
  let revision = 1;
  if (edge) {
    revision = edge.current_revision + 1;
    await c.query("UPDATE edges SET current_revision=$2 WHERE id=$1", [
      edge.id,
      revision,
    ]);
  } else
    edge = (
      await c.query(
        "INSERT INTO edges(workspace_id,author_id,assessment_id) VALUES($1,actor(),$2) RETURNING *",
        [w, assessment?.id ?? null],
      )
    ).rows[0];
  await c.query(
    "INSERT INTO edge_revisions(workspace_id,edge_id,revision,type,from_id,from_revision,to_id,to_revision,assessment_revision,rationale,condition,valid_from,valid_to,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,actor())",
    [
      w,
      edge.id,
      revision,
      body.type,
      body.from.id,
      body.from.revision,
      body.to.id,
      body.to.revision,
      assessment?.revision ?? null,
      body.rationale,
      body.condition ?? null,
      body.valid_from ?? null,
      body.valid_to ?? null,
    ],
  );
  if (body.type === "derived_from")
    await c.query(
      "INSERT INTO lineage VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
      [
        w,
        body.from.id,
        body.from.revision,
        body.to.id,
        body.to.revision,
        edge.id,
      ],
    );
  return { ...edge, current_revision: revision, etag: `"${revision}"` };
}
export async function onPublication(
  c: PoolClient,
  w: string,
  id: string,
  revision: number,
  draftRevision: number,
  type: string,
  body: Content,
) {
  for (const r of references(body))
    await c.query(
      "INSERT INTO lineage(workspace_id,derived_id,derived_revision,input_id,input_revision) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [w, id, revision, r.id, r.revision],
    );
  const prior = await state(c, w, { id, revision: draftRevision });
  if (prior.review_state === "accepted") {
    await requireFreshInputs(c, w, body);
    await c.query(
      "INSERT INTO revision_status(workspace_id,object_id,revision,review_state,last_reviewer,review_source_revision) VALUES($1,$2,$3,'accepted',$4,$5)",
      [w, id, revision, prior.last_reviewer, draftRevision],
    );
  }
  if (type === "assessment") {
    const b = body as any;
    await insertEdge(
      c,
      w,
      {
        type: b.polarity,
        from: b.evidence_ref,
        to: b.claim_ref,
        rationale: b.rationale,
        condition: b.scope,
      },
      { id, revision },
    );
  }
  await c.query(
    "UPDATE submissions SET state='withdrawn',version=version+1 WHERE workspace_id=$1 AND object_id=$2 AND state='submitted'",
    [w, id],
  );
  await c.query("SELECT bump_content_epoch($1)", [w]);
}
export async function revisionData(c: PoolClient, w: string, r: Ref) {
  const q = await c.query(
    "SELECT * FROM revisions WHERE workspace_id=$1 AND object_id=$2 AND revision=$3",
    [w, r.id, r.revision],
  );
  return q.rows[0] ?? missing();
}

export async function mutableDependencies(
  c: PoolClient,
  w: string,
  id: string,
) {
  const t = (
    await c.query(
      "SELECT status FROM tasks WHERE workspace_id=$1 AND object_id=$2",
      [w, id],
    )
  ).rows[0];
  if (t && !["open", "assigned"].includes(t.status))
    fail(409, "dependencies_frozen", "Dependencies are fixed once work starts");
}
