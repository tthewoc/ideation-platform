import { config as dotenv } from "dotenv";
dotenv({ path: ".local/dev.env", quiet: true });
function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
export const config = {
  database: required("DATABASE_URL"),
  authDatabase: required("AUTH_DATABASE_URL"),
  origin: required("APP_ORIGIN"),
  issuer: required("OIDC_ISSUER"),
  clientId: required("OIDC_CLIENT_ID"),
  clientSecret: required("OIDC_CLIENT_SECRET"),
  sessionSecret: required("SESSION_SECRET"),
  local: process.env.LOCAL_DEVELOPMENT === "true",
  mfa: process.env.REQUIRE_ADMIN_MFA === "true",
};
if (config.sessionSecret.length < 32)
  throw new Error("SESSION_SECRET must contain at least 32 characters");
if (
  config.local &&
  (process.env.NODE_ENV === "production" ||
    ![config.origin, config.issuer].every((v) =>
      ["127.0.0.1", "localhost"].includes(new URL(v).hostname),
    ))
)
  throw new Error("Local identity requires loopback development origins");
if (
  !config.local &&
  ![config.origin, config.issuer].every((v) => v.startsWith("https://"))
)
  throw new Error("HTTPS is required outside local development");
