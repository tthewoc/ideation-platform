import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { buildApp } from "../src/server/app.js";
import { db, authDb, transaction } from "../src/server/db.js";
import { hash } from "../src/server/auth.js";
import { config } from "../src/server/config.js";
import { deliver } from "../src/server/worker.js";
const app = await buildApp();
await app.ready();
const admin = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL }),
  worker = new pg.Pool({ connectionString: process.env.WORKER_DATABASE_URL });
after(async () => {
  await app.close();
  await Promise.all([db.end(), authDb.end(), admin.end(), worker.end()]);
});
type User = { id: string; token: string; csrf: string };
async function user(name: string): Promise<User> {
  const id = randomUUID(),
    token = randomBytes(32).toString("hex"),
    csrf = randomUUID();
  await authDb.query(
    "INSERT INTO users(id,issuer,subject,name) VALUES($1,$2,$3,$4)",
    [id, "graph-test", id, name],
  );
  await authDb.query(
    "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [hash(token), id, csrf],
  );
  return { id, token, csrf };
}
const author = await user("Author"),
  reviewer = await user("Reviewer"),
  challenger = await user("Challenger"),
  outsider = await user("Outsider");
async function req(
  u: User,
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
let w: string, method: any, claim: any, evidence: any, assessment: any;
const common = {
  title: "Synthetic knowledge",
  body: "Synthetic content",
  language: "en",
  source_refs: [],
};
const ref = (o: any) => ({ id: o.id, revision: o.revision });
async function draft(type: string, fields: any, u = author) {
  const r = await req(u, "POST", `/v1/workspaces/${w}/objects`, {
    type,
    schema_version: 1,
    content: { ...common, ...fields },
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
}
async function publish(o: any, u = author) {
  const r = await req(
    u,
    "POST",
    `/v1/workspaces/${w}/objects/${o.id}/publish`,
    { revision: o.revision, confirmation: true },
    o.etag,
  );
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
async function fresh() {
  await worker.query("SELECT refresh_freshness($1)", [w]);
}
async function read(o: any, u = author, revision?: number) {
  const r = await req(
    u,
    "GET",
    `/v1/workspaces/${w}/objects/${o.id}${revision ? `?revision=${revision}` : ""}`,
  );
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
async function edge(type: string, a: any, b: any, u = author) {
  return req(u, "POST", `/v1/workspaces/${w}/edges`, {
    type,
    from: ref(a),
    to: ref(b),
    rationale: "Explicit synthetic relationship",
  });
}
test("slice-two fixtures preserve typed references and permit independent reviewers", async () => {
  const r = await req(author, "POST", "/v1/workspaces", {
    name: "Graph review workspace",
  });
  assert.equal(r.statusCode, 201, r.body);
  w = r.json().id;
  // Fixture identities are all workspace members; API membership is already covered by slice one.
  for (const u of [reviewer, challenger])
    await admin.query(
      "INSERT INTO memberships VALUES($1,$2,ARRAY['member','reviewer'],NULL)",
      [w, u.id],
    );
  method = await publish(
    await draft("method", {
      title: "Repeatable protocol",
      ordered_steps: ["Measure baseline", "Apply treatment"],
      metrics: ["Peak temperature"],
      constraints: [],
      ethical_constraints: [],
    }),
  );
  claim = await publish(
    await draft("claim", {
      title: "Scoped thermal claim",
      proposition: "Temperature decreases under load L",
      scope: "Synthetic apparatus L",
      qualifiers: ["Unverified"],
    }),
  );
  evidence = await publish(
    await draft("evidence", {
      title: "Trial evidence",
      source: "Synthetic dataset D",
      acquisition_context: "Controlled bench trial",
      source_group_ids: [randomUUID()],
    }),
  );
  const invalid = await draft("result", {
    method_ref: ref(method),
    outcome: "null",
    measurement_context: "No measurable difference",
    artifact_refs: [],
  });
  assert.equal(invalid.content.outcome, "null");
  const bad = await req(reviewer, "POST", `/v1/workspaces/${w}/objects`, {
    type: "result",
    schema_version: 1,
    content: {
      ...common,
      method_ref: ref(claim),
      outcome: "null",
      measurement_context: "x",
      artifact_refs: [],
    },
  });
  assert.equal(bad.statusCode, 422, bad.body);
  await fresh();
});
test("contradictory scoped assessments coexist and share source provenance", async () => {
  for (const [u, polarity] of [
    [author, "supports"],
    [reviewer, "contradicts"],
  ] as const) {
    const r = await req(u, "POST", `/v1/workspaces/${w}/assessments`, {
      claim_ref: ref(claim),
      evidence_ref: ref(evidence),
      method_ref: ref(method),
      polarity,
      scope: "Only under load L",
      uncertainty: { level: "medium", rationale: "Small synthetic sample" },
      rationale: `Independent ${polarity} interpretation`,
    });
    assert.equal(r.statusCode, 201, r.body);
    const p = await publish(r.json(), u);
    if (u === author) assessment = p;
  }
  const list = await req(
    reviewer,
    "GET",
    `/v1/workspaces/${w}/assessments?claim_id=${claim.id}`,
  );
  assert.equal(list.statusCode, 200, list.body);
  assert.deepEqual(
    list
      .json()
      .items.map((i: any) => i.content.polarity)
      .sort(),
    ["contradicts", "supports"],
  );
  assert.equal(
    list.json().items[0].content.evidence_ref.id,
    list.json().items[1].content.evidence_ref.id,
  );
  const graph = await req(reviewer, "POST", `/v1/workspaces/${w}/graph/query`, {
    root_ids: [claim.id],
    depth: 1,
  });
  assert.equal(graph.statusCode, 200, graph.body);
  assert.deepEqual(
    graph
      .json()
      .edges.map((e: any) => e.type)
      .sort(),
    ["contradicts", "supports"],
  );
  const forged = await req(reviewer, "POST", `/v1/workspaces/${w}/edges`, {
    type: "supports",
    from: ref(evidence),
    to: ref(claim),
    rationale: "Bypass assessment",
  });
  assert.equal(forged.statusCode, 422);
  await fresh();
});
test("exact submitted revision is readable; earlier drafts, self-review and stale decisions are denied", async () => {
  let o = await draft(
    "claim",
    { proposition: "Private claim", scope: "Limited", qualifiers: [] },
    challenger,
  );
  const first = o.revision;
  const edit = await req(
    challenger,
    "PATCH",
    `/v1/workspaces/${w}/objects/${o.id}/draft`,
    {
      content: { ...o.content, title: "Review only this revision" },
      reason: "Refine",
    },
    o.etag,
  );
  assert.equal(edit.statusCode, 200, edit.body);
  o = edit.json();
  assert.equal(
    (await req(reviewer, "GET", `/v1/workspaces/${w}/objects/${o.id}`))
      .statusCode,
    404,
  );
  const self = await req(
    challenger,
    "POST",
    `/v1/workspaces/${w}/objects/${o.id}/submissions`,
    {
      revision: o.revision,
      reviewer_ids: [challenger.id],
      purpose: "Self approval",
    },
    o.etag,
  );
  assert.equal(self.statusCode, 403);
  const sub = await req(
    challenger,
    "POST",
    `/v1/workspaces/${w}/objects/${o.id}/submissions`,
    {
      revision: o.revision,
      reviewer_ids: [reviewer.id],
      purpose: "Independent scope review",
    },
    o.etag,
  );
  assert.equal(sub.statusCode, 201, sub.body);
  const s = sub.json();
  const visible = await read(o, reviewer, o.revision);
  assert.equal(visible.content.title, "Review only this revision");
  assert.equal(
    (
      await req(
        reviewer,
        "GET",
        `/v1/workspaces/${w}/objects/${o.id}?revision=${first}`,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await transaction(reviewer.id, (c) =>
        c.query("SELECT * FROM revisions WHERE object_id=$1", [o.id]),
      )
    ).rowCount,
    1,
  );
  const decisions = await Promise.all([
    req(
      reviewer,
      "POST",
      `/v1/workspaces/${w}/submissions/${s.id}/decisions`,
      {
        decision: "accepted",
        reason: "Scoped and attributable",
        conflict_declaration: "none",
      },
      s.etag,
    ),
    req(
      reviewer,
      "POST",
      `/v1/workspaces/${w}/submissions/${s.id}/decisions`,
      {
        decision: "rejected",
        reason: "Concurrent conflicting decision",
        conflict_declaration: "none",
      },
      s.etag,
    ),
  ]);
  assert.equal(
    decisions.filter((r) => r.statusCode === 200).length,
    1,
    decisions.map((r) => r.body).join("\n"),
  );
  assert.equal(
    (
      await req(
        reviewer,
        "GET",
        `/v1/workspaces/${w}/objects/${o.id}?revision=${o.revision}`,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (await admin.query("SELECT * FROM publications WHERE object_id=$1", [o.id]))
      .rowCount,
    0,
    "review does not publish",
  );
});
test("simultaneous reciprocal derivation rejects one write, while relevance cycles are valid", async () => {
  const a = claim,
    b = evidence;
  const results = await Promise.all([
    edge("derived_from", a, b, reviewer),
    edge("derived_from", b, a, challenger),
  ]);
  assert.deepEqual(
    results.map((r) => r.statusCode).sort(),
    [201, 409],
    results.map((r) => r.body).join("\n"),
  );
  assert.equal((await edge("relevant_to", a, b, reviewer)).statusCode, 201);
  assert.equal((await edge("relevant_to", b, a, challenger)).statusCode, 201);
  // Retire the synthetic derivation so later staleness checks isolate the assessment.
  const created = results.find((r) => r.statusCode === 201)!.json();
  const creator = results[0].statusCode === 201 ? reviewer : challenger;
  const retract = await req(
    creator,
    "POST",
    `/v1/workspaces/${w}/edges/${created.id}/retract`,
    { reason: "Cycle fixture complete" },
    created.etag,
  );
  assert.equal(retract.statusCode, 200, retract.body);
});
test("correction immediately makes freshness unknown, then replayable propagation marks old interpretations stale", async () => {
  await fresh();
  assert.equal((await read(assessment)).freshness, "current");
  const edit = await req(
    author,
    "POST",
    `/v1/workspaces/${w}/objects/${claim.id}/corrections`,
    {
      base_revision: claim.revision,
      content: { ...claim.content, scope: "Narrower load range" },
      reason: "Narrow scope",
    },
    claim.etag,
  );
  assert.equal(edit.statusCode, 200, edit.body);
  claim = await publish(edit.json());
  assert.equal((await read(assessment)).freshness, "unknown");
  await fresh();
  assert.equal((await read(assessment)).freshness, "stale");
  await fresh();
  assert.equal((await read(assessment)).freshness, "stale");
  const history = await req(
    reviewer,
    "GET",
    `/v1/workspaces/${w}/objects/${claim.id}/revisions`,
  );
  assert.equal(history.json().items.length, 2);
});
test("equivalence is reversible without merging identities; outsiders cannot query graph or provenance", async () => {
  const create = await req(
    reviewer,
    "POST",
    `/v1/workspaces/${w}/equivalences`,
    {
      left_ref: ref(evidence),
      right_ref: ref(claim),
      rationale: "Candidate overlap, not automatic identity",
    },
  );
  assert.equal(create.statusCode, 201, create.body);
  let e = create.json();
  const own = await req(
    reviewer,
    "POST",
    `/v1/workspaces/${w}/equivalences/${e.id}/decisions`,
    { decision: "reviewed", reason: "Self review" },
    e.etag,
  );
  assert.equal(own.statusCode, 403);
  for (const decision of ["reviewed", "revoked"]) {
    const r = await req(
      challenger,
      "POST",
      `/v1/workspaces/${w}/equivalences/${e.id}/decisions`,
      { decision, reason: "Reversible interpretation" },
      e.etag,
    );
    assert.equal(r.statusCode, 200, r.body);
    e = r.json();
  }
  assert.equal((await read(evidence)).id, evidence.id);
  assert.equal((await read(claim)).id, claim.id);
  for (const [method, path, body] of [
    ["POST", "/graph/query", { root_ids: [claim.id] }],
    [
      "GET",
      `/objects/${claim.id}/provenance?revision=${claim.revision}`,
      undefined,
    ],
  ] as const)
    assert.equal(
      (await req(outsider, method, `/v1/workspaces/${w}${path}`, body))
        .statusCode,
      404,
    );
  assert.equal(
    (
      await transaction(outsider.id, (c) =>
        c.query("SELECT * FROM edge_revisions WHERE workspace_id=$1", [w]),
      )
    ).rowCount,
    0,
  );
});
test("retraction retains history, warns directly and invalidates downstream interpretations", async () => {
  const o = await read(evidence);
  const r = await req(
    author,
    "POST",
    `/v1/workspaces/${w}/objects/${evidence.id}/transitions`,
    {
      axis: "validity",
      to_state: "retracted",
      revision: evidence.revision,
      reason: "Source acquisition found invalid",
    },
    o.state_etag,
  );
  assert.equal(r.statusCode, 200, r.body);
  assert.equal((await read(evidence)).validity, "retracted");
  await fresh();
  assert.equal((await read(assessment)).freshness, "stale");
  await deliver(worker);
  assert.equal(
    (
      await admin.query(
        "SELECT * FROM lifecycle_events WHERE object_id=$1 AND to_state=$2",
        [evidence.id, "retracted"],
      )
    ).rowCount,
    1,
  );
  await assert.rejects(
    transaction(author.id, (c) =>
      c.query("DELETE FROM reviews WHERE workspace_id=$1", [w]),
    ),
    /permission denied/,
  );
});
test("review acceptance, dispute and adjudication remain separate from publication and validity", async () => {
  const owner = await user("Lifecycle author");
  await admin.query(
    "INSERT INTO memberships VALUES($1,$2,ARRAY['member'],NULL)",
    [w, owner.id],
  );
  let o = await draft(
    "claim",
    { proposition: "Governed claim", scope: "Synthetic only", qualifiers: [] },
    owner,
  );
  const submitted = await req(
    owner,
    "POST",
    `/v1/workspaces/${w}/objects/${o.id}/submissions`,
    {
      revision: o.revision,
      reviewer_ids: [reviewer.id],
      purpose: "Review attribution",
    },
    o.etag,
  );
  assert.equal(submitted.statusCode, 201, submitted.body);
  const s = submitted.json();
  const decision = await req(
    reviewer,
    "POST",
    `/v1/workspaces/${w}/submissions/${s.id}/decisions`,
    {
      decision: "accepted",
      reason: "Attribution complete",
      conflict_declaration: "none",
    },
    s.etag,
  );
  assert.equal(decision.statusCode, 200, decision.body);
  o = await publish(o, owner);
  assert.equal(o.review_state, "accepted");
  assert.equal(o.validity, "active");
  const challenge = await req(
    challenger,
    "POST",
    `/v1/workspaces/${w}/objects/${o.id}/transitions`,
    {
      axis: "review",
      to_state: "disputed",
      revision: o.revision,
      reason: "Challenge scope",
      conflict_declaration: "none",
    },
    o.state_etag,
  );
  assert.equal(challenge.statusCode, 200, challenge.body);
  o = await read(o, owner);
  assert.equal(o.validity, "active");
  assert.equal(o.review_state, "disputed");
  const adjudicate = await req(
    reviewer,
    "POST",
    `/v1/workspaces/${w}/objects/${o.id}/transitions`,
    {
      axis: "review",
      to_state: "rejected",
      revision: o.revision,
      reason: "Challenge sustained",
      conflict_declaration: "none",
    },
    o.state_etag,
  );
  assert.equal(adjudicate.statusCode, 200, adjudicate.body);
  const history = await req(
    challenger,
    "GET",
    `/v1/workspaces/${w}/objects/${o.id}/reviews?revision=${o.revision}`,
  );
  assert.equal(history.json().reviews.length, 3);
  assert.equal((await read(o, owner)).lifecycle, "published");
});
test("task dependency cycles reject reciprocal concurrent inserts with unchanged valid state", async () => {
  const u = await user("Dependency author");
  await admin.query(
    "INSERT INTO memberships VALUES($1,$2,ARRAY['member'],NULL)",
    [w, u.id],
  );
  const fields = {
    method_ref: ref(method),
    rationale: "Verify apparatus",
    acceptance_criteria: ["Repeatability achieved"],
  };
  const a = await publish(await draft("research_task", fields, u), u),
    b = await publish(await draft("research_task", fields, u), u);
  const rs = await Promise.all([
    edge("depends_on", a, b, u),
    edge("depends_on", b, a, u),
  ]);
  assert.deepEqual(rs.map((r) => r.statusCode).sort(), [201, 409]);
});
