import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { buildApp } from "../src/server/app.js";
import { db, authDb, transaction } from "../src/server/db.js";
import { hash } from "../src/server/auth.js";
import { config } from "../src/server/config.js";
import { digest } from "../src/server/artifact-storage.js";
import { scanPendingArtifact } from "../src/server/artifact-scanner.js";
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
    [id, "research-test", id],
  );
  await authDb.query(
    "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [hash(token), id, csrf],
  );
  return { id, token, csrf };
}
const coordinator = await user(),
  assignee = await user(),
  reviewer = await user(),
  outsider = await user(),
  owner = await user();
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
  title: "Synthetic research",
  body: "Synthetic only",
  language: "en",
  source_refs: [],
};
let w: string,
  base: string,
  method: any,
  taskObject: any,
  task: any,
  artifact: any,
  result: any;
async function create(type: string, fields: any, u = coordinator) {
  const r = await req(u, "POST", `${base}/objects`, {
    type,
    schema_version: 1,
    content: { ...common, ...fields },
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
}
async function publish(o: any, u = coordinator) {
  const r = await req(
    u,
    "POST",
    `${base}/objects/${o.id}/publish`,
    { revision: o.revision, confirmation: true },
    o.etag,
  );
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
async function readTask() {
  const r = await req(assignee, "GET", `${base}/tasks/${taskObject.id}`);
  assert.equal(r.statusCode, 200, r.body);
  task = r.json();
  return task;
}
async function register(bytes: Buffer, extra: any = {}) {
  const r = await req(owner, "POST", `${base}/artifacts`, {
    ...common,
    kind: "digital",
    filename: "measurements.csv",
    media_type: "text/csv",
    byte_size: bytes.length,
    sha256: digest(bytes),
    license: "CC0-1.0",
    ...extra,
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
}
async function upload(a: any, bytes: Buffer) {
  return req(
    owner,
    "POST",
    `${base}/artifacts/${a.object.id}/upload`,
    { base64: bytes.toString("base64") },
    a.artifact.etag,
  );
}
async function scan(id: string) {
  for (let n = 0; n < 20; n++) {
    const state = (await req(owner, "GET", `${base}/artifacts/${id}`)).json();
    if (["available", "rejected"].includes(state.state)) return state;
    await scanPendingArtifact(worker);
  }
  throw new Error("Scan did not finish");
}
test("research fixtures and explicit coordinator opening", async () => {
  const r = await req(coordinator, "POST", "/v1/workspaces", {
    name: "Research workflow",
  });
  assert.equal(r.statusCode, 201, r.body);
  w = r.json().id;
  base = `/v1/workspaces/${w}`;
  await admin.query(
    "UPDATE memberships SET roles=ARRAY['member','admin','coordinator'] WHERE workspace_id=$1 AND user_id=$2",
    [w, coordinator.id],
  );
  for (const [u, roles] of [
    [assignee, ["member", "reviewer"]],
    [reviewer, ["member", "reviewer"]],
    [owner, ["member"]],
  ] as [User, string[]][])
    await admin.query("INSERT INTO memberships VALUES($1,$2,$3,NULL)", [
      w,
      u.id,
      roles,
    ]);
  method = await publish(
    await create("method", {
      ordered_steps: ["Record temperature"],
      metrics: ["Degrees C"],
      constraints: [],
      ethical_constraints: [],
    }),
  );
  taskObject = await publish(
    await create("research_task", {
      rationale: "Replicate null finding",
      method_ref: { id: method.id, revision: method.revision },
      acceptance_criteria: ["Record all temperatures"],
    }),
  );
  const denied = await req(
    assignee,
    "POST",
    `${base}/tasks/${taskObject.id}/open`,
    { revision: taskObject.revision, reason: "Unauthorized" },
    taskObject.etag,
  );
  assert.equal(denied.statusCode, 403);
  const opened = await req(
    coordinator,
    "POST",
    `${base}/tasks/${taskObject.id}/open`,
    { revision: taskObject.revision, reason: "Protocol ready" },
    taskObject.etag,
  );
  assert.equal(opened.statusCode, 201, opened.body);
  task = opened.json();
});
test("invitation consent cannot be forged; declines and concurrent acceptance preserve history", async () => {
  let r = await req(
    coordinator,
    "POST",
    `${base}/tasks/${taskObject.id}/assignment`,
    { assignee_id: assignee.id, purpose: "Repeat measurement" },
    task.etag,
  );
  assert.equal(r.statusCode, 201, r.body);
  const i = r.json();
  r = await req(
    coordinator,
    "POST",
    `${base}/tasks/${taskObject.id}/assignment/decisions`,
    { invitation_id: i.id, decision: "accept", reason: "Forged consent" },
    i.etag,
  );
  assert.equal(r.statusCode, 403);
  r = await req(
    assignee,
    "POST",
    `${base}/tasks/${taskObject.id}/assignment/decisions`,
    { invitation_id: i.id, decision: "decline", reason: "Unavailable" },
    i.etag,
  );
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, "open");
  await readTask();
  r = await req(
    coordinator,
    "POST",
    `${base}/tasks/${taskObject.id}/assignment`,
    { assignee_id: assignee.id, purpose: "Revised timing" },
    task.etag,
  );
  assert.equal(r.statusCode, 201, r.body);
  const j = r.json();
  const decisions = await Promise.all(
    ["accept", "decline"].map((decision) =>
      req(
        assignee,
        "POST",
        `${base}/tasks/${taskObject.id}/assignment/decisions`,
        { invitation_id: j.id, decision, reason: "Available now" },
        j.etag,
      ),
    ),
  );
  assert.deepEqual(decisions.map((d) => d.statusCode).sort(), [200, 412]);
  await readTask();
  if (task.status === "open") {
    r = await req(
      coordinator,
      "POST",
      `${base}/tasks/${taskObject.id}/assignment`,
      { assignee_id: assignee.id, purpose: "Confirm availability" },
      task.etag,
    );
    const k = r.json();
    r = await req(
      assignee,
      "POST",
      `${base}/tasks/${taskObject.id}/assignment/decisions`,
      { invitation_id: k.id, decision: "accept", reason: "Confirmed" },
      k.etag,
    );
    assert.equal(r.statusCode, 200, r.body);
    await readTask();
  }
  assert.equal(task.status, "assigned");
  assert.ok(
    task.events.some((e: any) => e.action === "task.assignment_declined"),
  );
  r = await req(
    coordinator,
    "POST",
    `${base}/tasks/${taskObject.id}/transitions`,
    { action: "start", reason: "Not assignee" },
    task.etag,
  );
  assert.equal(r.statusCode, 403);
  r = await req(
    assignee,
    "POST",
    `${base}/tasks/${taskObject.id}/transitions`,
    { action: "start", reason: "Ready to measure" },
    task.etag,
  );
  assert.equal(r.statusCode, 200, r.body);
  task = r.json();
});
test("digest and media forgery fail closed; malware is rejected by real scanner", async () => {
  const bytes = Buffer.from("temperature\n20\n"),
    a = await register(bytes);
  let r = await upload(a, Buffer.from("forged"));
  assert.equal(r.statusCode, 202, r.body);
  assert.equal(r.json().scan_verdict, "integrity_mismatch");
  assert.equal(
    (await req(owner, "GET", `${base}/artifacts/${a.object.id}/download`))
      .statusCode,
    404,
  );
  const html = Buffer.from("<script>alert(1)</script>"),
    h = await register(html, { media_type: "text/plain" });
  r = await upload(h, html);
  assert.equal(r.json().scan_verdict, "invalid_type");
  // Standard harmless antivirus test string, never execute it.
  const eicar = Buffer.from(
      "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
    ),
    e = await register(eicar, {
      filename: "antivirus-test.txt",
      media_type: "text/plain",
    });
  r = await upload(e, eicar);
  assert.equal(r.statusCode, 202, r.body);
  const verdict = await scan(e.object.id);
  assert.equal(verdict.state, "rejected");
  assert.equal(verdict.scan_verdict, "malware");
  assert.equal(
    (
      await req(
        owner,
        "POST",
        `${base}/objects/${e.object.id}/publish`,
        { revision: 1, confirmation: true },
        e.object.etag,
      )
    ).statusCode,
    409,
  );
});
test("clean artifact stays private through scanning, then publication allows checked downloads", async () => {
  const bytes = Buffer.from("temperature\n20\n20\n"),
    a = await register(bytes);
  artifact = a.object;
  const r = await upload(a, bytes);
  assert.equal(r.statusCode, 202, r.body);
  assert.equal(
    (await req(owner, "GET", `${base}/artifacts/${artifact.id}/download`))
      .statusCode,
    404,
  );
  const scanned = await scan(artifact.id);
  assert.equal(scanned.state, "available", JSON.stringify(scanned));
  assert.equal(
    (await req(assignee, "GET", `${base}/artifacts/${artifact.id}`)).statusCode,
    404,
  );
  artifact = await publish(artifact, owner);
  const download = await req(
    assignee,
    "GET",
    `${base}/artifacts/${artifact.id}/download`,
  );
  assert.equal(download.statusCode, 200, download.body);
  assert.equal(download.headers["content-type"], "application/octet-stream");
  assert.equal(digest(download.rawPayload), digest(bytes));
  assert.match(download.headers["content-disposition"] as string, /attachment/);
  assert.equal(
    (await req(outsider, "GET", `${base}/artifacts/${artifact.id}/download`))
      .statusCode,
    404,
  );
});
test("null result preserves method, task and artifact lineage and requires independent completion", async () => {
  await readTask();
  let r = await req(
    assignee,
    "POST",
    `${base}/tasks/${taskObject.id}/results`,
    {
      ...common,
      title: "Null replication",
      method_ref: { id: method.id, revision: method.revision },
      outcome: "null",
      measurement_context: "No detectable difference",
      artifact_refs: [{ id: artifact.id, revision: artifact.revision }],
    },
    task.etag,
  );
  assert.equal(r.statusCode, 201, r.body);
  result = await publish(r.json(), assignee);
  r = await req(
    assignee,
    "POST",
    `${base}/tasks/${taskObject.id}/transitions`,
    {
      action: "submit",
      reason: "Measurements recorded",
      result_ref: { id: result.id, revision: result.revision },
      acceptance_evidence: ["All temperatures are in the CSV"],
    },
    task.etag,
  );
  assert.equal(r.statusCode, 200, r.body);
  task = r.json();
  const self = await req(
    assignee,
    "POST",
    `${base}/tasks/${taskObject.id}/transitions`,
    {
      action: "complete",
      reason: "Self approval",
      conflict_declaration: "none",
    },
    task.etag,
  );
  assert.equal(self.statusCode, 403);
  r = await req(
    reviewer,
    "POST",
    `${base}/tasks/${taskObject.id}/transitions`,
    {
      action: "return",
      reason: "Clarify measurement interval",
      conflict_declaration: "none",
    },
    task.etag,
  );
  assert.equal(r.statusCode, 200, r.body);
  task = r.json();
  r = await req(
    assignee,
    "POST",
    `${base}/tasks/${taskObject.id}/transitions`,
    {
      action: "submit",
      reason: "Clarified protocol interval",
      result_ref: { id: result.id, revision: result.revision },
      acceptance_evidence: [
        "Protocol interval is one second; all temperatures recorded",
      ],
    },
    task.etag,
  );
  assert.equal(r.statusCode, 200, r.body);
  task = r.json();
  await worker.query("SELECT refresh_freshness($1)", [w]);
  r = await req(
    reviewer,
    "POST",
    `${base}/tasks/${taskObject.id}/transitions`,
    {
      action: "complete",
      reason: "Criteria verified regardless of null outcome",
      conflict_declaration: "none",
    },
    task.etag,
  );
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, "completed");
  const lineage = await req(
    assignee,
    "GET",
    `${base}/objects/${result.id}/provenance?revision=${result.revision}`,
  );
  assert.equal(lineage.statusCode, 200, lineage.body);
  assert.ok(lineage.body.includes(artifact.id));
  assert.ok(lineage.body.includes(method.id));
});
test("restriction blocks new downloads and result references, preserves history and marks downstream stale", async () => {
  const meta = (
    await req(owner, "GET", `${base}/artifacts/${artifact.id}`)
  ).json();
  const r = await req(
    owner,
    "POST",
    `${base}/artifacts/${artifact.id}/transitions`,
    { state: "restricted", reason: "License access withdrawn" },
    meta.etag,
  );
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(
    (await req(assignee, "GET", `${base}/artifacts/${artifact.id}/download`))
      .statusCode,
    404,
  );
  await worker.query("SELECT refresh_freshness($1)", [w]);
  const resultView = (
    await req(assignee, "GET", `${base}/objects/${result.id}`)
  ).json();
  assert.equal(resultView.freshness, "stale");
  assert.equal(resultView.content.outcome, "null");
  await transaction(outsider.id, async (c) => {
    for (const table of [
      "artifacts",
      "artifact_events",
      "tasks",
      "task_events",
      "task_results",
      "task_invitations",
    ])
      assert.equal(
        (await c.query(`SELECT * FROM ${table} WHERE workspace_id=$1`, [w]))
          .rowCount,
        0,
      );
  });
  await assert.rejects(
    transaction(coordinator.id, (c) =>
      c.query("DELETE FROM task_events WHERE workspace_id=$1", [w]),
    ),
    /permission denied/,
  );
  await assert.rejects(
    transaction(owner.id, (c) =>
      c.query("SELECT finish_artifact_scan($1,$2,'clean','forged')", [
        artifact.id,
        randomUUID(),
      ]),
    ),
    /permission denied/,
  );
});
test("incomplete dependencies block starting work and dependency changes freeze after start", async () => {
  const u = await user();
  await admin.query(
    "INSERT INTO memberships VALUES($1,$2,ARRAY['member','coordinator'],NULL)",
    [w, u.id],
  );
  const fields = {
    rationale: "Dependency fixture",
    method_ref: { id: method.id, revision: method.revision },
    acceptance_criteria: ["Measure"],
  };
  const prerequisite = await publish(
      await create("research_task", fields, u),
      u,
    ),
    dependent = await publish(await create("research_task", fields, u), u);
  const link = await req(u, "POST", `${base}/edges`, {
    type: "depends_on",
    from: { id: dependent.id, revision: dependent.revision },
    to: { id: prerequisite.id, revision: prerequisite.revision },
    rationale: "Prerequisite required",
  });
  assert.equal(link.statusCode, 201, link.body);
  let r = await req(
    u,
    "POST",
    `${base}/tasks/${dependent.id}/open`,
    { revision: dependent.revision, reason: "Dependency check" },
    dependent.etag,
  );
  assert.equal(r.statusCode, 201, r.body);
  r = await req(
    u,
    "POST",
    `${base}/tasks/${dependent.id}/assignment`,
    { assignee_id: u.id, purpose: "Self consent explicitly requested" },
    r.json().etag,
  );
  assert.equal(r.statusCode, 201, r.body);
  const i = r.json();
  r = await req(
    u,
    "POST",
    `${base}/tasks/${dependent.id}/assignment/decisions`,
    { invitation_id: i.id, decision: "accept", reason: "Explicit acceptance" },
    i.etag,
  );
  assert.equal(r.statusCode, 200, r.body);
  const assigned = r.json();
  r = await req(
    u,
    "POST",
    `${base}/tasks/${dependent.id}/transitions`,
    { action: "start", reason: "Attempt before prerequisite" },
    assigned.etag,
  );
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().error.code, "prerequisites_incomplete");
  r = await req(
    u,
    "POST",
    `${base}/edges/${link.json().id}/retract`,
    { reason: "Remove incorrect prerequisite before start" },
    link.json().etag,
  );
  assert.equal(r.statusCode, 200, r.body);
  r = await req(
    u,
    "POST",
    `${base}/tasks/${dependent.id}/transitions`,
    { action: "start", reason: "No prerequisites remain" },
    assigned.etag,
  );
  assert.equal(r.statusCode, 200, r.body);
  r = await req(u, "POST", `${base}/edges`, {
    type: "depends_on",
    from: { id: dependent.id, revision: dependent.revision },
    to: { id: prerequisite.id, revision: prerequisite.revision },
    rationale: "Cannot silently change active work",
  });
  assert.equal(r.statusCode, 409, r.body);
});
test("expired and replaced invitations reject late consent; cancellation closes invitations", async () => {
  const u = await user();
  await admin.query(
    "INSERT INTO memberships VALUES($1,$2,ARRAY['member','coordinator'],NULL)",
    [w, u.id],
  );
  const o = await publish(
    await create(
      "research_task",
      {
        rationale: "Consent lifecycle",
        method_ref: { id: method.id, revision: method.revision },
        acceptance_criteria: ["Check"],
      },
      u,
    ),
    u,
  );
  let r = await req(
    u,
    "POST",
    `${base}/tasks/${o.id}/open`,
    { revision: o.revision, reason: "Open" },
    o.etag,
  );
  assert.equal(r.statusCode, 201, r.body);
  r = await req(
    u,
    "POST",
    `${base}/tasks/${o.id}/assignment`,
    { assignee_id: u.id, purpose: "Will expire" },
    r.json().etag,
  );
  const i = r.json();
  await admin.query(
    "UPDATE task_invitations SET expires_at=now()-interval '1 second' WHERE id=$1",
    [i.id],
  );
  r = await req(
    u,
    "POST",
    `${base}/tasks/${o.id}/assignment/decisions`,
    { invitation_id: i.id, decision: "accept", reason: "Too late" },
    i.etag,
  );
  assert.equal(r.statusCode, 409, r.body);
  let t = (await req(u, "GET", `${base}/tasks/${o.id}`)).json();
  r = await req(
    u,
    "POST",
    `${base}/tasks/${o.id}/assignment`,
    { assignee_id: u.id, purpose: "Replacement invitation" },
    t.etag,
  );
  const j = r.json();
  r = await req(
    u,
    "POST",
    `${base}/tasks/${o.id}/assignment/decisions`,
    { invitation_id: i.id, decision: "accept", reason: "Replaced" },
    i.etag,
  );
  assert.equal(r.statusCode, 412, r.body);
  t = (await req(u, "GET", `${base}/tasks/${o.id}`)).json();
  r = await req(
    u,
    "POST",
    `${base}/tasks/${o.id}/transitions`,
    { action: "cancel", reason: "Work no longer needed" },
    t.etag,
  );
  assert.equal(r.statusCode, 200, r.body);
  r = await req(
    u,
    "POST",
    `${base}/tasks/${o.id}/assignment/decisions`,
    { invitation_id: j.id, decision: "accept", reason: "Cancelled" },
    j.etag,
  );
  assert.equal(r.statusCode, 412, r.body);
});
test("physical artifacts require custody and license; scan leases recover and stale completions are ignored", async () => {
  const physical = await req(reviewer, "POST", `${base}/artifacts`, {
    ...common,
    kind: "physical",
    license: "Inspection only",
    custodian: "Lab custodian",
    location: "Cabinet 3",
    access_protocol: "Book supervised access",
    integrity_metadata: "Sealed sample 004",
  });
  assert.equal(physical.statusCode, 201, physical.body);
  assert.equal(physical.json().artifact.state, "available");
  assert.equal(
    (
      await req(
        reviewer,
        "GET",
        `${base}/artifacts/${physical.json().object.id}/download`,
      )
    ).statusCode,
    404,
  );
  const bytes = Buffer.from("lease recovery sample");
  const a = await register(bytes, {
    filename: "lease.txt",
    media_type: "text/plain",
  });
  assert.equal((await upload(a, bytes)).statusCode, 202);
  const claimed = (await worker.query("SELECT * FROM claim_artifact_scan()"))
    .rows[0];
  assert.equal(claimed.object_id, a.object.id);
  await admin.query(
    "UPDATE artifacts SET lease_until=now()-interval '1 second' WHERE object_id=$1",
    [a.object.id],
  );
  const retried = (await worker.query("SELECT * FROM claim_artifact_scan()"))
    .rows[0];
  assert.equal(retried.object_id, claimed.object_id);
  assert.notEqual(retried.scan_token, claimed.scan_token);
  assert.equal(
    (
      await worker.query(
        "SELECT finish_artifact_scan($1,$2,'clean','obsolete') done",
        [claimed.object_id, claimed.scan_token],
      )
    ).rows[0].done,
    false,
  );
  assert.equal(
    (
      await worker.query(
        "SELECT finish_artifact_scan($1,$2,'scanner_error','Unavailable scanner fixture') done",
        [retried.object_id, retried.scan_token],
      )
    ).rows[0].done,
    true,
  );
  assert.equal(
    (await req(owner, "GET", `${base}/artifacts/${a.object.id}/download`))
      .statusCode,
    404,
  );
});

test("application role cannot forge a clean scan or bypass immutable artifact metadata", async () => {
  await assert.rejects(
    transaction(owner.id, (c) =>
      c.query(
        "UPDATE artifacts SET state='available',scan_verdict='clean' WHERE workspace_id=$1 AND object_id=$2",
        [w, artifact.id],
      ),
    ),
    /insufficient_privilege|permission denied/,
  );
  const r = await req(
    owner,
    "POST",
    `${base}/objects/${artifact.id}/corrections`,
    {
      base_revision: artifact.revision,
      content: artifact.content,
      reason: "Overwrite digest",
    },
    artifact.etag,
  );
  assert.equal(r.statusCode, 409, r.body);
});
