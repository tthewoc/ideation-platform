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
const admin = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
after(async () => {
  await app.close();
  await Promise.all([admin.end(), db.end(), authDb.end()]);
});
type User = { id: string; token: string; csrf: string };
async function user(): Promise<User> {
  const id = randomUUID(),
    token = randomBytes(32).toString("hex"),
    csrf = randomUUID();
  await authDb.query(
    "INSERT INTO users(id,issuer,subject,name) VALUES($1,'intake-test',$2,$2)",
    [id, id],
  );
  await authDb.query(
    "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [hash(token), id, csrf],
  );
  return { id, token, csrf };
}
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
async function setup() {
  const owner = await user(),
    peer = await user();
  const r = await req(owner, "POST", "/v1/workspaces", {
    name: "Private intake test",
  });
  assert.equal(r.statusCode, 201, r.body);
  const w = r.json().id,
    base = `/v1/workspaces/${w}`;
  await admin.query(
    "INSERT INTO memberships VALUES($1,$2,ARRAY['member','reviewer'],NULL)",
    [w, peer.id],
  );
  const s = await req(owner, "POST", `${base}/sessions`, {
    title: "Unfinished question",
  });
  assert.equal(s.statusCode, 201, s.body);
  return { owner, peer, w, base, s: s.json() };
}
async function note(
  x: Awaited<ReturnType<typeof setup>>,
  s: any,
  text: string,
  attachments: any[] = [],
) {
  const r = await req(
    x.owner,
    "POST",
    `${x.base}/sessions/${s.id}/turns`,
    { text, attachment_refs: attachments, parent_turn: s.active_turn },
    s.etag,
  );
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
}
async function read(x: Awaited<ReturnType<typeof setup>>, s: any = x.s) {
  const r = await req(x.owner, "GET", `${x.base}/sessions/${s.id}`);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
test("fragmentary notes retain exact original text and stay private even from workspace reviewers", async () => {
  const x = await setup(),
    text = "  Fragment only…\n¿Could this work? 未完成  ";
  const n = await note(x, x.s, text);
  const saved = await read(x);
  assert.equal(saved.turns[0].original_text, text);
  assert.equal(saved.turns[0].speaker, "human");
  assert.equal(saved.active_turn, n.turn_id);
  assert.equal(
    (await req(x.peer, "GET", `${x.base}/sessions`)).json().items.length,
    0,
  );
  assert.equal(
    (await req(x.peer, "GET", `${x.base}/sessions/${x.s.id}`)).statusCode,
    404,
  );
  await transaction(x.peer.id, async (c) => {
    for (const t of ["intake_sessions", "intake_turns", "intake_undo_events"])
      assert.equal(
        (await c.query(`SELECT * FROM ${t} WHERE workspace_id=$1`, [x.w]))
          .rowCount,
        0,
      );
  });
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM objects WHERE workspace_id=$1",
        [x.w],
      )
    ).rows[0].n,
    0,
  );
  for (const sql of [
    "DELETE FROM intake_turns WHERE session_id=$1",
    "UPDATE intake_turns SET original_text='rewritten' WHERE session_id=$1",
  ])
    await assert.rejects(
      transaction(x.owner.id, (c) => c.query(sql, [x.s.id])),
      { code: "42501" },
    );
  const invalid = { text: "", attachment_refs: [], parent_turn: n.active_turn };
  assert.equal(
    (
      await req(
        x.owner,
        "POST",
        `${x.base}/sessions/${x.s.id}/turns`,
        invalid,
        n.etag,
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await req(
        x.owner,
        "POST",
        `${x.base}/sessions/${x.s.id}/turns`,
        { ...invalid, text: "Machine spoof", speaker: "ai" },
        n.etag,
      )
    ).statusCode,
    422,
  );
});
test("concurrent turns, undo branching and retry preserve every prior turn and exactly-once audit", async () => {
  const x = await setup(),
    first = await note(x, x.s, "Initial possibility");
  const attempts = await Promise.all(
    ["A", "B"].map((text) =>
      req(
        x.owner,
        "POST",
        `${x.base}/sessions/${x.s.id}/turns`,
        { text, attachment_refs: [], parent_turn: first.active_turn },
        first.etag,
      ),
    ),
  );
  assert.deepEqual(attempts.map((r) => r.statusCode).sort(), [201, 412]);
  const before = await read(x);
  assert.equal(before.turns.length, 2);
  const key = randomUUID(),
    body = {
      target_turn: first.turn_id,
      reason: "Return to the earlier possibility",
    };
  const undo = await req(
    x.owner,
    "POST",
    `${x.base}/sessions/${x.s.id}/undo`,
    body,
    before.etag,
    key,
  );
  assert.equal(undo.statusCode, 200, undo.body);
  assert.deepEqual(
    (
      await req(
        x.owner,
        "POST",
        `${x.base}/sessions/${x.s.id}/undo`,
        body,
        before.etag,
        key,
      )
    ).json(),
    undo.json(),
  );
  assert.equal(
    (
      await req(
        x.owner,
        "POST",
        `${x.base}/sessions/${x.s.id}/undo`,
        { ...body, reason: "different" },
        before.etag,
        key,
      )
    ).statusCode,
    409,
  );
  const branch = await note(x, undo.json(), "A different continuation"),
    saved = await read(x);
  assert.deepEqual(saved.turns.slice(0, 2), before.turns);
  assert.equal(saved.turns[2].parent_turn, first.turn_id);
  assert.equal(saved.undo_events.length, 1);
  assert.equal(saved.active_turn, branch.turn_id);
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM audit_events WHERE target_id=$1 AND action='session.undo_recorded'",
        [x.s.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM audit_events a LEFT JOIN outbox o ON o.event_id=a.id WHERE a.target_id=$1 AND o.event_id IS NULL",
        [x.s.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await req(
        x.owner,
        "POST",
        `${x.base}/sessions/${x.s.id}/turns`,
        {
          text: "Wrong parent",
          attachment_refs: [],
          parent_turn: first.turn_id,
        },
        branch.etag,
      )
    ).statusCode,
    409,
  );
  const another = await req(x.owner, "POST", `${x.base}/sessions`, {
    title: "Another notebook",
  });
  const otherTurn = await note(x, another.json(), "Separate history");
  assert.equal(
    (
      await req(
        x.owner,
        "POST",
        `${x.base}/sessions/${x.s.id}/undo`,
        { target_turn: otherTurn.turn_id, reason: "Cross-session pointer" },
        branch.etag,
      )
    ).statusCode,
    422,
  );
  await assert.rejects(
    transaction(x.owner.id, (c) =>
      c.query("SELECT undo_intake_session($1,$2,$3,$4,$5,$6)", [
        x.w,
        x.s.id,
        null,
        first.turn_id,
        "Missing version",
        "intake-test",
      ]),
    ),
    { code: "40001" },
  );
});
test("only permitted clean digital attachments can be pinned; restriction closes all session history", async () => {
  const x = await setup();
  const register = async (u: User) => {
    const r = await req(u, "POST", `${x.base}/artifacts`, {
      title: "Synthetic attachment permission fixture",
      body: "Metadata-only test",
      language: "en",
      source_refs: [],
      kind: "digital",
      filename: "note.txt",
      media_type: "text/plain",
      byte_size: 1,
      sha256: "a".repeat(64),
      license: "CC0-1.0",
    });
    assert.equal(r.statusCode, 201, r.body);
    return r.json().object;
  };
  const own = await register(x.owner),
    hidden = await register(x.peer);
  const append = (refs: any[]) =>
    req(
      x.owner,
      "POST",
      `${x.base}/sessions/${x.s.id}/turns`,
      { text: "", attachment_refs: refs, parent_turn: null },
      x.s.etag,
    );
  assert.equal((await append([{ id: own.id, revision: 1 }])).statusCode, 422);
  // Trusted setup only: real scan integration is exercised by research.test.ts.
  await admin.query(
    "UPDATE artifacts SET state='available',scan_verdict='clean' WHERE object_id=ANY($1::uuid[])",
    [[own.id, hidden.id]],
  );
  assert.equal(
    (await append([{ id: hidden.id, revision: 1 }])).statusCode,
    422,
  );
  assert.equal((await append([{ id: own.id, revision: 999 }])).statusCode, 422);
  const n = await append([{ id: own.id, revision: 1 }]);
  assert.equal(n.statusCode, 201, n.body);
  assert.deepEqual((await read(x)).turns[0].attachment_refs, [
    { id: own.id, revision: 1 },
  ]);
  const outlined = await req(
    x.owner,
    "POST",
    `${x.base}/sessions/${x.s.id}/outline`,
    {
      items: [outlineItem(n.json().turn_id)],
      reason: "Interpret attached source",
    },
    n.json().etag,
  );
  assert.equal(outlined.statusCode, 201, outlined.body);
  const state = (
    await req(x.owner, "GET", `${x.base}/artifacts/${own.id}`)
  ).json();
  const restricted = await req(
    x.owner,
    "POST",
    `${x.base}/artifacts/${own.id}/transitions`,
    { state: "restricted", reason: "Remove availability" },
    state.etag,
  );
  assert.equal(restricted.statusCode, 200, restricted.body);
  assert.equal(
    (await req(x.owner, "GET", `${x.base}/sessions/${x.s.id}`)).statusCode,
    404,
  );
  assert.equal(
    (await req(x.owner, "GET", `${x.base}/sessions`)).json().items.length,
    0,
  );
  await transaction(x.owner.id, async (c) => {
    assert.equal(
      (
        await c.query("SELECT * FROM intake_turns WHERE session_id=$1", [
          x.s.id,
        ])
      ).rowCount,
      0,
    );
  });
  await assert.rejects(
    transaction(x.owner.id, (c) =>
      c.query("SELECT append_intake_turn($1,$2,$3,$4,$5,$6,$7)", [
        x.w,
        x.s.id,
        2,
        n.json().turn_id,
        "After restriction",
        "[]",
        "intake-test",
      ]),
    ),
    { code: "42501" },
  );
  assert.equal(
    (await req(x.owner, "GET", `${x.base}/sessions/${x.s.id}/outline`))
      .statusCode,
    404,
  );
  await transaction(x.owner.id, async (c) => {
    assert.equal(
      (
        await c.query(
          "SELECT * FROM intake_outline_sources WHERE session_id=$1",
          [x.s.id],
        )
      ).rowCount,
      0,
    );
  });
  // A restricted session still consumes its owner's daily creation allowance.
  await transaction(x.owner.id, async (c) => {
    for (let i = 0; i < 49; i++)
      await c.query("SELECT create_intake_session($1,$2,$3)", [
        x.w,
        `Capacity fixture ${i}`,
        "intake-test",
      ]);
  });
  const quota = await req(x.owner, "POST", `${x.base}/sessions`, {
    title: "Over allowance",
  });
  assert.equal(quota.statusCode, 429, quota.body);
  const page1 = (await req(x.owner, "GET", `${x.base}/sessions`)).json();
  assert.equal(page1.items.length, 25);
  const page2 = (
    await req(x.owner, "GET", `${x.base}/sessions?after=${page1.next}`)
  ).json();
  assert.equal(page2.items.length, 24);
  assert.equal(
    new Set([...page1.items, ...page2.items].map((s: any) => s.id)).size,
    49,
  );
});
test("membership revocation closes every intake surface without deleting original records", async () => {
  const x = await setup();
  const n = await note(x, x.s, "Saved before revocation");
  await admin.query(
    "UPDATE memberships SET revoked_at=now() WHERE workspace_id=$1 AND user_id=$2",
    [x.w, x.owner.id],
  );
  for (const path of ["/sessions", `/sessions/${x.s.id}`])
    assert.equal((await req(x.owner, "GET", x.base + path)).statusCode, 404);
  assert.equal(
    (
      await req(
        x.owner,
        "POST",
        `${x.base}/sessions/${x.s.id}/undo`,
        { target_turn: null, reason: "Revoked" },
        n.etag,
      )
    ).statusCode,
    404,
  );
  await transaction(x.owner.id, async (c) => {
    assert.equal(
      (await c.query("SELECT * FROM intake_sessions WHERE id=$1", [x.s.id]))
        .rowCount,
      0,
    );
  });
  assert.equal(
    (
      await admin.query("SELECT original_text FROM intake_turns WHERE id=$1", [
        n.turn_id,
      ])
    ).rows[0].original_text,
    "Saved before revocation",
  );
});
test("bounded session history rejects over-limit writes atomically", async () => {
  const x = await setup();
  await admin.query(
    "UPDATE intake_sessions SET next_sequence=201 WHERE id=$1",
    [x.s.id],
  );
  const r = await req(
    x.owner,
    "POST",
    `${x.base}/sessions/${x.s.id}/turns`,
    { text: "Overflow", attachment_refs: [], parent_turn: null },
    x.s.etag,
  );
  assert.equal(r.statusCode, 429, r.body);
  await assert.rejects(
    transaction(x.owner.id, (c) =>
      c.query("SELECT append_intake_turn($1,$2,$3,$4,$5,$6,$7)", [
        x.w,
        x.s.id,
        1,
        null,
        "Overflow",
        "[]",
        "intake-test",
      ]),
    ),
    { code: "23514" },
  );
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM intake_turns WHERE session_id=$1",
        [x.s.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM audit_events WHERE target_id=$1 AND action='turn.recorded'",
        [x.s.id],
      )
    ).rows[0].n,
    0,
  );
});

