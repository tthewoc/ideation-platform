import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { buildApp } from "../src/server/app.js";
import { db, authDb, transaction } from "../src/server/db.js";
import { hash } from "../src/server/auth.js";
import { config } from "../src/server/config.js";
const app = await buildApp();
await app.ready();
const admin = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL }),
  worker = new pg.Pool({ connectionString: process.env.WORKER_DATABASE_URL });
after(async () => {
  await app.close();
  await Promise.all([admin.end(), worker.end(), db.end(), authDb.end()]);
});
type User = { id: string; token: string; csrf: string };
async function user(): Promise<User> {
  const id = randomUUID(),
    token = randomBytes(32).toString("hex"),
    csrf = randomUUID();
  await authDb.query(
    "INSERT INTO users(id,issuer,subject,name) VALUES($1,$2,$3,$2)",
    [id, "retrieval-test", id],
  );
  await authDb.query(
    "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [hash(token), id, csrf],
  );
  return { id, token, csrf };
}
const author = await user(),
  member = await user(),
  outsider = await user();
async function req(
  u: User,
  method: string,
  path: string,
  body?: unknown,
  etag?: string,
  key = randomUUID(),
) {
  return app.inject({
    method: method as any,
    url: path,
    payload: body as any,
    headers: {
      cookie: `session=${u.token}`,
      origin: config.origin,
      "x-csrf-token": u.csrf,
      "idempotency-key": key,
      ...(etag ? { "if-match": etag } : {}),
    },
  });
}
const common = {
  title: "Retrieval thermal sample",
  body: "Temperature replication protocol",
  language: "en",
  source_refs: [],
};
let w: string,
  base: string,
  observation: any,
  privateDraft: any,
  method: any,
  result: any,
  physical: any;
