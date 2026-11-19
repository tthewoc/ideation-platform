import { useState } from "react";
import type { Api } from "./StructuredEditor";
export function OutlineReviews({
  base,
  api,
  userId,
}: {
  base: string;
  api: Api;
  userId: string;
}) {
  const [items, setItems] = useState<any[]>([]),
    [packets, setPackets] = useState<Record<string, any>>({}),
    [next, setNext] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
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
  async function refresh(after?: string) {
    setPackets({});
    const r = await api(
      `${base}/outline-reviews${after ? `?after=${after}` : ""}`,
    );
    setItems((old) => (after ? [...old, ...r.items] : r.items));
    setNext(r.next);
  }
  return (
    <details className="intake-panel">
      <summary>Outline review inbox</summary>
      <section aria-label="Independent outline reviews">
        <h2>Review explicitly shared outlines</h2>
        <p>
          Each grant covers one immutable outline revision and only its cited
          original turns. It does not open the author's notebook. A disposition
          publishes nothing and does not establish scientific acceptance.
        </p>
        <p role="alert">{error}</p>
        <p role="log" aria-label="Outline review update">
          {message}
        </p>
        <button disabled={busy} onClick={() => run(() => refresh())}>
          Refresh outline reviews
        </button>
        {items.map((r) => (
          <article key={r.id} aria-label={`Outline review ${r.id.slice(0, 8)}`}>
            <h3>
              Outline revision {r.outline_revision} ·{" "}
              {r.expired ? "expired" : r.state}
            </h3>
            <p>Review grant ends {new Date(r.expires_at).toLocaleString()}.</p>
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  setPackets((p) => {
                    const next = { ...p };
                    delete next[r.id];
                    return next;
                  });
                  const packet = await api(`${base}/outline-reviews/${r.id}`);
                  setPackets((p) => ({ ...p, [r.id]: packet }));
                })
              }
            >
              Inspect shared outline and sources
            </button>
            {packets[r.id] && (
              <section aria-label="Shared outline packet">
                <p>Purpose: {packets[r.id].purpose}</p>
                <ul>
                  {packets[r.id].outline.items.map((i: any) => (
                    <li key={i.id}>
                      <strong>
                        {i.kind.replaceAll("_", " ")} ·{" "}
                        {i.basis.replaceAll("_", " ")}
                      </strong>
                      <p className="body">{i.text}</p>
                      {i.rationale && <p>{i.rationale}</p>}
                      {i.steps.length > 0 && (
                        <ol>
                          {i.steps.map((s: string, n: number) => (
                            <li key={n}>{s}</li>
                          ))}
                        </ol>
                      )}
                      <p>
                        Source turns:{" "}
                        {i.source_turn_ids
                          .map(
                            (id: string) =>
                              packets[r.id].source_turns.find(
                                (t: any) => t.id === id,
                              )?.sequence,
                          )
                          .join(", ")}
                      </p>
                    </li>
                  ))}
                </ul>
                {r.author_id === userId &&
                  !r.expired &&
                  r.state === "decided" &&
                  packets[r.id].decision?.disposition === "accepted" &&
                  packets[r.id].outline.items.some(
                    (i: any) => i.kind === "claim",
                  ) && (
                    <form
                      onChange={() =>
                        setPackets((old) => ({
                          ...old,
                          [r.id]: { ...old[r.id], preview: null },
                        }))
                      }
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        run(async () => {
                          setPackets((old) => ({
                            ...old,
                            [r.id]: { ...old[r.id], preview: null },
                          }));
                          const preview = await api(
                            `${base}/outline-reviews/${r.id}/claim-preview`,
                            "POST",
                            Object.fromEntries(f),
                            r.etag,
                          );
                          setPackets((old) => ({
                            ...old,
                            [r.id]: { ...old[r.id], preview },
                          }));
                        });
                      }}
                    >
                      <h4>Prepare a private claim preview</h4>
                      <label>
                        Reviewed claim
                        <select name="item_id">
                          {packets[r.id].outline.items
                            .filter((i: any) => i.kind === "claim")
                            .map((i: any) => (
                              <option key={i.id} value={i.id}>
                                {i.text}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Claim title
                        <input name="title" required maxLength={200} />
                      </label>
                      <label>
                        Claim scope
                        <textarea name="scope" required maxLength={50000} />
                      </label>
                      <label>
                        Language code
                        <input
                          name="language"
                          required
                          minLength={2}
                          maxLength={20}
                        />
                      </label>
                      <button disabled={busy}>Preview registry claim</button>
                      {packets[r.id].preview && (
                        <section aria-label="Private claim preview">
                          <h5>{packets[r.id].preview.content.title}</h5>
                          <p>{packets[r.id].preview.content.proposition}</p>
                          <p>
                            Author-supplied scope:{" "}
                            {packets[r.id].preview.content.scope}
                          </p>
                          <p>
                            Language: {packets[r.id].preview.content.language}
                          </p>
                          <p>
                            Reviewed basis:{" "}
                            {packets[r.id].preview.provenance.basis.replaceAll(
                              "_",
                              " ",
                            )}
                          </p>
                          <p>Reasoning: {packets[r.id].preview.content.body}</p>
                          <p>
                            Source turns:{" "}
                            {packets[r.id].preview.provenance.source_turn_ids
                              .map(
                                (id: string) =>
                                  packets[r.id].source_turns.find(
                                    (t: any) => t.id === id,
                                  ).sequence,
                              )
                              .join(", ")}
                          </p>
                          <ul>
                            {packets[r.id].preview.content.source_refs.map(
                              (ref: any) => (
                                <li key={ref.id + ":" + ref.revision}>
                                  Artifact {ref.id} · revision {ref.revision}
                                </li>
                              ),
                            )}
                          </ul>
                        </section>
                      )}
                    </form>
                  )}
                {r.author_id === userId &&
                  r.state === "decided" &&
                  !r.expired &&
                  packets[r.id].decision?.disposition === "accepted" && (
                    <section aria-label="Saved claim candidates">
                      {packets[r.id].preview && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              const p = packets[r.id].preview;
                              const result = await api(
                                `${base}/outline-reviews/${r.id}/claim-candidates`,
                                "POST",
                                {
                                  item_id: p.provenance.item_id,
                                  title: p.content.title,
                                  scope: p.content.scope,
                                  language: p.content.language,
                                },
                                r.etag,
                              );
                              setMessage(
                                `Private candidate version ${result.version} saved.`,
                              );
                            })
                          }
                        >
                          Save preview as private candidate
                        </button>
                      )}
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const result = await api(
                              `${base}/outline-reviews/${r.id}/claim-candidates`,
                            );
                            setPackets((old) => ({
                              ...old,
                              [r.id]: { ...old[r.id], saved: result.items },
                            }));
                          })
                        }
                      >
                        Load saved candidates
                      </button>
                      {packets[r.id].saved?.map((row: any) => (
                        <details key={row.version}>
                          <summary>
                            Version {row.version} ·{" "}
                            {row.candidate.content.title}
                          </summary>
                          <pre>{JSON.stringify(row.candidate, null, 2)}</pre>
                        </details>
                      ))}
                    </section>
                  )}
                <h4>Granted original turns</h4>
                {packets[r.id].source_turns.map((t: any) => (
                  <section key={t.id} aria-label={`Granted turn ${t.sequence}`}>
                    <strong>Turn {t.sequence}</strong>
                    <p className="body">
                      {t.original_text || "Attachment-only source"}
                    </p>
                    {t.attachment_refs.map((a: any) => (
                      <p key={`${a.id}:${a.revision}`}>
                        Published artifact {a.id} · r{a.revision}
                      </p>
                    ))}
                  </section>
                ))}
                {packets[r.id].decision && (
                  <p>
                    Recorded disposition: {packets[r.id].decision.disposition} ·{" "}
                    {packets[r.id].decision.reason}
                  </p>
                )}
              </section>
            )}
            {r.reviewer_id === userId &&
              r.state === "pending" &&
              !r.expired &&
              packets[r.id] && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    run(async () => {
                      await api(
                        `${base}/outline-reviews/${r.id}/decisions`,
                        "POST",
                        {
                          disposition: f.get("decision"),
                          reason: f.get("reason"),
                          conflict_declaration: "none",
                        },
                        r.etag,
                      );
                      await refresh();
                      setMessage(
                        "Independent outline disposition recorded. Nothing published.",
                      );
                    });
                  }}
                >
                  <label>
                    Outline review disposition
                    <select name="decision">
                      <option value="needs_evidence">Needs evidence</option>
                      <option value="accepted">
                        Accept this outline revision
                      </option>
                      <option value="rejected">Reject</option>
                      <option value="deferred">Defer</option>
                    </select>
                  </label>
                  <label>
                    Outline review reason
                    <textarea name="reason" maxLength={4000} required />
                  </label>
                  <label className="check">
                    <input type="checkbox" required />I am independent and have
                    no conflict in this outline review.
                  </label>
                  <button disabled={busy}>Record outline review</button>
                </form>
              )}
            {r.author_id === userId && r.state !== "revoked" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  run(async () => {
                    await api(
                      `${base}/outline-reviews/${r.id}/revoke`,
                      "POST",
                      { reason: f.get("reason") },
                      r.etag,
                    );
                    await refresh();
                    setMessage(
                      "Outline access revoked. Earlier decisions remain recorded.",
                    );
                  });
                }}
              >
                <label>
                  Reason for revoking outline access
                  <textarea name="reason" maxLength={4000} required />
                </label>
                <button disabled={busy}>Revoke outline access</button>
              </form>
            )}
          </article>
        ))}
        {next && (
          <button disabled={busy} onClick={() => run(() => refresh(next))}>
            Load more outline reviews
          </button>
        )}
      </section>
    </details>
  );
}
