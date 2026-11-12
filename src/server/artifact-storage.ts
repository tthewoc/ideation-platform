import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { uuid } from "./schema.js";
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
