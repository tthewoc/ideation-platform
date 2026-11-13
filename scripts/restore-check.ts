import { config } from "dotenv";
import { spawnSync } from "node:child_process";
import { writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import pg from "pg";
import { join } from "node:path";
import { readArtifact, digest } from "../src/server/artifact-storage.js";
config({ path: ".local/dev.env", quiet: true });
function docker(args: string[], input?: Buffer) {
  const r = spawnSync(
    "docker",
    ["compose", "--env-file", ".local/dev.env", "exec", "-T", "db", ...args],
    { input, maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return r.stdout;
}
const target = `ideator_restore_${randomUUID().replaceAll("-", "")}`;
const dump = docker(["pg_dump", "-U", "postgres", "-d", "ideator", "-Fc"]);
await writeFile(".local/restore-check.dump", dump, { mode: 0o600 });
docker(["createdb", "-U", "postgres", target]);
try {
  docker(
    ["pg_restore", "-U", "postgres", "-d", target, "--exit-on-error"],
    dump,
  );
  const adminUrl = new URL(process.env.DATABASE_ADMIN_URL!);
  adminUrl.pathname = `/${target}`;
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.pathname = `/${target}`;
  const admin = new pg.Client({ connectionString: adminUrl.href }),
    runtime = new pg.Client({ connectionString: appUrl.href });
  await admin.connect();
  await runtime.connect();
  try {
    const revisions = await admin.query(
      "SELECT count(*)::int n FROM revisions",
    );
    assert.ok(
      revisions.rows[0].n > 0,
      "Run integration tests before the restore drill",
    );
    assert.equal(
      (
        await admin.query(
          "SELECT 1 FROM publications p LEFT JOIN revisions r USING(workspace_id,object_id,revision) WHERE r.object_id IS NULL",
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await admin.query(
          "SELECT 1 FROM audit_events a LEFT JOIN outbox o ON o.event_id=a.id WHERE o.event_id IS NULL",
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await admin.query(
          "SELECT 1 FROM lineage l LEFT JOIN publications p ON p.workspace_id=l.workspace_id AND p.object_id=l.input_id AND p.revision=l.input_revision WHERE p.object_id IS NULL",
        )
      ).rowCount,
      0,
    );
    await runtime.query("BEGIN");
    await runtime.query("SELECT set_config('app.actor',$1,true)", [
      randomUUID(),
    ]);
    assert.equal((await runtime.query("SELECT * FROM revisions")).rowCount, 0);
    for (const table of [
      "edges",
      "edge_revisions",
      "reviews",
      "submissions",
      "lineage",
      "equivalences",
      "tasks",
      "task_invitations",
      "task_events",
      "task_results",
      "artifacts",
      "artifact_events",
      "search_documents",
      "search_state",
      "search_cursors",
      "export_jobs",
      "export_policies",
      "export_policy_events",
      "revision_embeddings",
      "ai_usage",
      "ai_runs",
      "ai_proposals",
      "ai_decisions",
      "ai_publications",
    ])
      assert.equal((await runtime.query(`SELECT * FROM ${table}`)).rowCount, 0);
    await runtime.query("ROLLBACK");
    const sample = (
      await admin.query(
        "SELECT o.author_id,o.id FROM objects o JOIN memberships m ON m.workspace_id=o.workspace_id AND m.user_id=o.author_id WHERE m.revoked_at IS NULL LIMIT 1",
      )
    ).rows[0];
    assert.ok(sample);
    await runtime.query("BEGIN");
    await runtime.query("SELECT set_config('app.actor',$1,true)", [
      sample.author_id,
    ]);
    assert.ok(
      (
        await runtime.query("SELECT * FROM revisions WHERE object_id=$1", [
          sample.id,
        ])
      ).rowCount,
    );
    await runtime.query("ROLLBACK");
    const blobBackup = await mkdtemp(".local/restore-artifacts-");
    let restoredBlobs = 0;
    try {
      const blobs = await admin.query(
        "SELECT a.storage_key,r.content FROM artifacts a JOIN revisions r ON r.object_id=a.object_id AND r.revision=1 WHERE a.storage_key IS NOT NULL",
      );
      for (const a of blobs.rows) {
        const bytes = await readArtifact(a.storage_key);
        const targetFile = join(blobBackup, a.storage_key);
        await writeFile(targetFile, bytes, { mode: 0o600, flag: "wx" });
        const restored = await readFile(targetFile);
        assert.equal(digest(restored), a.content.sha256);
        assert.equal(restored.length, a.content.byte_size);
        restoredBlobs++;
      }
    } finally {
      await rm(blobBackup, { recursive: true, force: true });
    }
    console.log(
      `Restored and verified ${restoredBlobs} artifact blobs against immutable manifests.`,
    );
    assert.equal(
      (
        await admin.query(
          "SELECT 1 FROM search_documents d LEFT JOIN publications p ON p.workspace_id=d.workspace_id AND p.object_id=d.object_id AND p.revision=d.revision WHERE p.object_id IS NULL",
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await admin.query(
          "SELECT 1 FROM revision_embeddings e JOIN revisions r ON r.workspace_id=e.workspace_id AND r.object_id=e.object_id AND r.revision=e.revision WHERE e.content_sha256<>encode(sha256(convert_to(r.content::text,'UTF8')),'hex')",
        )
      ).rowCount,
      0,
    );
    const original = (
      await admin.query("SELECT count(*)::int n FROM event_receipts")
    ).rows[0].n;
    await admin.query(
      "INSERT INTO event_receipts(event_id) SELECT event_id FROM outbox ON CONFLICT DO NOTHING",
    );
    await admin.query(
      "INSERT INTO event_receipts(event_id) SELECT event_id FROM outbox ON CONFLICT DO NOTHING",
    );
    assert.equal(
      (
        await admin.query(
          "SELECT event_id FROM event_receipts GROUP BY event_id HAVING count(*)>1",
        )
      ).rowCount,
      0,
    );
    console.log(
      `Restore passed: ${revisions.rows[0].n} revisions, source integrity, audit/outbox links, runtime RLS and receipt deduplication (${original} prior receipts).`,
    );
  } finally {
    await admin.end();
    await runtime.end();
  }
} finally {
  docker(["dropdb", "-U", "postgres", target]);
}
