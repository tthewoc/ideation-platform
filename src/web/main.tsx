import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
type Atom = {
  id: string;
  type: string;
  content: any;
  revision: number;
  current_revision: number | null;
  lifecycle: string;
  author_id: string;
  etag: string;
  has_draft: boolean;
};
function App() {
  const [session, S] = useState<any>(null),
    [ready, R] = useState(false),
    [workspace, W] = useState(""),
    [atoms, A] = useState<Atom[]>([]),
    [projects, P] = useState<any[]>([]),
    [selected, O] = useState<Atom | null>(null),
    [history, H] = useState<any[]>([]),
    [conflict, setConflict] = useState<Atom | null>(null),
    [message, M] = useState(""),
    [busy, B] = useState(false),
    [editing, E] = useState(false),
    [kind, K] = useState("observation"),
    [title, T] = useState(""),
    [body, D] = useState(""),
    [scope, C] = useState(""),
    [reason, F] = useState(""),
    [confirm, Q] = useState(false),
    [next, N] = useState<string | null>(null),
    [projectItems, PI] = useState<Record<string, Atom[]>>({});
  async function api(
    path: string,
    method = "GET",
    data?: unknown,
    etag?: string,
  ) {
    const res = await fetch(path, {
      method,
      headers: {
        ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(method !== "GET"
          ? {
              "x-csrf-token": session?.csrf ?? "",
              "idempotency-key": crypto.randomUUID(),
            }
          : {}),
        ...(etag ? { "If-Match": etag } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    if (res.status === 204) return null;
    const value = await res.json();
    if (!res.ok) {
      if (res.status === 401) {
        S(null);
        A([]);
        O(null);
      }
      if (res.status === 404) {
        A([]);
        O(null);
        H([]);
        P([]);
        PI({});
      }
      if (res.status === 412 && selected) {
        const latest = await fetch(`${base}/objects/${selected.id}`);
        if (latest.ok) setConflict(await latest.json());
      }
      throw new Error(value.error?.message ?? "Request failed");
    }
    return value;
  }
  const base = `/v1/workspaces/${workspace}`;
  async function loadSession() {
    const res = await fetch("/v1/session");
    if (res.ok) {
      const s = await res.json();
      S(s);
      W((w) => w || s.workspaces[0]?.id || "");
    }
    R(true);
  }
  useEffect(() => {
    loadSession().catch(() => {
      M("Could not connect. Please reload.");
      R(true);
    });
  }, []);
  async function refresh() {
    if (!workspace) return;
    const [a, p] = await Promise.all([
      api(`${base}/objects`),
      api(`${base}/projects`),
    ]);
    A(a.items);
    N(a.next_cursor);
    P(p.items);
    PI({});
  }
  useEffect(() => {
    O(null);
    H([]);
    E(false);
    refresh().catch((e) => M(e.message));
  }, [workspace]);
  async function run(fn: () => Promise<void>) {
    B(true);
    M("");
    try {
      await fn();
    } catch (e) {
      M((e as Error).message);
    } finally {
      B(false);
    }
  }
  function edit(atom?: Atom) {
    setConflict(null);
    O(atom ?? null);
    K(atom?.type ?? "observation");
    T(atom?.content.title ?? "");
    D(atom?.content.body ?? "");
    C(atom?.content.context ?? atom?.content.scope ?? "");
    F("");
    E(true);
    H([]);
    Q(false);
  }
  async function select(atom: Atom) {
    const value = await api(`${base}/objects/${atom.id}`);
    O(value);
    E(false);
    Q(false);
    H([]);
  }
  async function save() {
    const content =
      kind === "claim"
        ? {
            title,
            body,
            language: "en",
            source_refs: selected?.content.source_refs ?? [],
            proposition: body,
            scope,
            qualifiers: selected?.content.qualifiers ?? ["Unverified"],
          }
        : {
            title,
            body,
            language: "en",
            source_refs: selected?.content.source_refs ?? [],
            context: scope,
            observed_at: selected?.content.observed_at ?? null,
          };
    const value = selected
      ? await api(
          `${base}/objects/${selected.id}/${selected.has_draft ? "draft" : "corrections"}`,
          selected.has_draft ? "PATCH" : "POST",
          {
            content,
            reason,
            ...(!selected.has_draft
              ? { base_revision: selected.current_revision }
              : {}),
          },
          selected.etag,
        )
      : await api(`${base}/objects`, "POST", {
          type: kind,
          schema_version: 1,
          content,
        });
    O(value);
    E(false);
    M("Private draft saved.");
    await refresh();
  }
  if (!ready)
    return (
      <main>
        <p role="status">Loading workspace…</p>
      </main>
    );
  if (!session)
    return (
      <main className="welcome">
        <span className="eyebrow">IDEATOR</span>
        <h1>
          Give an idea
          <br />a place to grow.
        </h1>
        <p>
          A shared workspace for observations, claims, and the context behind
          them.
        </p>
        <a className="button" href="/auth/login">
          Sign in
        </a>
        <p role="alert">{message}</p>
      </main>
    );
  return (
    <>
      <header>
        <a href="/" className="brand">
          Ideator<span> / Knowledge workspace</span>
        </a>
        <div>
          {session.user.name}
          <button
            onClick={() =>
              run(async () => {
                await api("/v1/logout", "POST");
                S(null);
                A([]);
                O(null);
              })
            }
          >
            Sign out
          </button>
        </div>
      </header>
      <main>
        <div className="workspace">
          <label>
            Workspace
            <select value={workspace} onChange={(e) => W(e.target.value)}>
              <option value="">Choose a workspace</option>
              {session.workspaces.map((w: any) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(async () => {
                const w = await api("/v1/workspaces", "POST", {
                  name: f.get("name"),
                });
                await loadSession();
                W(w.id);
                M("Workspace created.");
              });
            }}
          >
            <label className="sr" htmlFor="workspace-name">
              New workspace name
            </label>
            <input
              id="workspace-name"
              name="name"
              placeholder="New workspace name"
              required
              maxLength={200}
            />
            <button disabled={busy}>Create workspace</button>
          </form>
        </div>
        <p role="status" aria-live="polite" className="message">
          {message}
        </p>
        {workspace && (
          <>
            <div className="heading">
              <div>
                <span className="eyebrow">YOUR KNOWLEDGE REGISTRY</span>
                <h1>
                  From first thought
                  <br />
                  to shared understanding.
                </h1>
                <p>
                  Keep original context. Publish deliberately. Build on the same
                  idea.
                </p>
              </div>
              <button className="primary" onClick={() => edit()}>
                New observation or claim
              </button>
            </div>
            <div className="layout">
              <section aria-label="Knowledge objects" className="list">
                <h2>
                  Knowledge <span>{atoms.length}</span>
                </h2>
                {atoms.length === 0 && (
                  <p className="empty">
                    Start with an observation. Your draft stays private until
                    you publish it.
                  </p>
                )}
                {atoms.map((a) => (
                  <button
                    className={`card ${selected?.id === a.id ? "selected" : ""}`}
                    key={a.id}
                    onClick={() => run(() => select(a))}
                  >
                    <span className="eyebrow">
                      {a.type} ·{" "}
                      {a.lifecycle === "draft"
                        ? "Private draft"
                        : "Workspace published"}
                    </span>
                    <strong>{a.content.title}</strong>
                    <span>{a.content.body.slice(0, 130)}</span>
                  </button>
                ))}
                {next && (
                  <button
                    onClick={() =>
                      run(async () => {
                        const r = await api(`${base}/objects?cursor=${next}`);
                        A([...atoms, ...r.items]);
                        N(r.next_cursor);
                      })
                    }
                  >
                    Load more objects
                  </button>
                )}
              </section>
              <section className="detail" aria-label="Object details">
                {editing ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(save);
                    }}
                  >
                    <h2>
                      {selected ? "Revise your idea" : "A new starting point"}
                    </h2>
                    <p>Private draft · Human authored · Unreviewed</p>
                    <label>
                      Type
                      <select
                        value={kind}
                        disabled={!!selected}
                        onChange={(e) => K(e.target.value)}
                      >
                        <option value="observation">Observation</option>
                        <option value="claim">Claim</option>
                      </select>
                    </label>
                    <label>
                      Title
                      <input
                        value={title}
                        onChange={(e) => T(e.target.value)}
                        required
                        maxLength={200}
                      />
                    </label>
                    <label>
                      {kind === "claim"
                        ? "Proposition / description"
                        : "What did you observe?"}
                      <textarea
                        value={body}
                        onChange={(e) => D(e.target.value)}
                        required
                        maxLength={50000}
                      />
                    </label>
                    <label>
                      {kind === "claim" ? "Scope" : "Context"}
                      <textarea
                        value={scope}
                        onChange={(e) => C(e.target.value)}
                        required
                        maxLength={50000}
                      />
                    </label>
                    {selected && (
                      <label>
                        Reason for this revision
                        <input
                          value={reason}
                          onChange={(e) => F(e.target.value)}
                          required
                          maxLength={4000}
                        />
                      </label>
                    )}
                    {conflict && (
                      <aside className="notice" role="alert">
                        <h3>A newer revision is available</h3>
                        <p>
                          Your text is preserved in the editor. Compare it with
                          the latest saved version below, reconcile the fields,
                          then acknowledge the new base before saving.
                        </p>
                        <strong>{conflict.content.title}</strong>
                        <p>{conflict.content.body}</p>
                        <p>
                          {conflict.content.context ?? conflict.content.scope}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            O(conflict);
                            setConflict(null);
                            M(
                              "Latest base selected; review your text before saving.",
                            );
                          }}
                        >
                          Use latest version as base
                        </button>
                      </aside>
                    )}
                    <div className="actions">
                      <button className="primary" disabled={busy || !!conflict}>
                        Save private draft
                      </button>
                      <button type="button" onClick={() => E(false)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : selected ? (
                  <>
                    <div className="eyebrow">
                      {selected.type} · Revision {selected.revision}
                    </div>
                    <h2>{selected.content.title}</h2>
                    <div className="tags">
                      <span>
                        {selected.lifecycle === "draft"
                          ? "Private draft"
                          : "Workspace published"}
                      </span>
                      <span>Human authored</span>
                      <span>Unreviewed</span>
                    </div>
                    <p className="body">{selected.content.body}</p>
                    <h3>{selected.type === "claim" ? "Scope" : "Context"}</h3>
                    <p>{selected.content.scope ?? selected.content.context}</p>
                    <div className="actions">
                      {selected.author_id === session.user.id && (
                        <button onClick={() => edit(selected)}>
                          {selected.has_draft
                            ? "Edit draft"
                            : "Create correction"}
                        </button>
                      )}
                      <button
                        onClick={() =>
                          run(async () =>
                            H(
                              (
                                await api(
                                  `${base}/objects/${selected.id}/revisions`,
                                )
                              ).items,
                            ),
                          )
                        }
                      >
                        View history
                      </button>
                      {selected.has_draft && (
                        <button className="primary" onClick={() => Q(true)}>
                          Review publication
                        </button>
                      )}
                    </div>
                    {confirm && (
                      <aside
                        className="notice"
                        aria-label="Publication confirmation"
                      >
                        <h3>Publish to this workspace?</h3>
                        <p>
                          Every current member will be able to read this
                          revision. It will remain labelled unreviewed. Earlier
                          private drafts stay private.
                        </p>
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              const v = await api(
                                `${base}/objects/${selected.id}/publish`,
                                "POST",
                                {
                                  revision: selected.revision,
                                  confirmation: true,
                                },
                                selected.etag,
                              );
                              O(v);
                              Q(false);
                              await refresh();
                              M("Published to your workspace.");
                            })
                          }
                        >
                          Confirm publication
                        </button>
                        <button onClick={() => Q(false)}>
                          Cancel publication
                        </button>
                      </aside>
                    )}
                    {history.length > 0 && (
                      <section aria-label="Revision history">
                        <h3>Revision history</h3>
                        {history.map((r) => (
                          <article className="revision" key={r.revision}>
                            <strong>
                              Revision {r.revision} ·{" "}
                              {r.published ? "Published" : "Private"}
                            </strong>
                            <p>{r.content.title}</p>
                            <p>
                              {r.reason} ·{" "}
                              {new Date(r.created_at).toLocaleString()}
                            </p>
                            <p className="body">{r.content.body}</p>
                          </article>
                        ))}
                      </section>
                    )}
                  </>
                ) : (
                  <div className="empty">
                    <h2>A record worth keeping.</h2>
                    <p>
                      Select an object to see its content, publication state,
                      and history.
                    </p>
                  </div>
                )}
              </section>
            </div>
            <section className="projects">
              <h2>Projects</h2>
              <p>
                Organize published objects by reference. Removing a project
                preserves its knowledge.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  run(async () => {
                    await api(`${base}/projects`, "POST", {
                      name: f.get("name"),
                    });
                    await refresh();
                  });
                }}
              >
                <label>
                  Project name
                  <input name="name" required maxLength={200} />
                </label>
                <button disabled={busy}>Create project</button>
              </form>
              <div className="project-grid">
                {projects.map((p) => (
                  <article key={p.id}>
                    <h3>{p.name}</h3>
                    <button
                      onClick={() =>
                        run(async () =>
                          PI({
                            ...projectItems,
                            [p.id]: (
                              await api(`${base}/projects/${p.id}/objects`)
                            ).items,
                          }),
                        )
                      }
                    >
                      View references
                    </button>
                    {selected?.current_revision && (
                      <button
                        onClick={() =>
                          run(async () => {
                            await api(
                              `${base}/projects/${p.id}/objects`,
                              "POST",
                              { object_id: selected.id },
                              p.etag,
                            );
                            await refresh();
                            M("Reference added.");
                          })
                        }
                      >
                        Add selected object
                      </button>
                    )}
                    <button
                      onClick={() =>
                        run(async () => {
                          if (
                            window.confirm(
                              `Remove project “${p.name}”? Its knowledge objects will remain.`,
                            )
                          ) {
                            await api(
                              `${base}/projects/${p.id}`,
                              "DELETE",
                              undefined,
                              p.etag,
                            );
                            await refresh();
                          }
                        })
                      }
                    >
                      Remove project
                    </button>
                    {projectItems[p.id]?.map((a) => (
                      <p key={a.id}>
                        <button onClick={() => run(() => select(a))}>
                          {a.content.title}
                        </button>
                        <button
                          aria-label={`Remove reference to ${a.content.title}`}
                          onClick={() =>
                            run(async () => {
                              await api(
                                `${base}/projects/${p.id}/objects/${a.id}`,
                                "DELETE",
                                undefined,
                                p.etag,
                              );
                              await refresh();
                            })
                          }
                        >
                          Remove reference
                        </button>
                      </p>
                    ))}
                  </article>
                ))}
              </div>
            </section>
            <details>
              <summary>Workspace membership</summary>
              <p>
                Your user ID: <code>{session.user.id}</code>. Administrators can
                add a registered user by ID.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  run(async () => {
                    await loadSession();
                    const s = await api("/v1/session");
                    const w = s.workspaces.find((w: any) => w.id === workspace);
                    await api(
                      `${base}/memberships`,
                      "POST",
                      { user_id: f.get("user"), roles: ["member"] },
                      `"${w.version}"`,
                    );
                    M("Member added.");
                    await loadSession();
                  });
                }}
              >
                <label>
                  Registered user ID
                  <input name="user" required />
                </label>
                <button>Add member</button>
              </form>
            </details>
          </>
        )}
      </main>
      <footer>Ideator · Preserve context. Share with intention.</footer>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
