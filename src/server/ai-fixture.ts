import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "./config.js";
import { transaction, fail, missing } from "./db.js";
import {
  workspace,
  mutation,
  params,
  audit,
  precondition,
  etag,
} from "./api.js";
import { uuid, ref, reason, claim } from "./schema.js";
import { pinned, requireFreshInputs } from "./graph-core.js";
export const fixtureCandidate = z
  .object({ type: z.literal("claim"), content: claim })
  .strict();
export function generateFixture(manifest: any[], inputRefs: any[]) {
  // Deterministic test adapter: data is never interpreted as instructions or tools.
  return [
    {
      type: "claim",
      content: {
        title: "Local workflow fixture — review required",
        body: "Deterministic workflow fixture. No AI model or scientific inference was used.",
        language: "en",
        source_refs: inputRefs,
        proposition: `Unverified test restatement of supplied input: ${String(manifest[0].content.proposition ?? manifest[0].content.body ?? manifest[0].content.title).slice(0, 240)}`,
        scope: "Local pipeline testing only; not a scientific finding",
        qualifiers: [
          "Fixture output, not a model-generated recommendation",
          "Independent review and separate publication required",
        ],
      },
    },
  ];
}
export async function deliverFixture(pool: pg.Pool) {
  if (!config.local) return false;
  await pool.query("SELECT expire_fixture_runs()");
  const run = (await pool.query("SELECT * FROM claim_fixture_run()")).rows[0];
  if (!run) return false;
  try {
    const candidates = z
      .array(fixtureCandidate)
      .min(1)
      .max(10)
      .parse(generateFixture(run.manifest, run.input_refs));
    const supplied = new Set(
      run.input_refs.map((r: any) => `${r.id}:${r.revision}`),
    );
    for (const candidate of candidates)
      if (
        candidate.content.source_refs.some(
          (r) => !supplied.has(`${r.id}:${r.revision}`),
        )
      )
        throw new Error("Unsupplied reference");
    const outputUnits = Buffer.byteLength(JSON.stringify(candidates));
    await pool.query("SELECT finish_fixture_run($1,$2,$3,$4)", [
      run.id,
      run.token,
      JSON.stringify(candidates),
      outputUnits,
    ]);
  } catch {
    await pool.query("SELECT fail_fixture_run($1,$2)", [run.id, run.token]);
  }
  return true;
}
export async function installFixture(app: FastifyInstance) {
  app.get("/v1/ai/capabilities", async () => ({
    live_ai: false,
    review_window_days: config.local ? config.fixtureReviewDays : null,
    local_fixture: config.local,
    adapter: config.local ? "fixture-v1" : null,
  }));
  if (!config.local) return;
  app.post("/v1/workspaces/:w/ai/intake", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const b = z
        .object({
          adapter: z.literal("fixture-v1"),
          acknowledged_test: z.literal(true),
          previous_proposal: z
            .object({ id: uuid, version: z.number().int().positive() })
            .strict()
            .optional(),
          input_refs: z.array(ref).min(1).max(20),
          reviewer_id: uuid,
          instruction: reason.max(2000),
          input_budget: z.number().int().min(1).max(16000).default(16000),
          output_budget: z.number().int().min(1).max(2000).default(2000),
        })
        .strict()
        .parse(req.body);
      const refs = [
        ...new Map(
          b.input_refs.map((r) => [`${r.id}:${r.revision}`, r]),
        ).values(),
      ];
      for (const r of refs) {
        const p = await pinned(c, w, r);
        if (p.validity !== "active" || p.current_revision !== r.revision)
          fail(
            409,
            "stale_inputs",
            "Fixture inputs must be current and active",
          );
      }
      const usage =
        (
          await c.query(
            "SELECT allocated_units FROM ai_usage WHERE workspace_id=$1 AND day=current_date",
            [w],
          )
        ).rows[0]?.allocated_units ?? 0;
      if (usage + b.input_budget + b.output_budget > 100000)
        fail(429, "fixture_budget", "Daily local-test quota exhausted");
      let previous;
      if (b.previous_proposal) {
        previous =
          (
            await c.query(
              "SELECT *, (published_refs IS NULL AND expires_at<=clock_timestamp()) AS expired FROM ai_proposals WHERE workspace_id=$1 AND id=$2",
              [w, b.previous_proposal.id],
            )
          ).rows[0] ?? missing();
        if (previous.expired)
          fail(
            409,
            "proposal_expired",
            "The previous proposal review window expired; start a new independent run",
          );
        if (previous.requester_id !== req.session!.user_id)
          fail(403, "forbidden", "Only the original requester may resubmit");
        if (
          previous.version !== b.previous_proposal.version ||
          !["rejected", "deferred", "needs_evidence"].includes(
            previous.disposition,
          ) ||
          previous.published_refs
        )
          fail(
            409,
            "invalid_resubmission",
            "Select a current rejected, deferred or needs-evidence proposal",
          );
        if (previous.reviewer_id !== b.reviewer_id)
          fail(
            409,
            "reviewer_changed",
            "Linked resubmission retains the independent reviewer",
          );
      }
      await c.query("SELECT set_config('app.fixture_review_days',$1,true)", [
        String(config.fixtureReviewDays),
      ]);
      const args = [
        w,
        b.reviewer_id,
        b.instruction,
        JSON.stringify(refs),
        b.input_budget,
        b.output_budget,
      ];
      const id = (
        await c.query(
          previous
            ? "SELECT resubmit_fixture_run($1,$7,$8,$2,$3,$4,$5,$6) id"
            : "SELECT queue_fixture_run($1,$2,$3,$4,$5,$6) id",
          previous ? [...args, previous.id, previous.version] : args,
        )
      ).rows[0].id;
      const expires = (
        await c.query("SELECT review_expires_at FROM ai_runs WHERE id=$1", [id])
      ).rows[0].review_expires_at;
      await audit(c, req, w, "ai.fixture_queued", id);
      return {
        body: {
          id,
          state: "queued",
          etag: etag(1),
          adapter: "fixture-v1",
          review_expires_at: expires,
        },
        status: 202,
      };
    }),
  );
  app.get("/v1/workspaces/:w/ai/runs", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const { w } = params(req);
      await workspace(c, w);
      return {
        items: (
          await c.query(
            "SELECT id,requester_id,adapter,state,version,input_units,output_units,deadline,review_expires_at,created_at FROM ai_runs WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 25",
            [w],
          )
        ).rows.map((r) => ({ ...r, etag: etag(r.version) })),
      };
    }),
  );
  app.post("/v1/workspaces/:w/ai/runs/:id/cancel", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      z.object({ reason }).strict().parse(req.body);
      const r =
        (
          await c.query(
            "SELECT * FROM ai_runs WHERE workspace_id=$1 AND id=$2",
            [w, uuid.parse(params(req).id)],
          )
        ).rows[0] ?? missing();
      precondition(req, r.version);
      if (r.requester_id !== req.session!.user_id)
        fail(403, "forbidden", "Only the requester may cancel");
      if (!["queued", "running"].includes(r.state))
        fail(409, "terminal_run", "Run is already terminal");
      await c.query("SELECT cancel_fixture_run($1,$2,$3)", [
        w,
        r.id,
        r.version,
      ]);
      await audit(c, req, w, "ai.cancelled", r.id);
      return { body: { id: r.id, state: "cancelled" } };
    }),
  );
  app.get("/v1/workspaces/:w/ai/proposals", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const { w } = params(req);
      await workspace(c, w);
      return {
        items: (
          await c.query(
            "SELECT *, (published_refs IS NULL AND expires_at<=clock_timestamp()) AS expired FROM ai_proposals WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 25",
            [w],
          )
        ).rows.map((p) => ({ ...p, etag: etag(p.version) })),
      };
    }),
  );
  app.get("/v1/workspaces/:w/ai/proposals/:id/history", async (req) =>
    transaction(req.session!.user_id, async (c) => {
      const { w, id } = params(req);
      await workspace(c, w);
      const proposal =
        (
          await c.query(
            "SELECT *, (published_refs IS NULL AND expires_at<=clock_timestamp()) AS expired FROM ai_proposals WHERE workspace_id=$1 AND id=$2",
            [w, uuid.parse(id)],
          )
        ).rows[0] ?? missing();
      const run =
        (
          await c.query(
            "SELECT id,adapter,instruction,input_refs,manifest,provenance,previous_proposal_id,input_budget,output_budget,input_units,output_units,state,created_at FROM ai_runs WHERE workspace_id=$1 AND id=$2",
            [w, proposal.run_id],
          )
        ).rows[0] ?? missing();
      const decisions = (
        await c.query(
          "SELECT id,actor_id,decision,reason,created_at FROM ai_decisions WHERE workspace_id=$1 AND proposal_id=$2 ORDER BY created_at,id",
          [w, proposal.id],
        )
      ).rows;
      return {
        run,
        decisions,
        expires_at: proposal.expires_at,
        expired: proposal.expired,
      };
    }),
  );
  app.post("/v1/workspaces/:w/ai/proposals/:id/decisions", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      const b = z
        .object({
          decision: z.enum([
            "accepted",
            "rejected",
            "deferred",
            "needs_evidence",
          ]),
          reason,
          conflict_declaration: z.literal("none"),
        })
        .strict()
        .parse(req.body);
      const p =
        (
          await c.query(
            "SELECT *, (published_refs IS NULL AND expires_at<=clock_timestamp()) AS expired FROM ai_proposals WHERE workspace_id=$1 AND id=$2",
            [w, uuid.parse(params(req).id)],
          )
        ).rows[0] ?? missing();
      precondition(req, p.version);
      if (p.expired)
        fail(
          409,
          "proposal_expired",
          "The proposal review window expired; start a new independent run",
        );
      if (p.disposition !== "pending")
        fail(409, "already_decided", "Proposal already has a disposition");
      if (
        p.reviewer_id !== req.session!.user_id ||
        p.requester_id === req.session!.user_id
      )
        fail(
          403,
          "independence_required",
          "The named independent reviewer must decide",
        );
      if (b.decision === "accepted")
        for (const candidate of p.candidates)
          await requireFreshInputs(
            c,
            w,
            fixtureCandidate.parse(candidate).content,
          );
      await c.query("SELECT decide_fixture_proposal($1,$2,$3,$4,$5)", [
        w,
        p.id,
        p.version,
        b.decision,
        b.reason,
      ]);
      await audit(c, req, w, "ai.proposal_decided", p.id);
      return {
        body: { id: p.id, disposition: b.decision, etag: etag(p.version + 1) },
      };
    }),
  );
  app.post("/v1/workspaces/:w/ai/proposals/:id/publish", async (req, reply) =>
    mutation(req, reply, async (c, w) => {
      z.object({ confirmation: z.literal(true) })
        .strict()
        .parse(req.body);
      const p =
        (
          await c.query(
            "SELECT *, (published_refs IS NULL AND expires_at<=clock_timestamp()) AS expired FROM ai_proposals WHERE workspace_id=$1 AND id=$2",
            [w, uuid.parse(params(req).id)],
          )
        ).rows[0] ?? missing();
      precondition(req, p.version);
      if (p.expired)
        fail(
          409,
          "proposal_expired",
          "The proposal review window expired; start a new independent run",
        );
      if (p.requester_id !== req.session!.user_id)
        fail(403, "forbidden", "Only the requester may publish");
      if (p.disposition !== "accepted" || p.published_refs)
        fail(
          409,
          "not_accepted",
          "An accepted unpublished proposal is required",
        );
      const run = (
          await c.query("SELECT * FROM ai_runs WHERE id=$1", [p.run_id])
        ).rows[0],
        ws = await workspace(c, w);
      if (
        run.state !== "succeeded" ||
        run.policy_version !== ws.version ||
        run.content_epoch !== ws.content_epoch
      )
        fail(
          409,
          "stale_proposal",
          "Inputs or permissions changed; request a new run",
        );
      for (const candidate of p.candidates)
        await requireFreshInputs(
          c,
          w,
          fixtureCandidate.parse(candidate).content,
        );
      const refs = (
        await c.query("SELECT publish_fixture_proposal($1,$2,$3) refs", [
          w,
          p.id,
          p.version,
        ])
      ).rows[0].refs;
      await audit(c, req, w, "ai.batch_published", p.id);
      return { body: { id: p.id, published_refs: refs }, status: 201 };
    }),
  );
}
