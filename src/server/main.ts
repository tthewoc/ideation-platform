import { buildApp } from "./app.js";
import { config } from "./config.js";
import { db, authDb } from "./db.js";
const app = await buildApp(true);
await app.listen({
  host: "127.0.0.1",
  port: Number(new URL(config.origin).port) || 3000,
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    await db.end();
    await authDb.end();
    process.exit(0);
  });
