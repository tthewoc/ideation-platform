import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import { resolve } from "node:path";
import { ZodError } from "zod";
import { installAuth } from "./auth.js";
import { installApi } from "./api.js";
import { installGraph } from "./graph.js";
import { installArtifacts } from "./artifacts.js";
import { installRetrieval } from "./retrieval.js";
import { installIntakeOutline } from "./intake-outline.js";
import { installIntake } from "./intake.js";
import { installFixture } from "./ai-fixture.js";
import { installExports } from "./exports.js";
import { installResearch } from "./research.js";
import { installReviews } from "./reviews.js";
import { HttpError } from "./db.js";
import { config } from "./config.js";
export async function buildApp(logging = false) {
  const app = Fastify({
    logger: logging
      ? {
          redact: ["req.headers.cookie", "req.headers.authorization"],
          serializers: {
            req: (r) => ({ method: r.method, url: r.url?.split("?")[0] }),
          },
        }
      : false,
    bodyLimit: 128 * 1024,
    requestTimeout: 10000,
  });
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        upgradeInsecureRequests: config.local ? null : [],
      },
    },
  });
  await app.register(rateLimit, {
    hook: "preHandler",
    max: (req) => (["GET", "HEAD"].includes(req.method) ? 120 : 30),
    timeWindow: "1 minute",
    keyGenerator: (req) =>
      `${req.session?.user_id ?? req.ip}:${["GET", "HEAD"].includes(req.method) ? "read" : "write"}`,
  });
  await installAuth(app);
  app.setErrorHandler((error, req, reply) => {
    const e = error as Error & { code?: string; statusCode?: number };
    const status =
      e instanceof HttpError
        ? e.status
        : e instanceof ZodError
          ? 422
          : e.code === "57014"
            ? 503
            : e.code === "23503" || e.code === "23505" || e.code === "40001"
              ? 409
              : e.code === "42501"
                ? 403
                : (e.statusCode ?? 500);
    if (status >= 500)
      req.log.error({ code: e.code, request_id: req.id }, "Request failed");
    reply.code(status).send({
      error: {
        code:
          e instanceof HttpError
            ? e.code
            : e instanceof ZodError
              ? "validation_error"
              : status >= 500
                ? "internal_error"
                : "request_failed",
        message:
          e instanceof HttpError
            ? e.message
            : e instanceof ZodError
              ? "Check the submitted fields"
              : status >= 500
                ? "Request could not be completed"
                : "Request rejected",
        request_id: req.id,
      },
    });
  });
  app.get("/health", async () => ({ status: "ok" }));
  await installApi(app);
  await installGraph(app);
  await installReviews(app);
  await installArtifacts(app);
  await installResearch(app);
  await installRetrieval(app);
  await installExports(app);
  await installFixture(app);
  await installIntake(app);
  await installIntakeOutline(app);
  await app.register(staticFiles, { root: resolve("dist") });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith("/v1")
      ? reply.code(404).send({
          error: {
            code: "not_found",
            message: "Resource not found",
            request_id: req.id,
          },
        })
      : reply.code(404).send("Page not found"),
  );
  return app;
}