async function create(type: string, fields: any = {}) {
  const r = await req(author, "POST", `${base}/objects`, {
    type,
    schema_version: 1,
    content: { ...common, ...fields },
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
}
async function publish(o: any) {
  const r = await req(
    author,
    "POST",
    `${base}/objects/${o.id}/publish`,
    { revision: o.revision, confirmation: true },
    o.etag,
  );
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
async function rebuild() {
  for (let i = 0; i < 10; i++) {
    await worker.query("SELECT rebuild_search_batch($1)", [w]);
    const s = (
      await admin.query(
        "SELECT requested FROM search_state WHERE workspace_id=$1",
        [w],
      )
    ).rows[0];
    if (!s.requested) return;
  }
  throw new Error("Rebuild did not finish");
}
async function exportJob(ids: string[], u = member) {
  const r = await req(u, "POST", `${base}/exports`, {
    object_ids: ids,
    format: "json-v1",
  });
  assert.equal(r.statusCode, 202, r.body);
  const job = r.json();
  await worker.query("SELECT prepare_export($1)", [job.id]);
  return job;
}
test("lexical retrieval indexes publications only and labels null outcomes without bias", async () => {
  const ws = await req(author, "POST", "/v1/workspaces", {
    name: "Retrieval fixture",
  });
  assert.equal(ws.statusCode, 201, ws.body);
  w = ws.json().id;
  base = `/v1/workspaces/${w}`;
  await admin.query(
    "INSERT INTO memberships VALUES($1,$2,ARRAY['member'],NULL)",
    [w, member.id],
  );
  observation = await publish(
    await create("observation", {
      title: "Thermal measurement",
      context: "Synthetic corpus",
      observed_at: null,
    }),
  );
  privateDraft = await create("claim", {
    title: "Private canary obsidian",
    proposition: "Obsidian private finding",
    scope: "Private",
    qualifiers: [],
  });
  method = await publish(
    await create("method", {
      title: "Thermal protocol",
      ordered_steps: ["Measure"],
      metrics: ["Temperature"],
      constraints: [],
      ethical_constraints: [],
    }),
  );
  result = await publish(
    await create("result", {
      title: "Thermal null replication",
      method_ref: { id: method.id, revision: method.revision },
      outcome: "null",
      measurement_context: "No measurable difference",
      artifact_refs: [],
    }),
  );
  const pending = await req(member, "GET", `${base}/search?q=thermal`);
  assert.equal(pending.statusCode, 200, pending.body);
  assert.equal(pending.json().index_state, "pending");
  await rebuild();
  const hits = await req(member, "GET", `${base}/search?q=thermal`);
  assert.equal(hits.statusCode, 200, hits.body);
  assert.equal(hits.json().items.length, 3);
  assert.equal(hits.json().index_state, "ready");
  assert.ok(hits.json().items.every((x: any) => x.lexical_match));
  const nulls = await req(
    member,
    "GET",
    `${base}/search?q=thermal&outcome=null`,
  );
  assert.deepEqual(
    nulls.json().items.map((x: any) => x.id),
    [result.id],
  );
  assert.equal(
    (await req(author, "GET", `${base}/search?q=obsidian`)).json().items.length,
    0,
  );
  assert.equal(
    (await req(outsider, "GET", `${base}/search?q=thermal`)).statusCode,
    404,
  );
  assert.equal(
    (await req(member, "GET", `${base}/search?q=thermal&channels=vector`))
      .statusCode,
    422,
  );
});
test("graph-assisted retrieval retains direction as evidence and does not infer equivalence", async () => {
  const e = await req(author, "POST", `${base}/edges`, {
    type: "relevant_to",
    from: { id: observation.id, revision: observation.revision },
    to: { id: result.id, revision: result.revision },
    rationale: "Related replication",
  });
  assert.equal(e.statusCode, 201, e.body);
  await rebuild();
  const r = await req(
    member,
    "GET",
    `${base}/search?channels=graph&root_id=${observation.id}`,
  );
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(
    r.json().items.map((x: any) => x.id),
    [result.id],
  );
  assert.equal(r.json().items[0].graph_match, true);
  const denied = await req(
    member,
    "GET",
    `${base}/search?channels=graph&root_id=${privateDraft.id}`,
  );
  assert.equal(denied.statusCode, 404);
  const missing = await req(
    member,
    "GET",
    `${base}/search?channels=graph&root_id=${randomUUID()}`,
  );
  assert.equal(missing.statusCode, 404);
});
test("corrections suppress stale indexed text immediately and rebuilding preserves current identity", async () => {
  const draft = await req(
    author,
    "POST",
    `${base}/objects/${observation.id}/corrections`,
    {
      base_revision: observation.revision,
      content: {
        ...observation.content,
        title: "Revised zephyr observation",
        body: "Changed corpus context",
      },
      reason: "Correction",
    },
    observation.etag,
  );
  assert.equal(draft.statusCode, 200, draft.body);
  observation = await publish(draft.json());
  const old = await req(member, "GET", `${base}/search?q=thermal`);
  assert.equal(old.statusCode, 200, old.body);
  assert.ok(old.json().items.every((x: any) => x.id !== observation.id));
  assert.equal(old.json().index_state, "updating");
  await rebuild();
  const fresh = await req(member, "GET", `${base}/search?q=zephyr`);
  assert.equal(fresh.json().items[0].id, observation.id);
  const before = (await req(member, "GET", `${base}/search?q=thermal`)).json()
    .items;
  const queued = await req(author, "POST", `${base}/search/rebuild`, {});
  assert.equal(queued.statusCode, 202, queued.body);
  const during = (await req(member, "GET", `${base}/search?q=thermal`)).json();
  assert.deepEqual(during.items, before);
  await rebuild();
  assert.deepEqual(
    (await req(member, "GET", `${base}/search?q=thermal`)).json().items,
    before,
  );
});
test("opaque pagination binds the actor, exact query, generation and current permissions", async () => {
  // Larger fixture uses authoritative inserts to avoid consuming command-rate quotas.
  await admin.query(
    `WITH nodes AS (INSERT INTO objects(workspace_id,type,author_id,next_revision) SELECT $1,'observation',$2,2 FROM generate_series(1,30) RETURNING id), revs AS (INSERT INTO revisions(workspace_id,object_id,revision,content,actor_id,reason) SELECT $1,id,1,'{"title":"Pagination sapphire","body":"Corpus","language":"en","source_refs":[],"context":"Synthetic","observed_at":null}'::jsonb,$2,'Fixture' FROM nodes RETURNING object_id) INSERT INTO publications(workspace_id,object_id,revision,published_by) SELECT $1,object_id,1,$2 FROM revs`,
    [w, author.id],
  );
  await admin.query(
    "UPDATE objects SET current_revision=1 WHERE workspace_id=$1 AND current_revision IS NULL AND next_revision=2 AND id<>$2",
    [w, privateDraft.id],
  );
  await admin.query(
    "UPDATE search_state SET requested=true WHERE workspace_id=$1",
    [w],
  );
  await rebuild();
  const first = (await req(member, "GET", `${base}/search?q=sapphire`)).json();
  assert.equal(first.items.length, 25);
  assert.ok(first.next_cursor);
  const next = (
    await req(
      member,
      "GET",
      `${base}/search?q=sapphire&cursor=${first.next_cursor}`,
    )
  ).json();
  assert.equal(next.items.length, 5);
  assert.equal(
    new Set([...first.items, ...next.items].map((x) => x.id)).size,
    30,
  );
  assert.equal(
    (
      await req(
        author,
        "GET",
        `${base}/search?q=sapphire&cursor=${first.next_cursor}`,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await req(
        member,
        "GET",
        `${base}/search?q=sapphire&type=observation&cursor=${first.next_cursor}`,
      )
    ).statusCode,
    409,
  );
  await admin.query("UPDATE workspaces SET version=version+1 WHERE id=$1", [w]);
  assert.equal(
    (
      await req(
        member,
        "GET",
        `${base}/search?q=sapphire&cursor=${first.next_cursor}`,
      )
    ).statusCode,
    409,
  );
});
test("portable JSON preserves pinned provenance, licenses and identity while omitting disallowed artifacts", async () => {
  const registration = await req(author, "POST", `${base}/artifacts`, {
    ...common,
    title: "Licensed physical sample",
    kind: "physical",
    license: "Inspection only; no redistribution without permission",
    custodian: "Lab",
    location: "Cabinet",
    access_protocol: "Supervised inspection",
    integrity_metadata: "Seal A",
  });
  assert.equal(registration.statusCode, 201, registration.body);
  physical = await publish(registration.json().object);
  const derived = await publish(
    await create("result", {
      title: "Licensed interpretation",
      method_ref: { id: method.id, revision: method.revision },
      outcome: "null",
      measurement_context: "Sealed sample measurement",
      artifact_refs: [{ id: physical.id, revision: physical.revision }],
    }),
  );
  let job = await exportJob([derived.id, observation.id]);
  let download = await req(member, "GET", `${base}/exports/${job.id}/download`);
  assert.equal(download.statusCode, 200, download.body);
  assert.ok(!download.body.includes(physical.id));
  assert.ok(!download.body.includes(derived.id));
  assert.ok(!download.body.includes("Seal A"));
  assert.equal(download.json().warnings.length, 1);
  assert.equal(download.json().objects[0].id, observation.id);
  const policy = await req(
    author,
    "POST",
    `${base}/objects/${physical.id}/export-policy`,
    {
      revision: physical.revision,
      allowed: true,
      reason: "Custodian permits metadata export under the recorded license",
    },
    '"0"',
  );
  assert.equal(policy.statusCode, 200, policy.body);
  assert.equal(
    (await req(member, "GET", `${base}/exports/${job.id}/download`)).statusCode,
    409,
  );
  job = await exportJob([derived.id]);
  download = await req(member, "GET", `${base}/exports/${job.id}/download`);
  assert.equal(download.statusCode, 200, download.body);
  const body = download.json();
  assert.equal(body.format, "ideator-json-v1");
  assert.equal(body.objects.length, 3);
  assert.ok(body.lineage.some((l: any) => l.input_id === physical.id));
  assert.equal(
    body.objects.find((o: any) => o.id === physical.id).content.license,
    physical.content.license,
  );
  assert.equal(body.artifact_bytes_included, false);
  assert.match(download.headers["content-disposition"] as string, /attachment/);
  const policyDeny = await req(
    author,
    "POST",
    `${base}/objects/${physical.id}/export-policy`,
    {
      revision: physical.revision,
      allowed: false,
      reason: "Redistribution permission withdrawn",
    },
    policy.json().etag,
  );
  assert.equal(policyDeny.statusCode, 200, policyDeny.body);
  assert.equal(
    (await req(member, "GET", `${base}/exports/${job.id}/download`)).statusCode,
    409,
  );
  assert.equal(
    (await req(outsider, "GET", `${base}/exports/${job.id}`)).statusCode,
    404,
  );
  assert.equal(
    (await req(author, "GET", `${base}/exports/${job.id}`)).statusCode,
    404,
  );
});
test("revocation between request, preparation and download closes every new retrieval surface", async () => {
  const u = await user();
  await admin.query(
    "INSERT INTO memberships VALUES($1,$2,ARRAY['member'],NULL)",
    [w, u.id],
  );
  const requested = await req(u, "POST", `${base}/exports`, {
    object_ids: [observation.id],
    format: "json-v1",
  });
  assert.equal(requested.statusCode, 202, requested.body);
  await admin.query(
    "UPDATE memberships SET revoked_at=now() WHERE workspace_id=$1 AND user_id=$2",
    [w, u.id],
  );
  await worker.query("SELECT prepare_export($1)", [requested.json().id]);
  assert.equal(
    (
      await admin.query("SELECT state FROM export_jobs WHERE id=$1", [
        requested.json().id,
      ])
    ).rows[0].state,
    "denied",
  );
  for (const path of [
    "/search?q=thermal",
    "/search/status",
    "/exports",
    `/exports/${requested.json().id}/download`,
  ])
    assert.equal((await req(u, "GET", base + path)).statusCode, 404);
  await transaction(u.id, async (c) => {
    for (const table of [
      "search_documents",
      "search_state",
      "search_cursors",
      "export_jobs",
      "export_policies",
      "revision_embeddings",
    ])
      assert.equal(
        (await c.query(`SELECT * FROM ${table} WHERE workspace_id=$1`, [w]))
          .rowCount,
        0,
      );
  });
  const job = await exportJob([observation.id]);
  await admin.query(
    "UPDATE memberships SET revoked_at=now() WHERE workspace_id=$1 AND user_id=$2",
    [w, member.id],
  );
  assert.equal(
    (await req(member, "GET", `${base}/exports/${job.id}/download`)).statusCode,
    404,
  );
  await admin.query(
    "UPDATE memberships SET revoked_at=NULL WHERE workspace_id=$1 AND user_id=$2",
    [w, member.id],
  );
});
test("artifact restriction suppresses indexed metadata and inherited content without waiting for a rebuild", async () => {
  await rebuild();
  const before = (await req(member, "GET", `${base}/search?q=Licensed`)).json();
  assert.equal(before.items.length, 2);
  const a = (
    await req(author, "GET", `${base}/artifacts/${physical.id}`)
  ).json();
  const blocked = await req(
    author,
    "POST",
    `${base}/artifacts/${physical.id}/transitions`,
    { state: "restricted", reason: "Custody access suspended" },
    a.etag,
  );
  assert.equal(blocked.statusCode, 200, blocked.body);
  const after = await req(member, "GET", `${base}/search?q=Licensed`);
  assert.equal(after.statusCode, 200, after.body);
  assert.equal(after.json().items.length, 0);
});
test("versioned embedding foundation rejects disabled models, stale fingerprints and malformed vectors", async () => {
  const version = `fixture-${randomUUID()}`;
  await admin.query("INSERT INTO embedding_models VALUES($1,3,false)", [
    version,
  ]);
  const fingerprint = (
    await admin.query(
      "SELECT encode(sha256(convert_to(content::text,'UTF8')),'hex') digest FROM revisions WHERE object_id=$1 AND revision=$2",
      [observation.id, observation.revision],
    )
  ).rows[0].digest;
  await assert.rejects(
    worker.query("SELECT record_embedding($1,$2,$3,$4,$5,$6)", [
      w,
      observation.id,
      observation.revision,
      version,
      [1, 0, 0],
      fingerprint,
    ]),
  );
  await admin.query(
    "UPDATE embedding_models SET enabled=true WHERE version=$1",
    [version],
  );
  for (const [vec, hash] of [
    [[1, 0], fingerprint],
    [[1, 0, 0], "incorrect"],
    [[NaN, 0, 1], fingerprint],
  ])
    await assert.rejects(
      worker.query("SELECT record_embedding($1,$2,$3,$4,$5,$6)", [
        w,
        observation.id,
        observation.revision,
        version,
        vec,
        hash,
      ]),
    );
  await worker.query("SELECT record_embedding($1,$2,$3,$4,$5,$6)", [
    w,
    observation.id,
    observation.revision,
    version,
    [1, 0, 0],
    fingerprint,
  ]);
  assert.equal(
    (
      await transaction(member.id, (c) =>
        c.query("SELECT * FROM revision_embeddings WHERE workspace_id=$1", [w]),
      )
    ).rowCount,
    1,
  );
  assert.equal(
    (
      await transaction(outsider.id, (c) =>
        c.query("SELECT * FROM revision_embeddings WHERE workspace_id=$1", [w]),
      )
    ).rowCount,
    0,
  );
  await assert.rejects(
    transaction(author.id, (c) =>
      c.query("SELECT record_embedding($1,$2,$3,$4,$5,$6)", [
        w,
        observation.id,
        observation.revision,
        version,
        [1, 0, 0],
        fingerprint,
      ]),
    ),
    /permission denied/,
  );
  await admin.query(
    "UPDATE embedding_models SET enabled=false WHERE version=$1",
    [version],
  );
});