function outlineItem(turn: string, extra: any = {}) {
  return {
    id: randomUUID(),
    kind: "claim",
    text: "A possible explanation",
    basis: "human_conjecture",
    source_turn_ids: [turn],
    rationale: "Tentative human interpretation",
    steps: [],
    ...extra,
  };
}
async function outlineRead(
  x: Awaited<ReturnType<typeof setup>>,
  revision?: number,
) {
  const r = await req(
    x.owner,
    "GET",
    `${x.base}/sessions/${x.s.id}/outline${revision ? `?revision=${revision}` : ""}`,
  );
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
test("private outlines pin exact turns, preserve revised interpretations and never publish notebook text", async () => {
  const x = await setup(),
    n = await note(x, x.s, "A source statement in the original notebook");
  const item = outlineItem(n.turn_id, {
      text: "A source statement",
      basis: "quoted",
    }),
    body = { items: [item], reason: "First manual outline" },
    key = randomUUID();
  const path = `${x.base}/sessions/${x.s.id}/outline`;
  const saved = await req(x.owner, "POST", path, body, n.etag, key);
  assert.equal(saved.statusCode, 201, saved.body);
  assert.deepEqual(
    (await req(x.owner, "POST", path, body, n.etag, key)).json(),
    saved.json(),
  );
  assert.equal(
    (
      await req(
        x.owner,
        "POST",
        path,
        { ...body, reason: "Changed replay" },
        n.etag,
        key,
      )
    ).statusCode,
    409,
  );
  const first = await outlineRead(x);
  assert.equal(first.origin, "human");
  assert.deepEqual(first.sources, [{ item_id: item.id, turn_id: n.turn_id }]);
  assert.equal(first.outside_active_branch, false);
  assert.ok(first.missing_categories.includes("method"));
  const changed = {
    ...item,
    text: "A human alternative interpretation",
    basis: "human_conjecture",
  };
  const revision2 = await req(
    x.owner,
    "POST",
    path,
    { items: [changed], reason: "Distinguish interpretation from quote" },
    saved.json().etag,
  );
  assert.equal(revision2.statusCode, 201, revision2.body);
  const old = await outlineRead(x, 1);
  assert.deepEqual(old.items, first.items);
  assert.deepEqual(old.sources, first.sources);
  assert.equal(old.latest_revision, 2);
  const removed = await req(
    x.owner,
    "POST",
    path,
    { items: [], reason: "Remove from the current outline; retain history" },
    revision2.json().etag,
  );
  assert.equal(removed.statusCode, 201, removed.body);
  assert.equal((await outlineRead(x)).missing_categories.length, 8);
  assert.equal((await outlineRead(x, 2)).items[0].text, changed.text);
  assert.equal((await req(x.peer, "GET", path)).statusCode, 404);
  await transaction(x.peer.id, async (c) => {
    for (const t of ["intake_outline_revisions", "intake_outline_sources"])
      assert.equal(
        (await c.query(`SELECT * FROM ${t} WHERE session_id=$1`, [x.s.id]))
          .rowCount,
        0,
      );
  });
  await assert.rejects(
    transaction(x.owner.id, (c) =>
      c.query("DELETE FROM intake_outline_sources WHERE session_id=$1", [
        x.s.id,
      ]),
    ),
    { code: "42501" },
  );
  await assert.rejects(
    transaction(x.owner.id, (c) =>
      c.query(
        "UPDATE intake_outline_revisions SET items='[]' WHERE session_id=$1",
        [x.s.id],
      ),
    ),
    { code: "42501" },
  );
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM objects WHERE workspace_id=$1",
        [x.w],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM audit_events WHERE target_id=$1 AND action='intake.outline_saved'",
        [x.s.id],
      )
    ).rows[0].n,
    3,
  );
});
test("outline schema, quotations and source mappings are checked in HTTP and restricted database functions", async () => {
  const x = await setup(),
    n = await note(x, x.s, "Literal source wording"),
    path = `${x.base}/sessions/${x.s.id}/outline`;
  const good = outlineItem(n.turn_id),
    badQuote = { ...good, text: "Invented citation", basis: "quoted" };
  for (const items of [
    [badQuote],
    [{ ...good, kind: "task", rationale: "" }],
    [{ ...good, kind: "method", steps: [] }],
    [{ ...good, source_turn_ids: [randomUUID()] }],
    [good, { ...good, id: good.id.toUpperCase() }],
  ]) {
    assert.equal(
      (
        await req(
          x.owner,
          "POST",
          path,
          { items, reason: "Invalid test" },
          n.etag,
        )
      ).statusCode,
      422,
    );
  }
  await assert.rejects(
    transaction(x.owner.id, (c) =>
      c.query("SELECT save_intake_outline($1,$2,$3,$4,$5,$6)", [
        x.w,
        x.s.id,
        2,
        JSON.stringify([badQuote]),
        "Invalid quotation",
        "outline-test",
      ]),
    ),
    { code: "22023" },
  );
  await assert.rejects(
    transaction(x.owner.id, (c) =>
      c.query("SELECT save_intake_outline($1,$2,$3,$4,$5,$6)", [
        x.w,
        x.s.id,
        2,
        JSON.stringify([{ ...good, source_turn_ids: [randomUUID()] }]),
        "Unknown turn",
        "outline-test",
      ]),
    ),
    { code: "42501" },
  );
  assert.equal((await outlineRead(x)).revision, 0);
  await assert.rejects(
    transaction(x.owner.id, (c) =>
      c.query("SELECT save_intake_outline($1,$2,$3,$4,$5,$6)", [
        x.w,
        x.s.id,
        null,
        JSON.stringify([good]),
        "Missing version",
        "outline-test",
      ]),
    ),
    { code: "40001" },
  );
  const items = [
    "claim",
    "assumption",
    "alternative_hypothesis",
    "question",
    "ethical_constraint",
    "success_criterion",
    "method",
    "task",
  ].map((kind) =>
    outlineItem(n.turn_id, {
      kind,
      steps:
        kind === "method"
          ? ["Measure the baseline", "Compare the proposed condition"]
          : [],
    }),
  );
  const saved = await req(
    x.owner,
    "POST",
    path,
    { items, reason: "Manual entries for all categories" },
    n.etag,
  );
  assert.equal(saved.statusCode, 201, saved.body);
  assert.deepEqual((await outlineRead(x)).missing_categories, []);
  await admin.query(
    "UPDATE intake_sessions SET outline_version=50 WHERE id=$1",
    [x.s.id],
  );
  assert.equal(
    (
      await req(
        x.owner,
        "POST",
        path,
        { items, reason: "Over limit" },
        saved.json().etag,
      )
    ).statusCode,
    429,
  );
  await assert.rejects(
    transaction(x.owner.id, (c) =>
      c.query("SELECT save_intake_outline($1,$2,$3,$4,$5,$6)", [
        x.w,
        x.s.id,
        3,
        JSON.stringify(items),
        "Over limit",
        "outline-test",
      ]),
    ),
    { code: "23514" },
  );
});
test("outline edits share notebook concurrency checks and warn when undo changes the active source branch", async () => {
  const x = await setup(),
    first = await note(x, x.s, "First possibility"),
    second = await note(x, first, "Second possibility");
  const path = `${x.base}/sessions/${x.s.id}/outline`,
    body = {
      items: [outlineItem(second.turn_id)],
      reason: "Interpret the second possibility",
    };
  const attempts = await Promise.all([
    req(x.owner, "POST", path, body, second.etag),
    req(
      x.owner,
      "POST",
      path,
      { ...body, reason: "Concurrent interpretation" },
      second.etag,
    ),
  ]);
  assert.deepEqual(attempts.map((r) => r.statusCode).sort(), [201, 412]);
  const current = await outlineRead(x);
  assert.equal(current.revision, 1);
  const undo = await req(
    x.owner,
    "POST",
    `${x.base}/sessions/${x.s.id}/undo`,
    { target_turn: first.turn_id, reason: "Return to earlier source branch" },
    current.session_etag,
  );
  assert.equal(undo.statusCode, 200, undo.body);
  const after = await outlineRead(x);
  assert.equal(after.outside_active_branch, true);
  assert.deepEqual(after.items, current.items);
  assert.deepEqual(after.sources, current.sources);
  assert.equal(
    (await req(x.owner, "POST", path, body, current.session_etag)).statusCode,
    412,
  );
  await admin.query(
    "UPDATE memberships SET revoked_at=now() WHERE workspace_id=$1 AND user_id=$2",
    [x.w, x.owner.id],
  );
  assert.equal((await req(x.owner, "GET", path)).statusCode, 404);
  await transaction(x.owner.id, async (c) => {
    assert.equal(
      (
        await c.query(
          "SELECT * FROM intake_outline_revisions WHERE session_id=$1",
          [x.s.id],
        )
      ).rowCount,
      0,
    );
  });
  await assert.rejects(
    transaction(x.owner.id, (c) =>
      c.query("SELECT save_intake_outline($1,$2,$3,$4,$5,$6)", [
        x.w,
        x.s.id,
        4,
        JSON.stringify(body.items),
        "Revoked",
        "outline-test",
      ]),
    ),
    { code: "42501" },
  );
});

