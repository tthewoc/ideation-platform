import { config as dotenv } from "dotenv";
import pg from "pg";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import assert from "node:assert/strict";
dotenv({ path: ".local/dev.env", quiet: true });
const root = new pg.Client({
  connectionString: process.env.DATABASE_ADMIN_URL,
});
await root.connect();
const database = `ideator_graph_${randomUUID().replaceAll("-", "")}`;
await root.query(`CREATE DATABASE ${database}`);
for (const name of [
  "DATABASE_ADMIN_URL",
  "DATABASE_URL",
  "AUTH_DATABASE_URL",
  "WORKER_DATABASE_URL",
]) {
  const u = new URL(process.env[name]!);
  u.pathname = `/${database}`;
  process.env[name] = u.href;
}
let admin: pg.Client | undefined, app: any, db: any, authDb: any;
try {
  await import("./migrate.js");
  admin = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await admin.connect();
  const user = randomUUID(),
    workspace = randomUUID(),
    token = randomBytes(32).toString("hex"),
    csrf = randomUUID();
  await admin.query(
    "INSERT INTO users(id,issuer,subject,name) VALUES($1,$2,$3,$4)",
    [user, "load-test", user, "Load fixture"],
  );
  await admin.query(
    "INSERT INTO workspaces(id,name,created_by) VALUES($1,$2,$3)",
    [workspace, "Isolated dense graph", user],
  );
  await admin.query(
    "INSERT INTO memberships VALUES($1,$2,ARRAY['member'],NULL)",
    [workspace, user],
  );
  await admin.query(
    "INSERT INTO sessions VALUES($1,$2,$3,now()+interval '1 hour','[]',NULL)",
    [createHash("sha256").update(token).digest("hex"), user, csrf],
  );
  const start = Date.now();
  await admin.query("BEGIN");
  await admin.query(
    "CREATE TEMP TABLE load_nodes AS SELECT n,gen_random_uuid() id FROM generate_series(1,100000) n",
  );
  await admin.query("CREATE UNIQUE INDEX load_n ON load_nodes(n)");
  await admin.query(
    "INSERT INTO objects(id,workspace_id,type,author_id,next_revision) SELECT id,$1,'observation',$2,2 FROM load_nodes",
    [workspace, user],
  );
  await admin.query(
    "INSERT INTO revisions(workspace_id,object_id,revision,content,actor_id,reason) SELECT $1,id,1,jsonb_build_object('title','Load node '||n,'body','Synthetic density fixture','language','en','source_refs','[]'::jsonb,'context','Isolated load check','observed_at',NULL),$2,'Load fixture' FROM load_nodes",
    [workspace, user],
  );
  await admin.query(
    "INSERT INTO publications(workspace_id,object_id,revision,published_by) SELECT $1,id,1,$2 FROM load_nodes",
    [workspace, user],
  );
  await admin.query(
    "UPDATE objects SET current_revision=1 WHERE workspace_id=$1",
    [workspace],
  );
  await admin.query(
    "CREATE TEMP TABLE load_edges AS SELECT gen_random_uuid() id,CASE WHEN n<=10000 THEN 1 ELSE 2+((n-10001)%99999) END a,2+((n*17)%99999) b FROM generate_series(1,1000000) n",
  );
  await admin.query(
    "INSERT INTO edges(id,workspace_id,author_id) SELECT id,$1,$2 FROM load_edges",
    [workspace, user],
  );
  await admin.query(
    "INSERT INTO edge_revisions(workspace_id,edge_id,revision,type,from_id,from_revision,to_id,to_revision,rationale,actor_id) SELECT $1,e.id,1,'relevant_to',a.id,1,b.id,1,'Density fixture',$2 FROM load_edges e JOIN load_nodes a ON a.n=e.a JOIN load_nodes b ON b.n=e.b",
    [workspace, user],
  );
  await admin.query("COMMIT");
  await admin.query("ANALYZE");
  console.log(
    `Prepared 100,000 atoms and 1,000,000 edges in ${((Date.now() - start) / 1000).toFixed(1)}s.`,
  );
  const hub = (await admin.query("SELECT id FROM load_nodes WHERE n=1")).rows[0]
    .id;
  const loaded = await import("../src/server/db.js");
  db = loaded.db;
  authDb = loaded.authDb;
  app = await (await import("../src/server/app.js")).buildApp();
  await app.ready();
  const query = async (body: unknown) =>
    app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspace}/graph/query`,
      headers: {
        cookie: `session=${token}`,
        origin: process.env.APP_ORIGIN!,
        "x-csrf-token": csrf,
      },
      payload: body,
    });
  const began = Date.now(),
    first = await query({ root_ids: [hub], depth: 4 });
  assert.equal(first.statusCode, 200, first.body);
  const page = first.json();
  assert.ok(page.nodes.length <= 500 && page.edges.length <= 1000);
  assert.ok(page.next_cursor && page.truncated);
  console.log(
    `Depth-4 first page: ${page.nodes.length} nodes, ${page.edges.length} edges in ${Date.now() - began}ms.`,
  );
  const [second] = await Promise.all([
    query({ root_ids: [hub], depth: 4, cursor: page.next_cursor }),
    admin.query("REINDEX INDEX CONCURRENTLY edge_from"),
  ]);
  assert.equal(second.statusCode, 200, second.body);
  const next = second.json();
  assert.ok(next.nodes.length <= 500 && next.edges.length <= 1000);
  assert.equal(
    new Set([...page.edges, ...next.edges].map((e: any) => e.id)).size,
    page.edges.length + next.edges.length,
  );
  await admin.query("UPDATE workspaces SET version=version+1 WHERE id=$1", [
    workspace,
  ]);
  const stale = await query({
    root_ids: [hub],
    depth: 4,
    cursor: page.next_cursor,
  });
  assert.equal(stale.statusCode, 409);
  await admin.query(
    "UPDATE memberships SET revoked_at=now() WHERE workspace_id=$1 AND user_id=$2",
    [workspace, user],
  );
  const revoked = await query({ root_ids: [hub], depth: 4 });
  assert.equal(revoked.statusCode, 404);
  const count = await admin.query(
    "SELECT count(*)::integer n FROM objects WHERE workspace_id=$1",
    [workspace],
  );
  assert.equal(count.rows[0].n, 100000);
  console.log(
    "Dense graph checks passed: bounded pages, no duplicate edges, index rebuild during reads, stale permission cursor rejection, and revoked reader denial.",
  );
} finally {
  if (app) await app.close();
  if (db) await db.end();
  if (authDb) await authDb.end();
  if (admin) await admin.end();
  await root.query(`DROP DATABASE ${database} WITH (FORCE)`);
  await root.end();
}
