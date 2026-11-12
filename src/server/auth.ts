import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomBytes, createHash } from "node:crypto";
import * as oidc from "openid-client";
import { config } from "./config.js";
import { authDb, fail } from "./db.js";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export type Session = {
  user_id: string;
  name: string;
  csrf: string;
  amr: string[];
  auth_time: number | null;
};
declare module "fastify" {
  interface FastifyRequest {
    session: Session | null;
  }
}
const cookies = {
  httpOnly: true,
  secure: !config.local,
  sameSite: "lax" as const,
  path: "/",
};
let provider: Promise<oidc.Configuration> | undefined;
function client() {
  return (provider ??= oidc.discovery(
    new URL(config.issuer),
    config.clientId,
    config.clientSecret,
    undefined,
    config.local ? { execute: [oidc.allowInsecureRequests] } : undefined,
  ));
}
export async function installAuth(app: FastifyInstance) {
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith("/v1") || req.url.startsWith("/auth"))
      reply.header("Cache-Control", "no-store");
    if (req.cookies.session) {
      const r = await authDb.query(
        "SELECT s.*,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now()",
        [hash(req.cookies.session)],
      );
      req.session = r.rows[0] ?? null;
    }
    if (req.url.startsWith("/v1")) {
      if (!req.session)
        fail(401, "authentication_required", "Sign in to continue");
      if (
        !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        (req.headers.origin !== config.origin ||
          req.headers["x-csrf-token"] !== req.session!.csrf)
      )
        fail(403, "csrf_failed", "Refresh the page and try again");
    }
  });
  app.get("/auth/login", async (req, reply) => {
    const c = await client();
    const state = oidc.randomState(),
      nonce = oidc.randomNonce(),
      verifier = oidc.randomPKCECodeVerifier(),
      id = randomBytes(32).toString("hex");
    await authDb.query(
      "INSERT INTO oauth_states(id,data,expires_at) VALUES($1,$2,now()+interval '10 minutes')",
      [hash(id), { state, nonce, verifier }],
    );
    const url = oidc.buildAuthorizationUrl(c, {
      redirect_uri: `${config.origin}/auth/callback`,
      scope: "openid profile",
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
    });
    reply
      .setCookie("login", id, { ...cookies, maxAge: 600 })
      .redirect(url.href);
  });
  app.get("/auth/callback", async (req, reply) => {
    const id = req.cookies.login;
    if (!id) fail(400, "login_expired", "Please sign in again");
    const r = await authDb.query(
      "DELETE FROM oauth_states WHERE id=$1 AND expires_at>now() RETURNING data",
      [hash(id)],
    );
    reply.clearCookie("login", cookies);
    if (!r.rowCount) fail(400, "login_expired", "Please sign in again");
    const d = r.rows[0].data;
    const tokens = await oidc.authorizationCodeGrant(
      await client(),
      new URL(req.url, config.origin),
      {
        pkceCodeVerifier: d.verifier,
        expectedState: d.state,
        expectedNonce: d.nonce,
      },
    );
    const claims = tokens.claims()!;
    const profile = tokens.access_token
      ? await oidc.fetchUserInfo(
          await client(),
          tokens.access_token,
          claims.sub,
        )
      : claims;
    const user = await authDb.query(
      "INSERT INTO users(issuer,subject,name) VALUES($1,$2,$3) ON CONFLICT(issuer,subject) DO UPDATE SET name=excluded.name RETURNING id",
      [
        config.issuer,
        claims.sub,
        String(profile.name ?? claims.name ?? claims.sub).slice(0, 200),
      ],
    );
    if (req.cookies.session)
      await authDb.query("DELETE FROM sessions WHERE token_hash=$1", [
        hash(req.cookies.session),
      ]);
    const token = randomBytes(32).toString("hex");
    await authDb.query(
      "INSERT INTO sessions(token_hash,user_id,csrf,expires_at,amr,auth_time) VALUES($1,$2,$3,now()+interval '8 hours',$4,$5)",
      [
        hash(token),
        user.rows[0].id,
        randomBytes(32).toString("hex"),
        JSON.stringify(claims.amr ?? []),
        claims.auth_time ?? null,
      ],
    );
    reply
      .setCookie("session", token, { ...cookies, maxAge: 28800 })
      .redirect("/");
  });
  app.post("/v1/logout", async (req, reply) => {
    await authDb.query("DELETE FROM sessions WHERE token_hash=$1", [
      hash(req.cookies.session!),
    ]);
    reply.clearCookie("session", cookies).code(204).send();
  });
}
export function requireMfa(req: FastifyRequest) {
  if (
    config.mfa &&
    (!req.session?.amr.includes("mfa") ||
      !req.session.auth_time ||
      Date.now() / 1000 - req.session.auth_time > 300)
  )
    fail(403, "mfa_required", "Fresh MFA is required for this action");
}
