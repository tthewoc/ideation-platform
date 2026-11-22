import {
  mkdir,
  writeFile,
  readFile,
  opendir,
  stat,
  rm,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { uuid } from "./schema.js";
import type pg from "pg";
export const MAX_ARTIFACT_BYTES = 1024 * 1024;
export const storageRoot = () =>
  resolve(process.env.ARTIFACT_STORAGE_ROOT ?? ".local/artifacts");
const path = (key: string) => join(storageRoot(), uuid.parse(key));
export async function storeArtifact(key: string, bytes: Buffer) {
  await mkdir(storageRoot(), { recursive: true, mode: 0o700 });
  await writeFile(path(key), bytes, { flag: "wx", mode: 0o600 });
}
export async function readArtifact(key: string) {
  const b = await readFile(path(key));
  if (b.length > MAX_ARTIFACT_BYTES)
    throw new Error("Oversized stored artifact");
  return b;
}
export const digest = (b: Buffer) =>
  createHash("sha256").update(b).digest("hex");
export function validMedia(b: Buffer, media: string) {
  try {
    const t = new TextDecoder("utf-8", { fatal: true }).decode(b);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(t)) return false;
    // These formats are downloaded only as attachments, never interpreted as markup.
    if (/^\s*(?:<!doctype\s+html|<html|<script|<svg|<\?xml)/i.test(t))
      return false;
    if (media === "application/json") JSON.parse(t);
    return ["text/plain", "text/csv", "application/json"].includes(media);
  } catch {
    return false;
  }
}

export async function reconcileArtifactStorage(
  pool: pg.Pool,
  root = storageRoot(),
) {
  const cutoff = Date.now() - 3600000;
  await mkdir(root, { recursive: true, mode: 0o700 });
  for await (const entry of await opendir(root)) {
    if (!entry.isFile() || !uuid.safeParse(entry.name).success) continue;
    const file = join(root, entry.name);
    const info = await stat(file).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
    });
    if (!info || info.mtimeMs > cutoff) continue;
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const locked = await c.query(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1,1)) AS ok",
        [entry.name],
      );
      if (
        locked.rows[0].ok &&
        !(
          await c.query("SELECT artifact_blob_referenced($1) AS present", [
            entry.name,
          ])
        ).rows[0].present
      )
        await rm(file, { force: true });
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
}