async function reviewSetup() {
  const x = await setup(),
    first = await note(x, x.s, "Explicitly shared source text"),
    second = await note(
      x,
      first,
      "Uncited confidential note must stay private",
    );
  const item = outlineItem(first.turn_id),
    out = await req(
      x.owner,
      "POST",
      `${x.base}/sessions/${x.s.id}/outline`,
      { items: [item], reason: "Prepare selected source for review" },
      second.etag,
    );
  assert.equal(out.statusCode, 201, out.body);
  return {
    ...x,
    first,
    second,
    item,
    outline: out.json(),
    reviewBody: {
      outline_revision: 1,
      reviewer_id: x.peer.id,
      expires_days: 7,
      purpose: "Independent review of this pinned interpretation",
      share_sources_confirmation: true,
    },
  };
}
async function grantReview(x: Awaited<ReturnType<typeof reviewSetup>>) {
  const r = await req(
    x.owner,
    "POST",
    `${x.base}/sessions/${x.s.id}/outline-reviews`,
    x.reviewBody,
    x.outline.etag,
  );
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
}
test("explicit outline review grants expose only pinned content and independent decisions publish nothing", async () => {
  const x = await reviewSetup(),
    path = `${x.base}/sessions/${x.s.id}/outline-reviews`;
  assert.equal(
    (
      await req(
        x.owner,
        "POST",
        path,
        { ...x.reviewBody, share_sources_confirmation: false },
        x.outline.etag,
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await req(
        x.owner,
        "POST",
        path,
        { ...x.reviewBody, reviewer_id: x.owner.id },
        x.outline.etag,
      )
    ).statusCode,
    403,
  );
  const key = randomUUID(),
    created = await req(
      x.owner,
      "POST",
      path,
      x.reviewBody,
      x.outline.etag,
      key,
    );
  assert.equal(created.statusCode, 201, created.body);
  const r = created.json(),
    url = `${x.base}/outline-reviews/${r.id}`;
  assert.deepEqual(
    (
      await req(x.owner, "POST", path, x.reviewBody, x.outline.etag, key)
    ).json(),
    r,
  );
  const packet = (await req(x.peer, "GET", url)).json();
  assert.equal(packet.outline.revision, 1);
  assert.equal(packet.source_turns.length, 1);
  assert.equal(packet.source_turns[0].id, x.first.turn_id);
  assert.equal(packet.source_turns[0].parent_turn, undefined);
  assert.ok(!JSON.stringify(packet).includes("Uncited confidential"));
  assert.equal(
    (await req(x.peer, "GET", `${x.base}/sessions/${x.s.id}`)).statusCode,
    404,
  );
  assert.equal(
    (await req(x.peer, "GET", `${x.base}/sessions/${x.s.id}/outline`))
      .statusCode,
    404,
  );
  await transaction(x.peer.id, async (c) => {
    assert.equal(
      (
        await c.query("SELECT * FROM intake_turns WHERE session_id=$1", [
          x.s.id,
        ])
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await c.query(
          "SELECT * FROM intake_outline_revisions WHERE session_id=$1",
          [x.s.id],
        )
      ).rowCount,
      0,
    );
  });
  await assert.rejects(
    transaction(x.peer.id, (c) =>
      c.query("SELECT purpose FROM intake_review_requests WHERE id=$1", [r.id]),
    ),
    { code: "42501" },
  );
  const edit = await req(
    x.owner,
    "POST",
    `${x.base}/sessions/${x.s.id}/outline`,
    {
      items: [{ ...x.item, text: "New private interpretation" }],
      reason: "Private subsequent change",
    },
    r.session_etag,
  );
  assert.equal(edit.statusCode, 201, edit.body);
  assert.ok(
    !JSON.stringify((await req(x.peer, "GET", url)).json()).includes(
      "New private interpretation",
    ),
  );
  const decision = {
    disposition: "accepted",
    reason:
      "Reviewed the pinned source; no scientific acceptance or publication",
    conflict_declaration: "none",
  };
  assert.equal(
    (await req(x.owner, "POST", `${url}/decisions`, decision, r.etag))
      .statusCode,
    403,
  );
  const decisionKey = randomUUID(),
    accepted = await req(
      x.peer,
      "POST",
      `${url}/decisions`,
      decision,
      r.etag,
      decisionKey,
    );
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.deepEqual(
    (
      await req(
        x.peer,
        "POST",
        `${url}/decisions`,
        decision,
        r.etag,
        decisionKey,
      )
    ).json(),
    accepted.json(),
  );
  assert.equal(
    (await req(x.owner, "GET", url)).json().decision.disposition,
    "accepted",
  );
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM objects WHERE workspace_id=$1",
        [x.w],
      )
    ).rows[0].n,
    0,
  );
  await assert.rejects(
    transaction(x.peer.id, (c) =>
      c.query("DELETE FROM intake_review_decisions WHERE request_id=$1", [
        r.id,
      ]),
    ),
    { code: "42501" },
  );
  const revoked = await req(
    x.owner,
    "POST",
    `${url}/revoke`,
    { reason: "Close the review audience" },
    accepted.json().etag,
  );
  assert.equal(revoked.statusCode, 200, revoked.body);
  assert.equal((await req(x.peer, "GET", url)).statusCode, 404);
  assert.equal(
    (await req(x.peer, "GET", `${x.base}/outline-reviews`)).json().items.length,
    0,
  );
  assert.equal(
    (await req(x.owner, "GET", url)).json().decision.disposition,
    "accepted",
  );
  await assert.rejects(
    transaction(x.peer.id, (c) =>
      c.query("SELECT outline_review_packet($1,$2)", [x.w, r.id]),
    ),
    { code: "42501" },
  );
});
test("expired, removed-reviewer and revoked-author grants close packet reads and decisions", async () => {
  for (const change of ["expiry", "reviewer", "author"]) {
    const x = await reviewSetup(),
      r = await grantReview(x),
      url = `${x.base}/outline-reviews/${r.id}`;
    if (change === "expiry")
      await admin.query(
        "UPDATE intake_review_requests SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [r.id],
      );
    if (change === "reviewer")
      await admin.query(
        "UPDATE memberships SET roles=ARRAY['member'] WHERE workspace_id=$1 AND user_id=$2",
        [x.w, x.peer.id],
      );
    if (change === "author")
      await admin.query(
        "UPDATE memberships SET revoked_at=now() WHERE workspace_id=$1 AND user_id=$2",
        [x.w, x.owner.id],
      );
    assert.equal((await req(x.peer, "GET", url)).statusCode, 404, change);
    assert.equal(
      (
        await req(
          x.peer,
          "POST",
          `${url}/decisions`,
          {
            disposition: "accepted",
            reason: "Too late",
            conflict_declaration: "none",
          },
          r.etag,
        )
      ).statusCode,
      404,
    );
    await assert.rejects(
      transaction(x.peer.id, (c) =>
        c.query("SELECT decide_outline_review($1,$2,$3,$4,$5,$6,$7)", [
          x.w,
          r.id,
          1,
          "accepted",
          "Too late",
          "none",
          "review-test",
        ]),
      ),
      { code: "42501" },
    );
    await transaction(x.peer.id, async (c) => {
      assert.equal(
        (
          await c.query("SELECT id FROM intake_review_requests WHERE id=$1", [
            r.id,
          ])
        ).rowCount,
        0,
      );
      assert.equal(
        (
          await c.query(
            "SELECT * FROM intake_review_decisions WHERE request_id=$1",
            [r.id],
          )
        ).rowCount,
        0,
      );
    });
  }
});
test("outline review never implicitly shares private attachments and source restriction closes existing grants", async () => {
  const x = await setup();
  const a = await req(x.owner, "POST", `${x.base}/artifacts`, {
    title: "Synthetic review attachment",
    body: "Permission fixture",
    language: "en",
    source_refs: [],
    kind: "digital",
    filename: "note.txt",
    media_type: "text/plain",
    byte_size: 1,
    sha256: "b".repeat(64),
    license: "CC0-1.0",
  });
  assert.equal(a.statusCode, 201, a.body);
  const artifact = a.json().object;
  // Trusted metadata fixture; the research suite exercises actual scanner bytes.
  await admin.query(
    "UPDATE artifacts SET state='available',scan_verdict='clean' WHERE object_id=$1",
    [artifact.id],
  );
  const n = await note(x, x.s, "A note about the artifact", [
    { id: artifact.id, revision: 1 },
  ]);
  const o = await req(
    x.owner,
    "POST",
    `${x.base}/sessions/${x.s.id}/outline`,
    { items: [outlineItem(n.turn_id)], reason: "Interpret artifact note" },
    n.etag,
  );
  assert.equal(o.statusCode, 201, o.body);
  const body = {
      outline_revision: 1,
      reviewer_id: x.peer.id,
      expires_days: 7,
      purpose: "Review permitted artifact provenance",
      share_sources_confirmation: true,
    },
    path = `${x.base}/sessions/${x.s.id}/outline-reviews`;
  assert.equal(
    (await req(x.owner, "POST", path, body, o.json().etag)).statusCode,
    403,
  );
  const published = await req(
    x.owner,
    "POST",
    `${x.base}/objects/${artifact.id}/publish`,
    { revision: 1, confirmation: true },
    artifact.etag,
  );
  assert.equal(published.statusCode, 200, published.body);
  // Publication creates a new immutable revision; it must not expose the private pin.
  assert.equal(
    (await req(x.owner, "POST", path, body, o.json().etag)).statusCode,
    403,
  );
  const current = await read(x);
  const publicNote = await note(
    x,
    current,
    "Note citing the explicitly published revision",
    [{ id: artifact.id, revision: published.json().revision }],
  );
  const publicOutline = await req(
    x.owner,
    "POST",
    `${x.base}/sessions/${x.s.id}/outline`,
    {
      items: [outlineItem(publicNote.turn_id)],
      reason: "Pin the published artifact revision",
    },
    publicNote.etag,
  );
  assert.equal(publicOutline.statusCode, 201, publicOutline.body);
  const grant = await req(
    x.owner,
    "POST",
    path,
    { ...body, outline_revision: 2 },
    publicOutline.json().etag,
  );
  assert.equal(grant.statusCode, 201, grant.body);
  const r = grant.json(),
    url = `${x.base}/outline-reviews/${r.id}`;
  assert.equal((await req(x.peer, "GET", url)).statusCode, 200);
  const state = (
    await req(x.owner, "GET", `${x.base}/artifacts/${artifact.id}`)
  ).json();
  assert.equal(
    (
      await req(
        x.owner,
        "POST",
        `${x.base}/artifacts/${artifact.id}/transitions`,
        { state: "restricted", reason: "Source permission withdrawn" },
        state.etag,
      )
    ).statusCode,
    200,
  );
  assert.equal((await req(x.peer, "GET", url)).statusCode, 404);
  assert.equal((await req(x.owner, "GET", url)).statusCode, 404);
  assert.equal(
    (
      await req(
        x.owner,
        "POST",
        `${url}/revoke`,
        { reason: "Revoke unavailable source packet" },
        r.etag,
      )
    ).statusCode,
    200,
  );
});
test("racing outline review and revocation cannot produce a decision under a revoked grant", async () => {
  const x = await reviewSetup(),
    r = await grantReview(x),
    url = `${x.base}/outline-reviews/${r.id}`;
  const results = await Promise.all([
    req(
      x.peer,
      "POST",
      `${url}/decisions`,
      {
        disposition: "needs_evidence",
        reason: "Need a discriminating test",
        conflict_declaration: "none",
      },
      r.etag,
    ),
    req(
      x.owner,
      "POST",
      `${url}/revoke`,
      { reason: "Close pending review" },
      r.etag,
    ),
  ]);
  assert.equal(results.filter((r) => r.statusCode === 200).length, 1);
  assert.ok(
    results.every((r) => [200, 404, 412].includes(r.statusCode)),
    results.map((r) => r.body).join("\n"),
  );
  const state = (
    await admin.query("SELECT state FROM intake_review_requests WHERE id=$1", [
      r.id,
    ])
  ).rows[0].state;
  const decisions = (
    await admin.query(
      "SELECT count(*)::int n FROM intake_review_decisions WHERE request_id=$1",
      [r.id],
    )
  ).rows[0].n;
  assert.equal(decisions, state === "revoked" ? 0 : 1);
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM audit_events a LEFT JOIN outbox o ON o.event_id=a.id WHERE a.target_id=$1 AND o.event_id IS NULL",
        [r.id],
      )
    ).rows[0].n,
    0,
  );
});

