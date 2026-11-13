import { useEffect, useState } from "react";
import type { Api } from "./StructuredEditor";
export function ProposalLab({
  base,
  api,
  objects,
  userId,
  onChange,
  onSelect,
}: {
  base: string;
  api: Api;
  objects: any[];
  userId: string;
  onChange: () => Promise<void>;
  onSelect: (o: any) => void;
}) {
  const [enabled, setEnabled] = useState(false),
    [runs, setRuns] = useState<any[]>([]),
    [proposals, setProposals] = useState<any[]>([]),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/v1/ai/capabilities")
      .then((c) => setEnabled(c.local_fixture))
      .catch(() => setEnabled(false));
  }, [base]);
  async function refresh() {
    setRuns((await api(`${base}/ai/runs`)).items);
    setProposals((await api(`${base}/ai/proposals`)).items);
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!enabled) return null;
  return (
    <details className="proposal-lab">
      <summary>Local proposal workflow test — no AI model</summary>
      <section aria-label="Local proposal workflow">
        <h2>Test bounded proposal review</h2>
        <p>
          This deterministic adapter tests permissions, quota, cancellation and
          review. It makes no external calls and performs no model inference.
          Its output is a fixture, not research advice. Live AI and semantic
          ranking remain disabled.
        </p>
        <p role="alert">{error}</p>
        <p role="log" aria-label="Proposal workflow update">
          {message}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(async () => {
              await api(`${base}/ai/intake`, "POST", {
                adapter: "fixture-v1",
                acknowledged_test: true,
                input_refs: f.getAll("inputs").map((v) => {
                  const [id, revision] = String(v).split(":");
                  return { id, revision: Number(revision) };
                }),
                reviewer_id: f.get("reviewer"),
                instruction: f.get("instruction"),
                input_budget: Number(f.get("input_budget")),
                output_budget: Number(f.get("output_budget")),
              });
              setMessage(
                "Local fixture queued. Refresh to inspect its private proposal.",
              );
              await refresh();
            });
          }}
        >
          <label>
            Published inputs for local test
            <select name="inputs" multiple required>
              {objects
                .filter((o) => o.current_revision)
                .map((o) => (
                  <option key={o.id} value={`${o.id}:${o.current_revision}`}>
                    {o.content.title} · r{o.current_revision}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Independent proposal reviewer ID
            <input name="reviewer" required />
          </label>
          <label>
            Workflow test instruction
            <textarea name="instruction" maxLength={2000} required />
          </label>
          <label>
            Input budget (conservative byte units)
            <input
              name="input_budget"
              type="number"
              min={1}
              max={16000}
              defaultValue={16000}
              required
            />
          </label>
          <label>
            Output budget (conservative byte units)
            <input
              name="output_budget"
              type="number"
              min={1}
              max={2000}
              defaultValue={2000}
              required
            />
          </label>
          <p>
            Daily local-test allowance: 100,000 reserved units per workspace.
            Cancellation does not refund the allowance; no currency is charged.
          </p>
          <label className="check">
            <input type="checkbox" required />I understand this is a local test
            adapter, not live AI.
          </label>
          <button disabled={busy}>Queue local proposal test</button>
        </form>
        <button disabled={busy} onClick={() => run(refresh)}>
          Refresh proposal workflow
        </button>
        <h3>Runs</h3>
        <ul>
          {runs.map((r) => (
            <li key={r.id}>
              {r.id.slice(0, 8)} · {r.state} · {r.adapter}
              {r.input_units !== null && ` · input units ${r.input_units}`}
              {r.output_units !== null && ` · output units ${r.output_units}`}
              {r.requester_id === userId &&
                ["queued", "running"].includes(r.state) && (
                  <button
                    onClick={() =>
                      run(async () => {
                        await api(
                          `${base}/ai/runs/${r.id}/cancel`,
                          "POST",
                          { reason: "Requester cancelled local test" },
                          r.etag,
                        );
                        await refresh();
                        setMessage(
                          "Run cancelled. It cannot produce or publish a proposal.",
                        );
                      })
                    }
                  >
                    Cancel run {r.id.slice(0, 8)}
                  </button>
                )}
            </li>
          ))}
        </ul>
        <h3>Private proposals</h3>
        {proposals.map((p) => (
          <article key={p.id} aria-label={`Local proposal ${p.id.slice(0, 8)}`}>
            <h4>
              Proposal {p.id.slice(0, 8)} · {p.disposition}
            </h4>
            {p.candidates.map((candidate: any, i: number) => (
              <div key={i}>
                <strong>{candidate.content.title}</strong>
                <p>{candidate.content.body}</p>
                <p>{candidate.content.proposition}</p>
                <p>{candidate.content.scope}</p>
                <ul>
                  {candidate.content.source_refs.map((r: any) => (
                    <li key={`${r.id}:${r.revision}`}>
                      <button
                        onClick={() =>
                          run(async () =>
                            onSelect(
                              await api(
                                `${base}/objects/${r.id}?revision=${r.revision}`,
                              ),
                            ),
                          )
                        }
                      >
                        Inspect proposal input {r.id.slice(0, 8)} · r
                        {r.revision}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {p.disposition === "pending" && p.reviewer_id === userId && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  run(async () => {
                    await api(
                      `${base}/ai/proposals/${p.id}/decisions`,
                      "POST",
                      {
                        decision: f.get("decision"),
                        reason: f.get("reason"),
                        conflict_declaration: "none",
                      },
                      p.etag,
                    );
                    await refresh();
                    setMessage(
                      "Independent disposition recorded. Nothing was published.",
                    );
                  });
                }}
              >
                <label>
                  Proposal disposition
                  <select name="decision">
                    <option value="needs_evidence">Needs evidence</option>
                    <option value="accepted">Accept workflow output</option>
                    <option value="rejected">Reject</option>
                    <option value="deferred">Defer</option>
                  </select>
                </label>
                <label>
                  Proposal decision reason
                  <textarea name="reason" required maxLength={4000} />
                </label>
                <label className="check">
                  <input type="checkbox" required />I am independent and have no
                  conflict in this proposal review.
                </label>
                <button disabled={busy}>Record proposal disposition</button>
              </form>
            )}
            {p.disposition === "accepted" &&
              !p.published_refs &&
              p.requester_id === userId && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(async () => {
                      await api(
                        `${base}/ai/proposals/${p.id}/publish`,
                        "POST",
                        { confirmation: true },
                        p.etag,
                      );
                      await refresh();
                      await onChange();
                      setMessage(
                        "Accepted fixture published explicitly with its origin and pinned sources. Scientific review remains unreviewed.",
                      );
                    });
                  }}
                >
                  <label className="check">
                    <input type="checkbox" required />
                    Publish this accepted fixture to all workspace members.
                  </label>
                  <button disabled={busy}>Publish accepted fixture</button>
                </form>
              )}
            {p.published_refs && (
              <p>
                Published references retained: {p.published_refs.length}. No
                scientific acceptance is implied.
              </p>
            )}
          </article>
        ))}
      </section>
    </details>
  );
}
