import { config } from "dotenv";
import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
config({ path: ".local/dev.env", quiet: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
await db.connect();
try {
  await db.query("SELECT pg_advisory_lock(374842)");
  for (const role of ["ideator_app", "ideator_auth", "ideator_worker"]) {
    if (
      !(await db.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]))
        .rowCount
    ) {
      const url = new URL(
        process.env[
          role === "ideator_app"
            ? "DATABASE_URL"
            : role === "ideator_auth"
              ? "AUTH_DATABASE_URL"
              : "WORKER_DATABASE_URL"
        ]!,
      );
      const pass = decodeURIComponent(url.password).replaceAll("'", "''");
      await db.query(
        `CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${pass}'`,
      );
    }
  }
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of (await readdir("migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const sql = await readFile(`migrations/${name}`, "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    const old = await db.query(
      "SELECT checksum FROM schema_migrations WHERE name=$1",
      [name],
    );
    if (old.rowCount) {
      if (old.rows[0].checksum !== hash)
        throw new Error(`Applied migration changed: ${name}`);
      continue;
    }
    await db.query("BEGIN");
    try {
      await db.query(sql);
      await db.query(
        "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
        [name, hash],
      );
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    }
    console.log(`Applied ${name}`);
  }
} finally {
  await db.end();
}
