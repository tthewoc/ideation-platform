import { IntakeOutline } from "./IntakeOutline";
import { useState } from "react";
import type { Api } from "./StructuredEditor";
export function Intake({
  base,
  api,
  objects,
}: {
  base: string;
  api: Api;
  objects: any[];
}) {
  const [sessions, setSessions] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(null),
    [next, setNext] = useState<string | null>(null),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [artifacts, setArtifacts] = useState<any[]>([]);
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
  async function list(after?: string) {
    const r = await api(`${base}/sessions${after ? `?after=${after}` : ""}`);
    setSessions((old) => (after ? [...old, ...r.items] : r.items));
    setNext(r.next);
  }
  async function load(id: string) {
    try {
      setSelected(await api(`${base}/sessions/${id}`));
    } catch (e) {
      setSelected(null);
      throw e;
    }
  }
  const attachments = objects.filter(
    (o) =>
      o.type === "artifact" &&
      artifacts.some(
        (a) =>
          a.id === o.id &&
          a.kind === "digital" &&
          a.state === "available" &&
          a.scan_verdict === "clean",
      ),
  );
  return (
    <details className="intake-panel">
      <summary>Private idea notebook</summary>
      <section aria-label="Private conversational intake">
        <h2>Capture an unfinished idea</h2>
        <p>
          Only you can read this notebook. Save fragments in your own words
          before filling structured fields. No AI runs and nothing is published.
          Saved turns and undo reasons remain in history.
        </p>
        <p role="alert">{error}</p>
        <p role="log" aria-label="Intake update">
          {message}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(async () => {
              const s = await api(`${base}/sessions`, "POST", {
                title: f.get("title"),
              });
              await list();
              await load(s.id);
              setText("");
              setMessage("Private notebook created.");
            });
          }}
        >
          <label>
            Notebook title
            <input name="title" maxLength={200} required />
          </label>
          <button disabled={busy}>Create private notebook</button>
        </form>
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              await list();
              setArtifacts((await api(`${base}/artifacts`)).items);
              if (selected) await load(selected.id);
            })
          }
        >
          Refresh private notebooks
        </button>
        <ul>
          {sessions.map((s) => (
            <li key={s.id}>
              <button
                disabled={busy}
                aria-pressed={selected?.id === s.id}
                onClick={() =>
                  run(async () => {
                    await load(s.id);
                    setText("");
                    setArtifacts((await api(`${base}/artifacts`)).items);
                  })
                }
              >
                {s.title}
              </button>
            </li>
          ))}
        </ul>
        {next && (
          <button disabled={busy} onClick={() => run(() => list(next))}>
            Load more notebooks
          </button>
        )}
        {selected && (
          <section aria-label="Selected notebook">
            <h3>{selected.title}</h3>
            <p>
              Human authored · Private ·{" "}
              {selected.active_turn
                ? `Active turn ${selected.turns.find((t: any) => t.id === selected.active_turn)?.sequence}`
                : "Empty active branch"}
              . {selected.turns.length}/200 saved turns.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                run(async () => {
                  await api(
                    `${base}/sessions/${selected.id}/turns`,
                    "POST",
                    {
                      text,
                      attachment_refs: f.getAll("attachments").map((v) => {
                        const [id, revision] = String(v).split(":");
                        return { id, revision: Number(revision) };
                      }),
                      parent_turn: selected.active_turn,
                    },
                    selected.etag,
                  );
                  setText("");
                  await load(selected.id);
                  setMessage(
                    "Partial note saved. Original wording retained; nothing published.",
                  );
                });
              }}
            >
              <label>
                Original note
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={8000}
                />
              </label>
              <label>
                Clean digital attachments
                <select name="attachments" multiple>
                  {attachments.map((o) => (
                    <option key={o.id} value={`${o.id}:${o.revision}`}>
                      {o.content.title} · r{o.revision}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                Attach up to ten available scanned artifacts from the registry.
                Refresh to see newly available attachments. Text or an
                attachment is required. The next turn continues from the active
                turn.
              </p>
              <button disabled={busy || selected.turns.length >= 200}>
                Save partial note
              </button>
            </form>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                run(async () => {
                  await api(
                    `${base}/sessions/${selected.id}/undo`,
                    "POST",
                    {
                      target_turn: f.get("target") || null,
                      reason: f.get("reason"),
                    },
                    selected.etag,
                  );
                  await load(selected.id);
                  setMessage(
                    "Active turn restored. All saved turns remain in history.",
                  );
                });
              }}
            >
              <label>
                Restore saved turn
                <select name="target" defaultValue="">
                  <option value="">Empty branch</option>
                  {selected.turns.map((t: any) => (
                    <option key={t.id} value={t.id}>
                      Turn {t.sequence}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Reason for restoring
                <textarea name="reason" maxLength={4000} required />
              </label>
              <button disabled={busy || !selected.turns.length}>
                Restore active turn
              </button>
            </form>
            <IntakeOutline
              key={selected.id}
              base={base}
              api={api}
              session={selected}
              onChanged={() => load(selected.id)}
            />
            <h4>Original turns</h4>
            <ol>
              {selected.turns.map((t: any) => (
                <li key={t.id}>
                  <article aria-label={`Saved turn ${t.sequence}`}>
                    <strong>
                      Turn {t.sequence}
                      {t.id === selected.active_turn ? " · Active" : ""}
                    </strong>
                    <p>
                      Continues from{" "}
                      {t.parent_turn
                        ? `turn ${selected.turns.find((p: any) => p.id === t.parent_turn)?.sequence}`
                        : "an empty branch"}{" "}
                      · Human authored
                    </p>
                    <p className="body">
                      {t.original_text || "Attachment-only note"}
                    </p>
                    {t.attachment_refs.length > 0 && (
                      <ul>
                        {t.attachment_refs.map((a: any) => (
                          <li key={`${a.id}:${a.revision}`}>
                            Artifact {a.id} · r{a.revision}
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                </li>
              ))}
            </ol>
            <h4>Undo history</h4>
            <ul>
              {selected.undo_events.map((e: any) => (
                <li key={e.id}>
                  {e.reason} · {new Date(e.created_at).toLocaleString()}
                </li>
              ))}
            </ul>
          </section>
        )}
      </section>
    </details>
  );
}
