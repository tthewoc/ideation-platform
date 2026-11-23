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
                  const eligible = packet.outline.items.filter((i: any) =>
                    [
                      "claim",
                      "alternative_hypothesis",
                      "method",
                      "task",
                    ].includes(i.kind),
                  );
                  setPackets((p) => ({
                    ...p,
                    [r.id]: { ...packet, eligible, selectedItem: eligible[0] },
                  }));
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
                  packets[r.id].selectedItem && (
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
                        let methodPin;
                        if (f.has("method_id")) {
                          const id = String(f.get("method_id")).trim(),
                            revision = Number(f.get("method_revision"));
                          f.delete("method_id");
                          f.delete("method_revision");
                          methodPin = { id, revision };
                        }
                        const fields: Record<string, unknown> =
                          Object.fromEntries(f);
                        if (fields.method_candidate_version)
                          fields.method_candidate_version = Number(
                            fields.method_candidate_version,
                          );
                        else delete fields.method_candidate_version;
                        if (methodPin) fields.method_ref = methodPin;
                        for (const name of [
                          "acceptance_criteria",
                          "metrics",
                          "constraints",
                          "ethical_constraints",
                        ])
                          if (f.has(name))
                            fields[name] = String(f.get(name))
                              .split("\n")
                              .map((line) => line.trim())
                              .filter(Boolean);
                        run(async () => {
                          setPackets((old) => ({
                            ...old,
                            [r.id]: { ...old[r.id], preview: null },
                          }));
                          const preview = await api(
                            `${base}/outline-reviews/${r.id}/claim-preview`,
                            "POST",
                            fields,
                            r.etag,
                          );
                          setPackets((old) => ({
                            ...old,
                            [r.id]: { ...old[r.id], preview },
                          }));
                        });
                      }}
                    >
                      <h4>Prepare a private candidate preview</h4>
                      <label>
                        Reviewed outline item
                        <select
                          name="item_id"
                          value={packets[r.id].selectedItem.id}
                          onChange={(e) => {
                            const selectedItemId = e.currentTarget.value;
                            setPackets((old) => ({
                              ...old,
                              [r.id]: {
                                ...old[r.id],
                                selectedItem: old[r.id].eligible.find(
                                  (i: any) => i.id === selectedItemId,
                                ),
                                preview: null,
                              },
                            }));
                          }}
                        >
                          {packets[r.id].eligible.map((i: any) => (
                            <option key={i.id} value={i.id}>
                              {i.kind.replaceAll("_", " ")} · {i.text}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Candidate title
                        <input name="title" required maxLength={200} />
                      </label>
                      {packets[r.id].selectedItem.kind === "task" ? (
                        <fieldset>
                          <legend>Author-supplied task details</legend>
                          <label>
                            Method to use
                            <select
                              name="method_candidate_version"
                              value={packets[r.id].methodVersion ?? ""}
                              onChange={(e) => {
                                const methodVersion = e.currentTarget.value;
                                setPackets((old) => ({
                                  ...old,
                                  [r.id]: {
                                    ...old[r.id],
                                    methodVersion,
                                    preview: null,
                                  },
                                }));
                              }}
                            >
                              <option value="">
                                Published method revision
                              </option>
                              {packets[r.id].saved
                                ?.filter(
                                  (v: any) =>
                                    v.candidate.type === "method" &&
                                    !v.object_id,
                                )
                                .map((v: any) => (
                                  <option key={v.version} value={v.version}>
                                    Saved method {v.version} ·{" "}
                                    {v.candidate.content.title}
                                  </option>
                                ))}
                            </select>
                          </label>
                          {!packets[r.id].methodVersion && (
                            <>
                              {" "}
                              <label>
                                Published method ID
                                <input name="method_id" required />
                              </label>
                              <label>
                                Method revision
                                <input
                                  type="number"
                                  name="method_revision"
                                  required
                                  min={1}
                                />
                              </label>
                            </>
                          )}
                          <label>
                            Acceptance criteria (one per line)
                            <textarea name="acceptance_criteria" required />
                          </label>
                        </fieldset>
                      ) : packets[r.id].selectedItem.kind === "method" ? (
                        <fieldset>
                          <legend>Author-supplied method details</legend>
                          {[
                            ["metrics", "Metrics"],
                            ["constraints", "Constraints"],
                            ["ethical_constraints", "Ethical constraints"],
                          ].map(([name, label]) => (
                            <label key={name}>
                              {label} (one per line)
                              <textarea
                                name={name}
                                required={name === "metrics"}
                              />
                            </label>
                          ))}
                        </fieldset>
                      ) : (
                        <label>
                          Candidate scope
                          <textarea name="scope" required maxLength={50000} />
                        </label>
                      )}
                      <label>
                        Language code
                        <input
                          name="language"
                          required
                          minLength={2}
                          maxLength={20}
                        />
                      </label>
                      {packets[r.id].selectedItem.kind ===
                        "alternative_hypothesis" && (
                        <fieldset key={packets[r.id].selectedItem.id}>
                          <legend>Author-supplied hypothesis details</legend>
                          <label>
                            Prediction
                            <textarea
                              required
                              name="prediction"
                              maxLength={50000}
                            />
                          </label>
                          <label>
                            Falsification criteria
                            <textarea
                              required
                              name="falsification_criteria"
                              maxLength={50000}
                            />
                          </label>
                        </fieldset>
                      )}
                      <button disabled={busy}>
                        Preview registry candidate
                      </button>
                      {packets[r.id].preview && (
                        <section aria-label="Private candidate preview">
                          <h5>{packets[r.id].preview.content.title}</h5>
                          <p>{packets[r.id].preview.content.proposition}</p>
                          {packets[r.id].preview.type === "hypothesis" && (
                            <>
                              <p>
                                Author-supplied prediction:{" "}
                                {packets[r.id].preview.content.prediction}
                              </p>
                              <p>
                                Author-supplied falsification criteria:{" "}
                                {
                                  packets[r.id].preview.content
                                    .falsification_criteria
                                }
                              </p>
                            </>
                          )}
                          {packets[r.id].preview.type === "research_task" ? (
                            <>
                              <p>
                                Reviewed rationale:{" "}
                                {packets[r.id].preview.content.rationale}
                              </p>
                              {packets[r.id].preview.content
                                .method_candidate_version ? (
                                <p>
                                  Method to publish in this batch: saved version{" "}
                                  {
                                    packets[r.id].preview.content
                                      .method_candidate_version
                                  }
                                </p>
                              ) : (
                                <p>
                                  Selected method:{" "}
                                  {packets[r.id].preview.content.method_ref.id}{" "}
                                  · r
                                  {
                                    packets[r.id].preview.content.method_ref
                                      .revision
                                  }
                                </p>
                              )}
                              <h6>Author-supplied acceptance criteria</h6>
                              <ul>
                                {packets[
                                  r.id
                                ].preview.content.acceptance_criteria.map(
                                  (v: string, i: number) => (
                                    <li key={i}>{v}</li>
                                  ),
                                )}
                              </ul>
                            </>
                          ) : packets[r.id].preview.type === "method" ? (
                            <>
                              <h6>Reviewed method steps</h6>
                              <ol>
                                {packets[
                                  r.id
                                ].preview.content.ordered_steps.map(
                                  (step: string, index: number) => (
                                    <li key={index}>{step}</li>
                                  ),
                                )}
                              </ol>
                              {[
                                ["metrics", "Author-supplied metrics"],
                                ["constraints", "Author-supplied constraints"],
                                [
                                  "ethical_constraints",
                                  "Author-supplied ethical constraints",
                                ],
                              ].map(([key, label]) => (
                                <p key={key}>
                                  {label}:{" "}
                                  {packets[r.id].preview.content[key].join(
                                    "; ",
                                  ) || "None specified"}
                                </p>
                              ))}
                            </>
                          ) : (
                            <p>
                              Author-supplied scope:{" "}
                              {packets[r.id].preview.content.scope}
                            </p>
                          )}
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
                          <p>
                            {packets[r.id].preview.type === "method" ||
                            packets[r.id].preview.type === "research_task"
                              ? "Reviewed description"
                              : "Reasoning"}
                            : {packets[r.id].preview.content.body}
                          </p>
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
                    <section aria-label="Saved candidates">
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
                                  ...Object.fromEntries(
                                    p.author_supplied_fields.map(
                                      (name: string) => [name, p.content[name]],
                                    ),
                                  ),
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
                              [r.id]: {
                                ...old[r.id],
                                saved: result.items,
                                ...(old[r.id].methodVersion &&
                                  !result.items.some(
                                    (v: any) =>
                                      String(v.version) ===
                                        old[r.id].methodVersion && !v.object_id,
                                  ) && { methodVersion: "", preview: null }),
                              },
                            }));
                          })
                        }
                      >
                        Load saved candidates
                      </button>
                      {packets[r.id].saved?.filter((v: any) => !v.object_id)
                        .length > 1 && (
                        <form
                          onChange={(e) => {
                            const form = e.currentTarget;
                            const consent =
                              form.elements.namedItem("confirmation");
                            if (
                              consent instanceof HTMLInputElement &&
                              !consent.isSameNode(e.target)
                            )
                              consent.checked = false;
                          }}
                          onSubmit={(e) => {
                            e.preventDefault();
                            const form = e.currentTarget;
                            const data = new FormData(form);
                            const versions = data
                              .getAll("versions")
                              .map(Number);
                            if (!versions.length) {
                              setError("Select a candidate to publish.");
                              return;
                            }
                            if (
                              packets[r.id].saved.some(
                                (v: any) =>
                                  versions.includes(v.version) &&
                                  v.candidate.content
                                    .method_candidate_version &&
                                  !versions.includes(
                                    v.candidate.content
                                      .method_candidate_version,
                                  ),
                              )
                            ) {
                              setError(
                                "Select the saved method used by each task in this batch.",
                              );
                              return;
                            }
                            const relationship = data.get("relationshipType")
                              ? {
                                  type: data.get("relationshipType"),
                                  from_version: Number(data.get("fromVersion")),
                                  to_version: Number(data.get("toVersion")),
                                  rationale: data.get("rationale"),
                                }
                              : undefined;
                            if (
                              relationship &&
                              (!versions.includes(relationship.from_version) ||
                                !versions.includes(relationship.to_version) ||
                                relationship.from_version ===
                                  relationship.to_version ||
                                !String(relationship.rationale).trim())
                            ) {
                              setError(
                                "Select two different checked candidates and enter a rationale for the relationship.",
                              );
                              return;
                            }
                            if (relationship?.type === "tests") {
                              const saved = packets[r.id].saved;
                              const from = saved.find(
                                (v: any) =>
                                  v.version === relationship.from_version,
                              );
                              const to = saved.find(
                                (v: any) =>
                                  v.version === relationship.to_version,
                              );
                              if (
                                !["method", "research_task"].includes(
                                  from?.candidate.type,
                                ) ||
                                to?.candidate.type !== "hypothesis"
                              ) {
                                setError(
                                  "Choose a method or research task as the source and a hypothesis as the target.",
                                );
                                return;
                              }
                            }
                            run(async () => {
                              const result = await api(
                                `${base}/outline-reviews/${r.id}/claim-candidates/publish`,
                                "POST",
                                {
                                  versions,
                                  relationship,
                                  audience: "workspace",
                                  confirmation: true,
                                },
                                r.etag,
                              );
                              setPackets((old) => ({
                                ...old,
                                [r.id]: {
                                  ...old[r.id],
                                  ...(result.published.some(
                                    (v: any) =>
                                      String(v.version) ===
                                      old[r.id].methodVersion,
                                  ) && { methodVersion: "", preview: null }),
                                  saved: old[r.id].saved.map((v: any) => ({
                                    ...v,
                                    ...result.published.find(
                                      (receipt: any) =>
                                        receipt.version === v.version,
                                    ),
                                  })),
                                },
                              }));
                              form.reset();
                              setMessage(
                                `Published ${result.published.length} candidates to the workspace.${result.relationship ? " Published relationship " + result.relationship.id + "." : ""}`,
                              );
                            });
                          }}
                        >
                          <fieldset disabled={busy}>
                            <legend>
                              Publish selected candidates together
                            </legend>
                            {packets[r.id].saved
                              .filter((v: any) => !v.object_id)
                              .map((v: any) => (
                                <div key={v.version}>
                                  <label>
                                    <input
                                      type="checkbox"
                                      name="versions"
                                      value={v.version}
                                    />
                                    Version {v.version} ·{" "}
                                    {v.candidate.content.title}
                                  </label>
                                  <details>
                                    <summary>Preview candidate content</summary>
                                    <pre>
                                      {JSON.stringify(
                                        v.candidate.content,
                                        null,
                                        2,
                                      )}
                                    </pre>
                                  </details>
                                </div>
                              ))}
                            <fieldset>
                              <legend>Relationship preview</legend>
                              <label>
                                Relationship type
                                <select name="relationshipType" defaultValue="">
                                  <option value="">No relationship</option>
                                  <option value="tests">
                                    Tests (method or research task → hypothesis)
                                  </option>
                                  <option value="cites">Cites</option>
                                  <option value="derived_from">
                                    Derived from
                                  </option>
                                  <option value="relevant_to">
                                    Relevant to
                                  </option>
                                </select>
                              </label>
                              {["fromVersion", "toVersion"].map((name) => (
                                <label key={name}>
                                  {name === "fromVersion"
                                    ? "From candidate"
                                    : "To candidate"}
                                  <select name={name} defaultValue="">
                                    <option value="">Select a candidate</option>
                                    {packets[r.id].saved
                                      .filter((v: any) => !v.object_id)
                                      .map((v: any) => (
                                        <option
                                          key={v.version}
                                          value={v.version}
                                        >
                                          Version {v.version} ·{" "}
                                          {v.candidate.content.title}
                                        </option>
                                      ))}
                                  </select>
                                </label>
                              ))}
                              <label>
                                Relationship rationale
                                <textarea name="rationale" maxLength={4000} />
                              </label>
                            </fieldset>
                            <label>
                              <input
                                type="checkbox"
                                name="confirmation"
                                required
                              />
                              Share all selected candidate content and artifact
                              references, including the selected relationship
                              and rationale, with every workspace member.
                            </label>
                            <button>Publish selected candidates</button>
                          </fieldset>
                        </form>
                      )}
                      {packets[r.id].saved?.map((row: any) => (
                        <details key={row.version}>
                          <summary>
                            Version {row.version} ·{" "}
                            {row.candidate.content.title}
                          </summary>
                          <pre>
                            {JSON.stringify(row.candidate.content, null, 2)}
                          </pre>
                          {row.object_id ? (
                            <p>
                              Published {row.candidate.type} {row.object_id} · r
                              {row.revision}
                            </p>
                          ) : row.candidate.content.method_candidate_version ? (
                            <p>
                              Publish together with saved method version{" "}
                              {row.candidate.content.method_candidate_version}.
                            </p>
                          ) : (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                run(async () => {
                                  const result = await api(
                                    `${base}/outline-reviews/${r.id}/claim-candidates/publish`,
                                    "POST",
                                    {
                                      version: row.version,
                                      audience: "workspace",
                                      confirmation: true,
                                    },
                                    r.etag,
                                  );
                                  setPackets((old) => ({
                                    ...old,
                                    [r.id]: {
                                      ...old[r.id],
                                      ...(String(row.version) ===
                                        old[r.id].methodVersion && {
                                        methodVersion: "",
                                        preview: null,
                                      }),
                                      saved: old[r.id].saved.map((v: any) =>
                                        v.version === row.version
                                          ? {
                                              ...v,
                                              object_id: result.object_id,
                                              revision: result.revision,
                                            }
                                          : v,
                                      ),
                                    },
                                  }));
                                  setMessage(
                                    `${row.candidate.type === "research_task" ? "Research task" : row.candidate.type === "method" ? "Method" : row.candidate.type === "hypothesis" ? "Hypothesis" : "Claim"} published to the workspace.`,
                                  );
                                });
                              }}
                            >
                              <label>
                                <input type="checkbox" required />
                                Share the candidate content shown above,
                                including its wording and artifact references,
                                with all workspace members.
                              </label>
                              <button disabled={busy}>
                                Publish candidate version {row.version}
                              </button>
                            </form>
                          )}
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
                    const fields: Record<string, unknown> =
                      Object.fromEntries(f);
                    for (const name of [
                      "metrics",
                      "constraints",
                      "ethical_constraints",
                    ])
                      if (f.has(name))
                        fields[name] = String(f.get(name))
                          .split("\n")
                          .map((line) => line.trim())
                          .filter(Boolean);
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
                  const fields: Record<string, unknown> = Object.fromEntries(f);
                  for (const name of [
                    "metrics",
                    "constraints",
                    "ethical_constraints",
                  ])
                    if (f.has(name))
                      fields[name] = String(f.get(name))
                        .split("\n")
                        .map((line) => line.trim())
                        .filter(Boolean);
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
