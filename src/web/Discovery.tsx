import { useEffect, useState } from "react";
import type { Api } from "./StructuredEditor";
export function Discovery({
  base,
  api,
  selected,
  onSelect,
}: {
  base: string;
  api: Api;
  selected: any;
  onSelect: (o: any) => void;
}) {
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [hits, setHits] = useState<any[]>([]),
    [query, setQuery] = useState<Record<string, string> | null>(null),
    [next, setNext] = useState<string | null>(null),
    [index, setIndex] = useState(""),
    [limited, setLimited] = useState(false),
    [basket, setBasket] = useState<any[]>([]),
    [jobs, setJobs] = useState<any[]>([]),
    [policy, setPolicy] = useState<any>(null);
  useEffect(() => {
    setPolicy(null);
  }, [selected?.id, selected?.revision]);
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
  async function search(params: Record<string, string>, append = false) {
    const page = await api(`${base}/search?${new URLSearchParams(params)}`);
    setHits((old) => (append ? [...old, ...page.items] : page.items));
    setNext(page.next_cursor);
    setIndex(page.index_state);
    setLimited(!!page.graph_truncated || !!page.retrieval_truncated);
  }
  function add(o: any) {
    setBasket((old) =>
      old.some((x) => x.id === o.id)
        ? old
        : [...old, { id: o.id, title: o.title ?? o.content?.title }],
    );
  }
  return (
    <section className="discovery" aria-label="Search and export">
      <h2>Find & reuse knowledge</h2>
      <p>
        Search published knowledge or explore related objects. Ranking shows
        relevance, not scientific confidence.
      </p>
      <p role="alert">{error}</p>
      <p role="log" aria-label="Discovery update">
        {message}
      </p>
      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            q: Record<string, string> = {
              q: String(f.get("q")),
              channels: "lexical",
            };
          if (f.get("type")) q.type = String(f.get("type"));
          if (f.get("outcome")) q.outcome = String(f.get("outcome"));
          setQuery(q);
          run(() => search(q));
        }}
      >
        <label>
          Search published knowledge
          <input
            name="q"
            type="search"
            maxLength={200}
            required
            placeholder="Words, methods, outcomes…"
          />
        </label>
        <label>
          Knowledge type filter
          <select name="type">
            <option value="">All types</option>
            {[
              "observation",
              "claim",
              "hypothesis",
              "method",
              "result",
              "evidence",
              "assessment",
              "thesis",
              "research_task",
              "artifact",
            ].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Result outcome filter
          <select name="outcome">
            <option value="">All outcomes</option>
            {["positive", "negative", "null", "ambiguous", "interrupted"].map(
              (t) => (
                <option key={t}>{t}</option>
              ),
            )}
          </select>
        </label>
        <button disabled={busy}>Search knowledge</button>
      </form>
      {index && (
        <p>
          Search index: {index}.{" "}
          {index !== "ready" &&
            "Results may be incomplete while published revisions are indexed. Search again after indexing finishes."}
        </p>
      )}
      {limited && (
        <p className="notice">
          The retrieval budget was reached. Refine the phrase or use the graph
          explorer for more context.
        </p>
      )}
      {query && !hits.length && (
        <p>No matching published knowledge is available in these results.</p>
      )}
      <ul className="search-results">
        {hits.map((h) => (
          <li key={`${h.id}:${h.revision}`}>
            <h3>
              <button
                onClick={() =>
                  run(async () =>
                    onSelect(
                      await api(
                        `${base}/objects/${h.id}?revision=${h.revision}`,
                      ),
                    ),
                  )
                }
              >
                {h.title}
              </button>
            </h3>
            <p>
              {h.type} · r{h.revision} · {h.review_state} · {h.validity} ·
              freshness {h.freshness}
              {h.outcome && ` · outcome ${h.outcome}`}
            </p>
            <p>{h.excerpt}</p>
            <p>
              Matched by:{" "}
              {[
                h.lexical_match ? "text" : null,
                h.graph_match ? "direct graph relationship" : null,
              ]
                .filter(Boolean)
                .join(" and ")}
              .
            </p>
            <button
              disabled={basket.some((o) => o.id === h.id)}
              onClick={() => add(h)}
            >
              Add {h.title} to export
            </button>
            <button
              onClick={() =>
                run(async () => {
                  const q = { channels: "graph", root_id: h.id };
                  setQuery(q);
                  await search(q);
                })
              }
            >
              Related to {h.title}
            </button>
          </li>
        ))}
      </ul>
      {next && query && (
        <button
          disabled={busy}
          onClick={() => run(() => search({ ...query, cursor: next }, true))}
        >
          Load more search results
        </button>
      )}
      <details>
        <summary>Search maintenance</summary>
        <p>
          Workspace administrators can rebuild the index from authoritative
          publications. Existing results remain available during rebuilding;
          stale cursors must be restarted.
        </p>
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api(`${base}/search/rebuild`, "POST", {});
              setMessage(
                "Search rebuild queued. Refresh status to follow progress.",
              );
            })
          }
        >
          Rebuild search index
        </button>
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              const s = await api(`${base}/search/status`);
              setIndex(s.state);
              setMessage(
                s.retrying
                  ? "Index rebuilding encountered an error and will retry."
                  : `Search index is ${s.state}.`,
              );
            })
          }
        >
          Refresh index status
        </button>
      </details>
      <section aria-label="Portable export">
        <h3>Portable knowledge export</h3>
        <p>
          Export selected objects and their permitted provenance as JSON. Files
          are not included. Restricted sources may cause dependent objects to be
          omitted; artifact metadata requires an explicit usage decision.
        </p>
        {selected?.current_revision && (
          <button
            onClick={() => add(selected)}
            disabled={basket.some((o) => o.id === selected.id)}
          >
            Add selected knowledge to export
          </button>
        )}
        <ul>
          {basket.map((o) => (
            <li key={o.id}>
              {o.title}{" "}
              <button
                onClick={() =>
                  setBasket((old) => old.filter((x) => x.id !== o.id))
                }
              >
                Remove {o.title} from export
              </button>
            </li>
          ))}
        </ul>
        <button
          disabled={busy || !basket.length || basket.length > 100}
          onClick={() =>
            run(async () => {
              const job = await api(`${base}/exports`, "POST", {
                object_ids: basket.map((o) => o.id),
                format: "json-v1",
              });
              setJobs((old) => [job, ...old]);
              setMessage(
                "Export requested. Refresh exports when preparation finishes.",
              );
            })
          }
        >
          Prepare JSON export
        </button>
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              const list = (await api(`${base}/exports`)).items;
              const states = [];
              for (const j of list)
                states.push(await api(`${base}/exports/${j.id}`));
              setJobs(states);
            })
          }
        >
          Refresh exports
        </button>
        <ul>
          {jobs.map((j) => (
            <li key={j.id}>
              Export {j.id.slice(0, 8)} · {j.state}
              {j.state === "ready" && (
                <>
                  {" "}
                  ·{" "}
                  <a href={`${base}/exports/${j.id}/download`}>
                    Download JSON export {j.id.slice(0, 8)}
                  </a>
                </>
              )}
              {j.state === "stale" &&
                " — permissions or content changed; prepare a new export."}
              {j.state === "failed" &&
                " — preparation could not complete within its limits; choose fewer objects."}
            </li>
          ))}
        </ul>
        {selected?.current_revision && (
          <details>
            <summary>Usage permission for selected revision</summary>
            <p>
              Record a license or consent decision for revision{" "}
              {selected.revision}. Only the author or a moderator may change it.
              This controls metadata export, including dependent
              interpretations.
            </p>
            <button
              disabled={busy}
              onClick={() =>
                run(async () =>
                  setPolicy(
                    await api(
                      `${base}/objects/${selected.id}/export-policy?revision=${selected.revision}`,
                    ),
                  ),
                )
              }
            >
              Load export permission
            </button>
            {policy && (
              <>
                <p>
                  Export {policy.allowed ? "permitted" : "not permitted"}:{" "}
                  {policy.reason}
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    run(async () => {
                      setPolicy(
                        await api(
                          `${base}/objects/${selected.id}/export-policy`,
                          "POST",
                          {
                            revision: selected.revision,
                            allowed: f.get("allowed") === "yes",
                            reason: f.get("reason"),
                          },
                          policy.etag,
                        ),
                      );
                      setMessage(
                        "Export permission recorded. Existing prepared exports must be requested again.",
                      );
                    });
                  }}
                >
                  <label>
                    Metadata export permission
                    <select
                      name="allowed"
                      defaultValue={policy.allowed ? "yes" : "no"}
                    >
                      <option value="no">Do not permit</option>
                      <option value="yes">Permit under recorded terms</option>
                    </select>
                  </label>
                  <label>
                    License or consent decision reason
                    <textarea name="reason" required maxLength={4000} />
                  </label>
                  <button disabled={busy}>Record export permission</button>
                </form>
              </>
            )}
          </details>
        )}
      </section>
    </section>
  );
}
