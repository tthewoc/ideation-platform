import { spawn } from "node:child_process";
const children = [
  "scripts/identity.ts",
  "src/server/main.ts",
  "src/server/worker.ts",
].map((file) =>
  spawn(process.execPath, ["--import", "tsx", file], { stdio: "inherit" }),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    for (const c of children) c.kill("SIGTERM");
  });
for (const child of children)
  child.on("exit", (code) => {
    if (code) {
      for (const c of children) c.kill("SIGTERM");
      process.exitCode = code;
    }
  });
