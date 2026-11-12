import { config } from "dotenv";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import pg from "pg";
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
    await runtime.query("BEGIN");
    await runtime.query("SELECT set_config('app.actor',$1,true)", [
      randomUUID(),
    ]);
    assert.equal((await runtime.query("SELECT * FROM revisions")).rowCount, 0);
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
