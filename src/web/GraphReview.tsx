import { useEffect, useState } from "react";
import type { Api } from "./StructuredEditor";
export function GraphReview({
  base,
  api,
  objects,
  selected,
  userId,
  onSelect,
  onChange,
}: {
  base: string;
  api: Api;
  objects: any[];
  selected: any;
  userId: string;
  onSelect: (o: any) => void;
  onChange: () => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [graph, setGraph] = useState<any>(null),
    [query, setQuery] = useState<any>(null),
    [submissions, setSubmissions] = useState<any[]>([]),
    [equivalences, setEquivalences] = useState<any[]>([]),
    [reviews, setReviews] = useState<any>(null),
    [assessments, setAssessments] = useState<any[]>([]);
  useEffect(() => {
    setReviews(null);
    setAssessments([]);
  }, [selected?.id, selected?.revision]);
  const published = objects.filter((o) => o.current_revision);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function reference(value: FormDataEntryValue | null) {
    const [id, r] = String(value ?? "").split(":");
    return { id, revision: Number(r) };
  }
  function options() {
    return published.map((o) => (
      <option key={o.id} value={`${o.id}:${o.current_revision}`}>
        {o.content.title} · r{o.current_revision}
      </option>
    ));
  }
  return (
    <section className="graph-review" aria-label="Graph and review">
      <h2>Connections & evidence</h2>
      <p>
        Explore typed relationships. Review interpretations without confusing
        publication with scientific acceptance.
      </p>
      <p role="alert">{error}</p>
      <p role="log" aria-live="polite" aria-label="Graph and review update">
        {message}
      </p>
      <div className="graph-grid">
        <section>
          <h3>Explore a graph</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(async () => {
                const q = {
                  root_ids: [String(f.get("root"))],
                  depth: Number(f.get("depth")),
                };
                setQuery(q);
                setGraph(await api(`${base}/graph/query`, "POST", q));
              });
            }}
          >
            <label>
              Starting object
              <select name="root" required>
                <option value="">Choose a published object</option>
                {published.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.content.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Traversal depth
              <select name="depth">
                <option>1</option>
                <option>2</option>
                <option>3</option>
                <option>4</option>
              </select>
            </label>
            <button disabled={busy}>Explore connections</button>
          </form>
          {graph && (
            <>
              <p>
                {graph.truncated
                  ? "Results are bounded; continue or narrow the query."
                  : "Traversal complete within the selected depth."}
              </p>
              <ul>
                {graph.nodes.map((n: any) => (
                  <li key={`${n.id}:${n.revision}`}>
                    <button onClick={() => onSelect(n)}>
                      {n.content.title} · r{n.revision}
                    </button>{" "}
                    · {n.validity} · freshness {n.freshness}
                  </li>
                ))}
              </ul>
              <div className="table-scroll">
                <table>
                  <caption>
                    Typed relationships; arrows retain their stored direction
                  </caption>
                  <thead>
                    <tr>
                      <th>From</th>
                      <th>Relationship</th>
                      <th>To</th>
                      <th>Scope / rationale</th>
                      <th>Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {graph.edges.map((e: any) => {
                      const label = (id: string, r: number) =>
                        graph.nodes.find(
                          (n: any) => n.id === id && n.revision === r,
                        )?.content.title ?? id;
                      return (
                        <tr key={e.id}>
                          <td>
                            {label(e.from_id, e.from_revision)} r
                            {e.from_revision}
                          </td>
                          <td>{e.type}</td>
                          <td>
                            {label(e.to_id, e.to_revision)} r{e.to_revision}
                          </td>
                          <td>
                            {e.condition && <p>{e.condition}</p>}
                            {e.rationale}
                            {(e.valid_from || e.valid_to) && (
                              <p>
                                Validity window: {e.valid_from ?? "open start"}{" "}
                                – {e.valid_to ?? "open end"}
                              </p>
                            )}
                          </td>
                          <td>
                            {e.review_state}{" "}
                            {e.assessment_id && `· ${e.assessment_validity}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {graph.next_cursor && (
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () =>
                      setGraph(
                        await api(`${base}/graph/query`, "POST", {
                          ...query,
                          cursor: graph.next_cursor,
                        }),
                      ),
                    )
                  }
                >
                  Continue graph
                </button>
              )}
              {graph.query_limit && <p>Narrow the query to explore further.</p>}
            </>
          )}
        </section>
        <section>
          <h3>Add a relationship</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(async () => {
                await api(`${base}/edges`, "POST", {
                  type: f.get("type"),
                  from: reference(f.get("from")),
                  to: reference(f.get("to")),
                  rationale: f.get("rationale"),
                  condition: String(f.get("condition") || "") || null,
                });
                setMessage("Relationship recorded.");
                await onChange();
              });
            }}
          >
            <label>
              From revision
              <select name="from" required>
                <option value="">Choose source</option>
                {options()}
              </select>
            </label>
            <label>
              Relationship
              <select name="type">
                {[
                  "relevant_to",
                  "derived_from",
                  "depends_on",
                  "tests",
                  "uses_method",
                  "produces",
                  "part_of",
                  "cites",
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              To revision
              <select name="to" required>
                <option value="">Choose target</option>
                {options()}
              </select>
            </label>
            <label>
              Rationale
              <textarea name="rationale" required maxLength={4000} />
            </label>
            <label>
              Condition or scope (optional)
              <input name="condition" maxLength={4000} />
            </label>
            <button disabled={busy}>Record relationship</button>
          </form>
          <p>
            Support, contradiction and qualification relationships are created
            by publishing an evidence assessment.
          </p>
        </section>
      </div>
      {selected && (
        <section className="notice" aria-label="Selected knowledge review">
          <h3>Review: {selected.content.title}</h3>
          <p>
            Revision {selected.revision} · {selected.review_state} ·{" "}
            {selected.validity} · freshness {selected.freshness}
          </p>
          {selected.content.source_group_ids?.length > 0 && (
            <p>
              Shared dataset groups:{" "}
              {selected.content.source_group_ids.join(", ")}. Do not count
              correlated sources as independent confirmations.
            </p>
          )}
          {selected.author_id === userId && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                run(async () => {
                  await api(
                    `${base}/objects/${selected.id}/submissions`,
                    "POST",
                    {
                      revision: selected.revision,
                      reviewer_ids: String(f.get("reviewers"))
                        .split(",")
                        .map((s) => s.trim()),
                      purpose: f.get("purpose"),
                    },
                    selected.etag,
                  );
                  setMessage(
                    "Exact revision submitted for independent review.",
                  );
                  await onChange();
                });
              }}
            >
              <label>
                Reviewer user IDs (comma separated)
                <input name="reviewers" required />
              </label>
              <label>
                Review purpose
                <input name="purpose" required maxLength={4000} />
              </label>
              <button disabled={busy}>Submit exact revision</button>
            </form>
          )}
          <button
            onClick={() =>
              run(async () =>
                setReviews(
                  await api(
                    `${base}/objects/${selected.id}/reviews?revision=${selected.revision}`,
                  ),
                ),
              )
            }
          >
            Read review history
          </button>
          {["claim", "hypothesis"].includes(selected.type) && (
            <button
              onClick={() =>
                run(async () =>
                  setAssessments(
                    (await api(`${base}/assessments?claim_id=${selected.id}`))
                      .items,
                  ),
                )
              }
            >
              Compare evidence interpretations
            </button>
          )}
          {reviews && (
            <ul>
              {reviews.reviews.map((r: any) => (
                <li key={r.id}>
                  {r.decision}: {r.reason} · reviewer {r.reviewer_id}
                </li>
              ))}
              {reviews.events.map((e: any) => (
                <li key={e.id}>
                  {e.axis}: {e.from_state} → {e.to_state} · {e.reason}
                </li>
              ))}
            </ul>
          )}
          {assessments.map((a) => (
            <article className="revision" key={a.id}>
              <h4>
                {a.content.polarity} · {a.content.scope}
              </h4>
              <p>{a.content.rationale}</p>
              <p>
                Uncertainty: {a.content.uncertainty.level} —{" "}
                {a.content.uncertainty.rationale}
              </p>
              <p>
                {a.review_state} · {a.validity} · freshness {a.freshness}
              </p>
              <button onClick={() => onSelect(a)}>Open assessment</button>
            </article>
          ))}
          {selected.current_revision && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                run(async () => {
                  const to = String(f.get("action"));
                  await api(
                    `${base}/objects/${selected.id}/transitions`,
                    "POST",
                    {
                      axis: ["retracted", "superseded"].includes(to)
                        ? "validity"
                        : "review",
                      to_state: to,
                      revision: selected.revision,
                      reason: f.get("reason"),
                      conflict_declaration: "none",
                      ...(to === "superseded"
                        ? { replacement_ref: reference(f.get("replacement")) }
                        : {}),
                    },
                    selected.state_etag,
                  );
                  setMessage("Decision recorded with history preserved.");
                  await onChange();
                });
              }}
            >
              <label>
                Lifecycle action
                <select name="action">
                  <option value="retracted">Retract validity</option>
                  <option value="superseded">
                    Supersede with a replacement
                  </option>
                  <option value="disputed">Dispute acceptance</option>
                  <option value="accepted">Adjudicate dispute: accept</option>
                  <option value="rejected">Adjudicate dispute: reject</option>
                </select>
              </label>
              <label>
                Replacement revision (for supersession)
                <select name="replacement">
                  <option value="">Choose replacement</option>
                  {options()}
                </select>
              </label>
              <label>
                Decision reason
                <textarea name="reason" required maxLength={4000} />
              </label>
              <p>
                Review actions require an independent reviewer with no conflict;
                withdrawals require the author or a moderator.
              </p>
              <label className="checkbox">
                <input type="checkbox" required /> I confirm the reason and have
                no review conflict.
              </label>
              <button disabled={busy}>Record lifecycle decision</button>
            </form>
          )}
        </section>
      )}
      <section>
        <h3>Review inbox</h3>
        <button
          onClick={() =>
            run(async () =>
              setSubmissions((await api(`${base}/submissions`)).items),
            )
          }
        >
          Load review submissions
        </button>
        {submissions.map((s) => (
          <article className="revision" key={s.id}>
            <p>
              {s.purpose} · revision {s.revision} · {s.state}
            </p>
            {s.state === "submitted" && (
              <>
                <button
                  onClick={() =>
                    run(async () =>
                      onSelect(
                        await api(
                          `${base}/objects/${s.object_id}?revision=${s.revision}`,
                        ),
                      ),
                    )
                  }
                >
                  Inspect submitted revision
                </button>
                {s.author_id === userId ? (
                  <button
                    onClick={() =>
                      run(async () => {
                        await api(
                          `${base}/submissions/${s.id}/withdraw`,
                          "POST",
                          { reason: "Author withdrew review request" },
                          s.etag,
                        );
                        setSubmissions(
                          (await api(`${base}/submissions`)).items,
                        );
                        setMessage(
                          "Submission withdrawn; temporary access closed.",
                        );
                      })
                    }
                  >
                    Withdraw submission
                  </button>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      run(async () => {
                        await api(
                          `${base}/submissions/${s.id}/decisions`,
                          "POST",
                          {
                            decision: f.get("decision"),
                            reason: f.get("reason"),
                            conflict_declaration: "none",
                          },
                          s.etag,
                        );
                        setSubmissions(
                          (await api(`${base}/submissions`)).items,
                        );
                        setMessage(
                          "Review decision recorded. Publication remains a separate action.",
                        );
                        await onChange();
                      });
                    }}
                  >
                    <label>
                      Review decision
                      <select name="decision">
                        <option value="accepted">Accept</option>
                        <option value="rejected">Reject</option>
                        <option value="needs_evidence">
                          Request further evidence
                        </option>
                      </select>
                    </label>
                    <label>
                      Review reason
                      <textarea name="reason" required />
                    </label>
                    <label className="checkbox">
                      <input type="checkbox" required /> I am independent and
                      have no conflict.
                    </label>
                    <button disabled={busy}>Record review decision</button>
                  </form>
                )}
              </>
            )}
          </article>
        ))}
      </section>
      <details>
        <summary>Candidate equivalence (reversible, no merge)</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(async () => {
              await api(`${base}/equivalences`, "POST", {
                left_ref: reference(f.get("left")),
                right_ref: reference(f.get("right")),
                rationale: f.get("reason"),
              });
              setMessage(
                "Equivalence candidate recorded; both identities are retained.",
              );
            });
          }}
        >
          <label>
            First revision
            <select name="left" required>
              <option value="">Choose first identity</option>
              {options()}
            </select>
          </label>
          <label>
            Second revision
            <select name="right" required>
              <option value="">Choose second identity</option>
              {options()}
            </select>
          </label>
          <label>
            Equivalence rationale
            <textarea name="reason" required />
          </label>
          <button disabled={busy}>Propose equivalence</button>
        </form>
        <button
          onClick={() =>
            run(async () =>
              setEquivalences((await api(`${base}/equivalences`)).items),
            )
          }
        >
          Load equivalence candidates
        </button>
        {equivalences.map((e) => (
          <article className="revision" key={e.id}>
            <p>
              {e.rationale} · {e.state}
            </p>
            <p>
              {e.left_id} ↔ {e.right_id}
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const f = new FormData(event.currentTarget);
                run(async () => {
                  await api(
                    `${base}/equivalences/${e.id}/decisions`,
                    "POST",
                    { decision: f.get("decision"), reason: f.get("reason") },
                    e.etag,
                  );
                  setEquivalences((await api(`${base}/equivalences`)).items);
                });
              }}
            >
              <label>
                Equivalence decision
                <select name="decision">
                  <option value="reviewed">
                    Approve equivalence assertion
                  </option>
                  <option value="rejected">Reject candidate</option>
                  <option value="revoked">Revoke assertion</option>
                </select>
              </label>
              <label>
                Equivalence decision reason
                <input name="reason" required />
              </label>
              <button disabled={busy}>Save equivalence decision</button>
            </form>
          </article>
        ))}
      </details>
    </section>
  );
}
