import { createServer } from "node:http";
import Provider from "oidc-provider";
import { config } from "../src/server/config.js";
if (!config.local)
  throw new Error("Synthetic identity provider requires local development");
const provider = new Provider(config.issuer, {
  clients: [
    {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uris: [`${config.origin}/auth/callback`],
      response_types: ["code"],
      grant_types: ["authorization_code"],
      token_endpoint_auth_method: "client_secret_post",
    },
  ],
  claims: { openid: ["sub"], profile: ["name"] },
  features: { devInteractions: { enabled: false } },
  pkce: { required: () => true },
  findAccount: async (_ctx, id) => ({
    accountId: id,
    claims: async () => ({ sub: id, name: id.split(":").at(-1) }),
  }),
  interactions: {
    url: (_ctx, interaction) => `/interaction/${interaction.uid}`,
  },
});
const server = createServer(async (req, res) => {
  try {
    if (req.url?.startsWith("/interaction/")) {
      const detail = await provider.interactionDetails(req, res);
      if (req.method === "POST") {
        const data: Buffer[] = [];
        for await (const chunk of req) {
          data.push(chunk);
          if (Buffer.concat(data).length > 1000)
            throw new Error("Request too large");
        }
        const name = new URLSearchParams(Buffer.concat(data).toString()).get(
          "account",
        );
        if (!["Alice", "Bob", "Eve"].includes(name ?? ""))
          throw new Error("Unknown synthetic identity");
        const group =
          req.headers.cookie?.match(
            /(?:^|; )ideator_test_group=([a-zA-Z0-9_-]{1,100})(?:;|$)/,
          )?.[1] ?? "default";
        await provider.interactionFinished(
          req,
          res,
          {
            login: {
              accountId: process.env.IDEATOR_TEST_NAMESPACE
                ? `${process.env.IDEATOR_TEST_NAMESPACE}:${group}:${name}`
                : name!,
            },
          },
          { mergeWithLastSubmission: false },
        );
        return;
      }
      if (detail.prompt.name === "consent") {
        const grant = new provider.Grant({
          accountId: detail.session!.accountId,
          clientId: config.clientId,
        });
        grant.addOIDCScope("openid profile");
        await provider.interactionFinished(
          req,
          res,
          { consent: { grantId: await grant.save() } },
          { mergeWithLastSubmission: true },
        );
        return;
      }
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><html lang="en"><title>Local development identity</title><main><h1>Local development identity</h1><p>Synthetic accounts for local testing only.</p><form method="post">' +
          ["Alice", "Bob", "Eve"]
            .map(
              (n) =>
                `<button name="account" value="${n}">Continue as ${n}</button>`,
            )
            .join(" ") +
          "</form></main></html>",
      );
      return;
    }
    provider.callback()(req, res);
  } catch {
    res.statusCode = 400;
    res.end("Identity request failed");
  }
});
server.listen(3001, "127.0.0.1");
