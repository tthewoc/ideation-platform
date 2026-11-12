import type pg from "pg";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { readArtifact, digest, validMedia } from "./artifact-storage.js";
export const SCANNER_IMAGE =
  "clamav/clamav@sha256:cbc30de94b6e9b33ac14136ff45306cee02a1f9ae522394a3cc5b9215d1affe9";
export async function scanBytes(
  bytes: Buffer,
): Promise<{ verdict: string; engine: string }> {
  const local = config.local,
    name = `ideator-scan-${randomUUID()}`;
  const args = local
    ? [
        "run",
        "--rm",
        "-i",
        "--name",
        name,
        "--network",
        "none",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=16m",
        "--memory",
        "1536m",
        "--cpus",
        "1",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--entrypoint",
        "clamscan",
        SCANNER_IMAGE,
        "--stdout",
        "--no-summary",
        "-",
      ]
    : ["--stdout", "--no-summary", "--fail-if-cvd-older-than=7", "-"];
  return new Promise((resolve) => {
    let done = false;
    const child = spawn(local ? "docker" : "clamscan", args, {
      stdio: ["pipe", "ignore", "ignore"],
    });
    const finish = (verdict: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        verdict,
        engine: local ? SCANNER_IMAGE : "clamscan: system-managed signatures",
      });
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      if (local) {
        const cleanup = spawn("docker", ["rm", "-f", name], {
          stdio: "ignore",
        });
        cleanup.on("error", () => {});
      }
      finish("scanner_error");
    }, 60000);
    child.on("error", () => finish("scanner_error"));
    child.on("close", (code) =>
      finish(code === 0 ? "clean" : code === 1 ? "malware" : "scanner_error"),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(bytes);
  });
}
export async function scanPendingArtifact(pool: pg.Pool) {
  const a = (await pool.query("SELECT * FROM claim_artifact_scan()")).rows[0];
  if (!a) return false;
  let verdict = "scanner_error",
    engine = "not run";
  try {
    const bytes = await readArtifact(a.storage_key);
    if (
      bytes.length !== a.content.byte_size ||
      digest(bytes) !== a.content.sha256
    )
      verdict = "integrity_mismatch";
    else if (!validMedia(bytes, a.content.media_type)) verdict = "invalid_type";
    else ({ verdict, engine } = await scanBytes(bytes));
  } catch {
    /* Fail closed; do not log uploaded content or filesystem paths. */
  }
  await pool.query("SELECT finish_artifact_scan($1,$2,$3,$4)", [
    a.object_id,
    a.scan_token,
    verdict,
    engine,
  ]);
  return true;
}
