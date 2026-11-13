import "./config.js";
import { deliverFixture } from "./ai-fixture.js";
import { scanPendingArtifact } from "./artifact-scanner.js";
import pg from "pg";
import { pathToFileURL } from "node:url";
export async function deliver(pool: pg.Pool) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const rows = await c.query(
      "SELECT event_id,workspace_id FROM outbox WHERE delivered_at IS NULL ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 100",
    );
    for (const workspace of new Set(rows.rows.map((r) => r.workspace_id))) {
      await c.query("SELECT refresh_freshness($1)", [workspace]);
    }
    for (const r of rows.rows) {
      await c.query(
        "INSERT INTO event_receipts(event_id) VALUES($1) ON CONFLICT DO NOTHING",
        [r.event_id],
      );
      await c.query("UPDATE outbox SET delivered_at=now() WHERE event_id=$1", [
        r.event_id,
      ]);
    }
    await c.query("SELECT refresh_pending_freshness()");
    await c.query("COMMIT");
    return rows.rowCount;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function deliverDiscovery(pool: pg.Pool) {
  const c = await pool.connect();
  try {
    await c.query("SET statement_timeout='5000'");
    for (const row of (await c.query("SELECT pending_search_workspaces() id"))
      .rows) {
      try {
        await c.query("SELECT rebuild_search_batch($1)", [row.id]);
        await c.query("SELECT report_search_batch($1,true)", [row.id]);
      } catch {
        await c.query("SELECT report_search_batch($1,false)", [row.id]);
        console.error("Search batch deferred after failure");
      }
    }
    for (const row of (await c.query("SELECT pending_export_jobs() id")).rows) {
      try {
        await c.query("SELECT prepare_export($1)", [row.id]);
      } catch {
        await c.query("SELECT fail_export($1)", [row.id]);
        console.error("Export preparation failed closed");
      }
    }
  } finally {
    await c.query("RESET statement_timeout");
    c.release();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const pool = new pg.Pool({
    connectionString: process.env.WORKER_DATABASE_URL,
  });
  let stopped = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      stopped = true;
    });
  while (!stopped) {
    try {
      await deliver(pool);
      await deliverDiscovery(pool);
      await deliverFixture(pool);
      await scanPendingArtifact(pool);
    } catch {
      console.error("Outbox delivery failed; retrying");
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await pool.end();
}
