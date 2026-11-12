import pg from "pg";
import { config } from "./config.js";
export const db = new pg.Pool({ connectionString: config.database, max: 10 });
export const authDb = new pg.Pool({
  connectionString: config.authDatabase,
  max: 4,
});
export async function transaction<T>(
  actor: string,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "SELECT set_config('app.actor',$1,true),set_config('statement_timeout','5000',true)",
      [actor],
    );
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function fail(status: number, code: string, message: string): never {
  throw new HttpError(status, code, message);
}
export const missing = () => fail(404, "not_found", "Resource not found");