test("author previews a registry claim from the accepted revision with explicit scope and private provenance", async () => {
  const x = await reviewSetup(),
    r = await grantReview(x),
    url = `${x.base}/outline-reviews/${r.id}`,
    path = url + "/claim-preview";
  const fields = {
    item_id: x.item.id,
    title: "Tentative baseline claim",
    scope: "Only the synthetic notebook observation",
    language: "en",
  };
  assert.equal(
    (await req(x.owner, "POST", path, fields, r.etag)).statusCode,
    409,
  );
  const accepted = await req(
    x.peer,
    "POST",
    url + "/decisions",
    {
      disposition: "accepted",
      conflict_declaration: "none",
      reason: "Reviewed source wording",
    },
    r.etag,
  );
  assert.equal(accepted.statusCode, 200, accepted.body);
  const version = accepted.json().etag;
  assert.equal(
    (await req(x.peer, "POST", path, fields, version)).statusCode,
    403,
  );
  assert.equal(
    (await req(x.owner, "POST", path, fields, r.etag)).statusCode,
    412,
  );
  assert.equal(
    (
      await req(
        x.owner,
        "POST",
        path,
        { ...fields, proposition: "Replaced wording" },
        version,
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await req(
        x.owner,
        "POST",
        path,
        { ...fields, item_id: randomUUID() },
        version,
      )
    ).statusCode,
    422,
  );
  const result = await req(x.owner, "POST", path, fields, version);
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(result.json().content.proposition, x.item.text);
  assert.equal(result.json().content.scope, fields.scope);
  assert.deepEqual(result.json().provenance.source_turn_ids, [x.first.turn_id]);
  assert.ok(!result.body.includes("Uncited confidential"));
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM objects WHERE workspace_id=$1",
        [x.w],
      )
    ).rows[0].n,
    0,
  );
  const candidatePath = url + "/claim-candidates",
    key = randomUUID();
  const save = await req(x.owner, "POST", candidatePath, fields, version, key);
  assert.equal(save.statusCode, 201, save.body);
  assert.deepEqual(
    (await req(x.owner, "POST", candidatePath, fields, version, key)).json(),
    save.json(),
  );
  const next = await req(
    x.owner,
    "POST",
    candidatePath,
    { ...fields, title: "Revised title" },
    version,
  );
  assert.equal(next.json().version, 2, next.body);
  const history = (await req(x.owner, "GET", candidatePath)).json().items;
  assert.equal(history.length, 2);
  assert.deepEqual(history[1].candidate, result.json());
  assert.deepEqual((await req(x.peer, "GET", candidatePath)).json().items, []);
  const revoked = await req(
    x.owner,
    "POST",
    url + "/revoke",
    { reason: "Close access" },
    version,
  );
  assert.equal(
    (await req(x.owner, "POST", path, fields, revoked.json().etag)).statusCode,
    409,
  );
  assert.deepEqual((await req(x.owner, "GET", candidatePath)).json().items, []);
});
