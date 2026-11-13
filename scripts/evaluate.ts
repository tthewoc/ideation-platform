import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluate, markdown } from "../src/evaluation/report.js";
const args = process.argv.slice(2);
const allowed = new Set(["--corpus", "--manifest", "--evidence", "--out"]);
const options = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
  if (
    !allowed.has(args[i]) ||
    !args[i + 1] ||
    args[i + 1].startsWith("--") ||
    options.has(args[i])
  )
    throw new Error(
      "Usage: npm run evaluate -- [--corpus path --manifest path --evidence path --out directory]",
    );
  options.set(args[i], args[i + 1]);
}
async function read(path: string) {
  const text = await readFile(path, "utf8");
  if (Buffer.byteLength(text) > 16 * 1024 * 1024)
    throw new Error("Evaluation inputs must be at most 16 MiB each");
  return text;
}
const corpus = await read(
  options.get("--corpus") ?? "docs/evaluation/corpus-v1.json",
);
const manifest = JSON.parse(
  await read(options.get("--manifest") ?? "docs/evaluation/manifest-v1.json"),
);
const evidence = options.has("--evidence")
  ? JSON.parse(await read(options.get("--evidence")!))
  : undefined;
const report = evaluate(corpus, manifest, evidence);
const out = resolve(options.get("--out") ?? `.local/evaluation-${Date.now()}`);
await mkdir(out, { recursive: true, mode: 0o700 });
await writeFile(
  resolve(out, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
  { mode: 0o600, flag: "wx" },
);
await writeFile(resolve(out, "report.md"), markdown(report), {
  mode: 0o600,
  flag: "wx",
});
console.log(
  `${report.quality_gate_passed ? "PASS" : "BLOCKED"}: ${report.blockers.length} blockers. Reports: ${out}`,
);
process.exitCode = report.quality_gate_passed ? 0 : 2;
