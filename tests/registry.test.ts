import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { buildApp } from "../src/server/app.js";
import { authDb, db, transaction } from "../src/server/db.js";
import { hash } from "../src/server/auth.js";
import { config } from "../src/server/config.js";
import { deliver } from "../src/server/worker.js";
const app = await buildApp();
await app.ready();
const admin = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
const worker = new pg.Pool({
  connectionString: process.env.WORKER_DATABASE_URL,
});
after(async () => {
  await app.close();
  await Promise.all([authDb.end(), db.end(), admin.end(), worker.end()]);
});
async function user(name: string) {
  const id = randomUUID(),
    token = randomBytes(32).toString("hex"),
    csrf = randomUUID();
  await authDb.query(
    "INSERT INTO users(id,issuer,subject,name) VALUES($1,$2,$3,$4)",
    [id, "test", id, name],
  );
  await authDb.query(
    "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [hash(token), id, csrf],
  );
  return { id, token, csrf };
}
const alice = await user("Alice"),
  bob = await user("Bob"),
  eve = await user("Eve");
async function request(
  u: typeof alice,
  method: string,
  url: string,
  body?: unknown,
  etag?: string,
  key = randomUUID(),
) {
  return app.inject({
    method: method as any,
    url,
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
const content = {
  title: "Thermal observation",
  body: "The plate cooled under forced air.",
  language: "en",
  source_refs: [],
  context: "Bench, synthetic measurement",
  observed_at: null,
};
let w: string, o: any, published: any;
test("authentication, strict schema and CSRF enforce request boundaries", async () => {
  assert.equal((await app.inject("/v1/session")).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/workspaces",
        headers: { cookie: `session=${alice.token}` },
        payload: { name: "Bad" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request(alice, "POST", "/v1/workspaces", {
        name: "Workspace",
        unexpected: true,
      })
    ).statusCode,
    422,
  );
});
test("workspace bootstrap and membership are transactional", async () => {
  const r = await request(alice, "POST", "/v1/workspaces", {
    name: "Test workspace",
  });
  assert.equal(r.statusCode, 201, r.body);
  w = r.json().id;
  const member = await request(
    alice,
    "POST",
    `/v1/workspaces/${w}/memberships`,
    { user_id: bob.id, roles: ["member"] },
    r.headers.etag as string,
  );
  assert.equal(member.statusCode, 200, member.body);
  const last = await request(
    alice,
    "DELETE",
    `/v1/workspaces/${w}/memberships/${alice.id}`,
    undefined,
    '"2"',
  );
  assert.equal(last.statusCode, 409, last.body);
});
test("private drafts are hidden by HTTP and the actual database runtime role", async () => {
  const r = await request(alice, "POST", `/v1/workspaces/${w}/objects`, {
    type: "observation",
    schema_version: 1,
    content,
  });
  assert.equal(r.statusCode, 201, r.body);
  o = r.json();
  assert.equal(
    (await request(bob, "GET", `/v1/workspaces/${w}/objects/${o.id}`))
      .statusCode,
    404,
  );
  assert.equal(
    (await request(eve, "GET", `/v1/workspaces/${w}/objects/${o.id}`))
      .statusCode,
    404,
  );
  const hidden = await transaction(bob.id, async (c) => ({
    objects: (await c.query("SELECT * FROM objects WHERE id=$1", [o.id])).rows,
    revisions: (
      await c.query("SELECT * FROM revisions WHERE object_id=$1", [o.id])
    ).rows,
    role: (await c.query("SELECT current_user")).rows[0].current_user,
  }));
  assert.equal(hidden.role, "ideator_app");
  assert.deepEqual(hidden.objects, []);
  assert.deepEqual(hidden.revisions, []);
});
test("concurrent draft edits reject stale ETags and keep both successful history entries", async () => {
  const url = `/v1/workspaces/${w}/objects/${o.id}/draft`;
  const results = await Promise.all([
    request(
      alice,
      "PATCH",
      url,
      { content: { ...content, title: "A" }, reason: "First revision" },
      o.etag,
    ),
    request(
      alice,
      "PATCH",
      url,
      { content: { ...content, title: "B" }, reason: "Second revision" },
      o.etag,
    ),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 412]);
  o = results.find((r) => r.statusCode === 200)!.json();
});
test("publication replay precedes ETag checks and audit/outbox commit exactly once", async () => {
  const key = randomUUID(),
    url = `/v1/workspaces/${w}/objects/${o.id}/publish`,
    body = { revision: o.revision, confirmation: true };
  const r = await request(alice, "POST", url, body, o.etag, key);
  assert.equal(r.statusCode, 200, r.body);
  published = r.json();
  const replay = await request(alice, "POST", url, body, o.etag, key);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(replay.json(), published);
  assert.equal(
    (await request(alice, "POST", url, { ...body, revision: 1 }, o.etag, key))
      .statusCode,
    409,
  );
  const events = await admin.query(
    "SELECT a.id FROM audit_events a JOIN outbox o ON o.event_id=a.id WHERE a.target_id=$1 AND a.action='object.published'",
    [o.id],
  );
  assert.equal(events.rowCount, 1);
  const history = await request(
    bob,
    "GET",
    `/v1/workspaces/${w}/objects/${o.id}/revisions`,
  );
  assert.equal(history.statusCode, 200, history.body);
  assert.equal(history.json().items.length, 1);
  assert.equal(history.json().items[0].revision, published.revision);
});
test("failed transaction rolls back revision, audit and outbox records", async () => {
  const before = (await admin.query("SELECT count(*)::int n FROM audit_events"))
    .rows[0].n;
  await assert.rejects(
    transaction(alice.id, async (c) => {
      const id = randomUUID();
      await c.query(
        "INSERT INTO audit_events(id,workspace_id,actor_id,action,request_id) VALUES($1,$2,actor(),'test.rollback','test')",
        [id, w],
      );
      await c.query(
        "INSERT INTO outbox(event_id,workspace_id,kind,payload) VALUES($1,$2,'test.rollback','{}')",
        [id, w],
      );
      throw new Error("simulated precommit failure");
    }),
  );
  assert.equal(
    (await admin.query("SELECT count(*)::int n FROM audit_events")).rows[0].n,
    before,
  );
  await assert.rejects(
    transaction(alice.id, (c) =>
      c.query("UPDATE revisions SET reason='rewritten' WHERE object_id=$1", [
        o.id,
      ]),
    ),
    /permission denied/,
  );
});
test("private correction preserves published projection for other members", async () => {
  const r = await request(
    alice,
    "POST",
    `/v1/workspaces/${w}/objects/${o.id}/corrections`,
    {
      base_revision: published.revision,
      content: { ...content, title: "Private correction" },
      reason: "Narrow context",
    },
    published.etag,
  );
  assert.equal(r.statusCode, 200, r.body);
  const read = await request(bob, "GET", `/v1/workspaces/${w}/objects/${o.id}`);
  assert.equal(read.json().revision, published.revision);
  assert.notEqual(read.json().content.title, "Private correction");
});
test("two projects reference one atom and deleting a project preserves atom and other reference", async () => {
  const create = () =>
    request(alice, "POST", `/v1/workspaces/${w}/projects`, {
      name: "Shared research",
    });
  const p1 = (await create()).json(),
    p2 = (await create()).json();
  for (const p of [p1, p2]) {
    const r = await request(
      alice,
      "POST",
      `/v1/workspaces/${w}/projects/${p.id}/objects`,
      { object_id: o.id },
      p.etag,
    );
    assert.equal(r.statusCode, 200, r.body);
  }
  const del = await request(
    alice,
    "DELETE",
    `/v1/workspaces/${w}/projects/${p1.id}`,
    undefined,
    '"2"',
  );
  assert.equal(del.statusCode, 200, del.body);
  assert.equal(
    (await request(bob, "GET", `/v1/workspaces/${w}/objects/${o.id}`))
      .statusCode,
    200,
  );
  const refs = await request(
    bob,
    "GET",
    `/v1/workspaces/${w}/projects/${p2.id}/objects`,
  );
  assert.equal(refs.json().items[0].id, o.id);
});
test("revocation immediately blocks history, listings and database reads", async () => {
  const r = await request(
    alice,
    "DELETE",
    `/v1/workspaces/${w}/memberships/${bob.id}`,
    undefined,
    '"2"',
  );
  assert.equal(r.statusCode, 200, r.body);
  for (const path of [
    "/objects",
    `/objects/${o.id}`,
    `/objects/${o.id}/revisions`,
    "/projects",
  ])
    assert.equal(
      (await request(bob, "GET", `/v1/workspaces/${w}${path}`)).statusCode,
      404,
    );
  assert.equal(
    (
      await transaction(bob.id, (c) =>
        c.query("SELECT * FROM revisions WHERE object_id=$1", [o.id]),
      )
    ).rowCount,
    0,
  );
});
test("outbox consumer is repeatable and uses its restricted worker role", async () => {
  await deliver(worker);
  await deliver(worker);
  assert.equal(
    (
      await worker.query(
        "SELECT event_id FROM event_receipts GROUP BY event_id HAVING count(*)>1",
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (await worker.query("SELECT * FROM outbox WHERE delivered_at IS NULL"))
      .rowCount,
    0,
  );
  await assert.rejects(
    worker.query("SELECT * FROM revisions"),
    /permission denied/,
  );
});
test("revoked workspace creator cannot bootstrap membership again through the runtime role", async () => {
  const founder = await user("Former founder"),
    other = await user("New administrator");
  const r = await request(founder, "POST", "/v1/workspaces", {
    name: "Ownership revocation",
  });
  assert.equal(r.statusCode, 201, r.body);
  const id = r.json().id;
  assert.equal(
    (
      await request(
        founder,
        "POST",
        `/v1/workspaces/${id}/memberships`,
        { user_id: other.id, roles: ["member", "admin"] },
        '"1"',
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await request(
        other,
        "DELETE",
        `/v1/workspaces/${id}/memberships/${founder.id}`,
        undefined,
        '"2"',
      )
    ).statusCode,
    200,
  );
  await transaction(founder.id, async (c) => {
    assert.equal(
      (await c.query("SELECT * FROM workspaces WHERE id=$1", [id])).rowCount,
      0,
    );
  });
  await assert.rejects(
    transaction(founder.id, (c) =>
      c.query(
        "INSERT INTO memberships VALUES($1,actor(),ARRAY['admin'],NULL) ON CONFLICT(workspace_id,user_id) DO UPDATE SET revoked_at=NULL",
        [id],
      ),
    ),
    /row-level security/,
  );
});
test("source audiences cannot expose a private source through publication", async () => {
  const u = await user("Source author");
  const ws = (
    await request(u, "POST", "/v1/workspaces", { name: "Reference policy" })
  ).json();
  const source = (
    await request(u, "POST", `/v1/workspaces/${ws.id}/objects`, {
      type: "observation",
      schema_version: 1,
      content,
    })
  ).json();
  const derived = await request(u, "POST", `/v1/workspaces/${ws.id}/objects`, {
    type: "observation",
    schema_version: 1,
    content: {
      ...content,
      source_refs: [{ id: source.id, revision: source.revision }],
    },
  });
  assert.equal(derived.statusCode, 201, derived.body);
  const o = derived.json();
  const publish = await request(
    u,
    "POST",
    `/v1/workspaces/${ws.id}/objects/${o.id}/publish`,
    { revision: o.revision, confirmation: true },
    o.etag,
  );
  assert.equal(publish.statusCode, 422, publish.body);
  assert.equal(
    (await admin.query("SELECT * FROM publications WHERE object_id=$1", [o.id]))
      .rowCount,
    0,
  );
  assert.equal(
    (await app.inject("/auth/callback?code=forged&state=forged")).statusCode,
    400,
  );
});
test("read traffic does not exhaust write quota and configured MFA rejects unverified role changes", async () => {
  const u = await user("Rate and assurance");
  for (let i = 0; i < 32; i++)
    assert.equal((await request(u, "GET", "/v1/session")).statusCode, 200);
  const r = await request(u, "POST", "/v1/workspaces", { name: "Assurance" });
  assert.equal(r.statusCode, 201, r.body);
  const previous = config.mfa;
  config.mfa = true;
  try {
    assert.equal(
      (
        await request(
          u,
          "POST",
          `/v1/workspaces/${r.json().id}/memberships`,
          { user_id: eve.id, roles: ["member"] },
          '"1"',
        )
      ).statusCode,
      403,
    );
  } finally {
    config.mfa = previous;
  }
});
