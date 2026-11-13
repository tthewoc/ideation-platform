import { useEffect, useState } from "react";
import type { Api } from "./StructuredEditor";
const kinds = [
  ["claim", "Claim"],
  ["assumption", "Assumption"],
  ["alternative_hypothesis", "Alternative hypothesis"],
  ["question", "Research question"],
  ["ethical_constraint", "Ethical constraint"],
  ["success_criterion", "Success criterion"],
  ["method", "Method"],
  ["task", "Research task"],
];
const label = (kind: string) => kinds.find((k) => k[0] === kind)?.[1] ?? kind;
export function IntakeOutline({
  base,
  api,
  session,
  onChanged,
}: {
  base: string;
  api: Api;
  session: any;
  onChanged: () => Promise<void>;
}) {
  const [outline, setOutline] = useState<any>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<string | null>(null),
    [kind, setKind] = useState("claim"),
    [text, setText] = useState(""),
    [basis, setBasis] = useState("human_conjecture"),
    [sources, setSources] = useState<string[]>([]),
    [rationale, setRationale] = useState(""),
    [steps, setSteps] = useState(""),
    [reason, setReason] = useState("");
  const url = `${base}/sessions/${session.id}/outline`;
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
  async function load(revision?: number) {
    try {
      setOutline(await api(`${url}${revision ? `?revision=${revision}` : ""}`));
    } catch (e) {
      setOutline(null);
      throw e;
    }
  }
  useEffect(() => {
    run(() => load());
  }, [session.id, session.version]);
  function clear() {
    setEditing(null);
    setKind("claim");
    setText("");
    setBasis("human_conjecture");
    setSources([]);
    setRationale("");
    setSteps("");
    setReason("");
  }
  async function save(items: any[]) {
    if (!reason.trim())
      throw new Error("Explain the outline revision before saving.");
    await api(url, "POST", { items, reason }, outline.session_etag);
    clear();
    await onChanged();
    setMessage(
      "Private outline revision saved with pinned source turns. Nothing published.",
    );
  }
  const historical = outline && outline.revision !== outline.latest_revision;
  return (
    <section aria-label="Private structured outline">
      <h4>Structure this idea privately</h4>
      <p>
        Record your own interpretation, not an AI result. Every item cites saved
        notebook turns. A quotation must match source wording exactly;
        conjecture and unknowns stay labelled. This outline creates no published
        knowledge, methods or assigned tasks.
      </p>
      <p role="alert">{error}</p>
      <p role="log" aria-label="Outline update">
        {message}
      </p>
      <button disabled={busy} onClick={() => run(() => load())}>
        Refresh latest outline
      </button>
      {outline && (
        <>
          <p>
            Human authored · Private · Outline revision {outline.revision} ·
            Unreviewed
          </p>
          <p>
            Not yet recorded:{" "}
            {outline.missing_categories.length
              ? outline.missing_categories.map(label).join(", ")
              : "All categories have entries; completeness does not establish correctness."}
          </p>
          {outline.outside_active_branch && (
            <p role="status">
              Some sources are outside the active notebook branch. Their
              original text is retained; inspect it before using this outline.
            </p>
          )}
          {historical ? (
            <p>
              Viewing an immutable earlier revision. Refresh the latest outline
              before editing.
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  if (
                    editing &&
                    !outline.items.some((i: any) => i.id === editing)
                  )
                    throw new Error(
                      "This item was removed in a newer revision. Cancel the edit and inspect the latest outline.",
                    );
                  const item = {
                    id: editing ?? crypto.randomUUID(),
                    kind,
                    text,
                    basis,
                    source_turn_ids: sources,
                    rationale,
                    steps:
                      kind === "method"
                        ? steps
                            .split("\n")
                            .map((s) => s.trim())
                            .filter(Boolean)
                        : [],
                  };
                  await save(
                    editing
                      ? outline.items.map((i: any) =>
                          i.id === editing ? item : i,
                        )
                      : [...outline.items, item],
                  );
                });
              }}
            >
              <label>
                Outline category
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  {kinds.map(([value, name]) => (
                    <option key={value} value={value}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Outline statement
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={1000}
                  required
                />
              </label>
              <label>
                Relation to original wording
                <select
                  value={basis}
                  onChange={(e) => setBasis(e.target.value)}
                >
                  <option value="human_conjecture">
                    Human conjecture or interpretation
                  </option>
                  <option value="quoted">Exact quotation</option>
                  <option value="unknown">Unknown / unresolved</option>
                </select>
              </label>
              <label>
                Source notebook turns
                <select
                  multiple
                  value={sources}
                  onChange={(e) =>
                    setSources(
                      Array.from(e.target.selectedOptions, (o) => o.value),
                    )
                  }
                  required
                >
                  {session.turns.map((t: any) => (
                    <option key={t.id} value={t.id}>
                      Turn {t.sequence}:{" "}
                      {t.original_text.slice(0, 60) || "Attachment-only note"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {kind === "task"
                  ? "Why this task is necessary"
                  : "Reasoning or uncertainty"}
                <textarea
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  maxLength={1000}
                  required={kind === "task"}
                />
              </label>
              {kind === "method" && (
                <label>
                  Ordered method steps
                  <textarea
                    value={steps}
                    onChange={(e) => setSteps(e.target.value)}
                    required
                  />
                  <span>
                    One step per line; up to five steps of 200 characters each.
                  </span>
                </label>
              )}
              <label>
                Reason for outline revision
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={4000}
                  required
                />
              </label>
              <button
                disabled={
                  busy ||
                  (!editing && outline.items.length >= 30) ||
                  outline.latest_revision >= 50 ||
                  !session.turns.length
                }
              >
                {editing ? "Save item revision" : "Add outline item"}
              </button>
              {editing && (
                <button type="button" disabled={busy} onClick={clear}>
                  Cancel outline edit
                </button>
              )}
            </form>
          )}
          <ol>
            {outline.items.map((i: any) => (
              <li key={i.id}>
                <article aria-label={`${label(i.kind)} outline item`}>
                  <strong>
                    {label(i.kind)} ·{" "}
                    {i.basis === "quoted"
                      ? "Exact quotation"
                      : i.basis === "unknown"
                        ? "Unknown / unresolved"
                        : "Human conjecture"}
                  </strong>
                  <p className="body">{i.text}</p>
                  {i.rationale && <p>Reasoning: {i.rationale}</p>}
                  {i.steps.length > 0 && (
                    <ol>
                      {i.steps.map((s: string, n: number) => (
                        <li key={n}>{s}</li>
                      ))}
                    </ol>
                  )}
                  <p>
                    Sources:{" "}
                    {i.source_turn_ids
                      .map(
                        (id: string) =>
                          `Turn ${session.turns.find((t: any) => t.id === id)?.sequence}`,
                      )
                      .join(", ")}
                  </p>
                  {!historical && (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setEditing(i.id);
                          setKind(i.kind);
                          setText(i.text);
                          setBasis(i.basis);
                          setSources(i.source_turn_ids);
                          setRationale(i.rationale);
                          setSteps(i.steps.join("\n"));
                          setReason("");
                        }}
                      >
                        Edit outline item
                      </button>
                      <button
                        disabled={busy || outline.latest_revision >= 50}
                        onClick={() =>
                          run(() =>
                            save(
                              outline.items.filter((v: any) => v.id !== i.id),
                            ),
                          )
                        }
                      >
                        Remove from next revision
                      </button>
                    </>
                  )}
                </article>
              </li>
            ))}
          </ol>
          <h5>Outline revision history</h5>
          <ul>
            {outline.history.map((r: any) => (
              <li key={r.revision}>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      clear();
                      await load(r.revision);
                    })
                  }
                >
                  Inspect outline revision {r.revision}
                </button>{" "}
                · {r.reason}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
