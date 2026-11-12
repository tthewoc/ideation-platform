import { mkdir, writeFile, access } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
await mkdir(".local", { recursive: true, mode: 0o700 });
try {
  await access(".local/dev.env");
} catch {
  const password = randomBytes(24).toString("hex");
  await writeFile(
    ".local/dev.env",
    `DB_PASSWORD=${password}\nDATABASE_ADMIN_URL=postgres://postgres:${password}@127.0.0.1:55432/ideator\nDATABASE_URL=postgres://ideator_app:${password}@127.0.0.1:55432/ideator\nAUTH_DATABASE_URL=postgres://ideator_auth:${password}@127.0.0.1:55432/ideator\nWORKER_DATABASE_URL=postgres://ideator_worker:${password}@127.0.0.1:55432/ideator\nAPP_ORIGIN=http://127.0.0.1:3000\nOIDC_ISSUER=http://127.0.0.1:3001\nOIDC_CLIENT_ID=ideator-local\nOIDC_CLIENT_SECRET=${randomBytes(24).toString("hex")}\nSESSION_SECRET=${randomBytes(32).toString("hex")}\nLOCAL_DEVELOPMENT=true\n`,
    { mode: 0o600 },
  );
}
const result = spawnSync(
  "docker",
  ["compose", "--env-file", ".local/dev.env", "up", "-d", "--wait"],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
await import("./migrate.js");
const { SCANNER_IMAGE } = await import("../src/server/artifact-scanner.js");
const scanner = spawnSync("docker", ["pull", SCANNER_IMAGE], {
  stdio: "inherit",
});
if (scanner.status !== 0)
  throw new Error("Could not prepare the local artifact scanner");
