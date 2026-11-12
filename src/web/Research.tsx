import { useEffect, useState } from "react";
import type { Api } from "./StructuredEditor";
export function Research({
  base,
  api,
  objects,
  onSelect,
  onChange,
  userId,
}: {
  base: string;
  api: Api;
  objects: any[];
  onSelect: (o: any) => void;
  onChange: () => Promise<void>;
  userId: string;
}) {
  const [tasks, setTasks] = useState<any[]>([]),
    [task, setTask] = useState<any>(null),
    [artifacts, setArtifacts] = useState<any[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [kind, setKind] = useState("digital"),
    [next, setNext] = useState<string | null>(null);
  async function load() {
    const t = await api(`${base}/tasks`);
    setTasks(t.items);
    setNext(t.next_cursor);
    setArtifacts((await api(`${base}/artifacts`)).items);
    if (task) setTask(await api(`${base}/tasks/${task.object_id}`));
  }
  useEffect(() => {
    setTasks([]);
    setTask(null);
    setArtifacts([]);
  }, [base]);
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
  function options(type: string) {
    return objects
      .filter((o) => o.type === type && o.current_revision)
      .map((o) => (
        <option key={o.id} value={`${o.id}:${o.current_revision}`}>
          {o.content.title} · r{o.current_revision}
        </option>
      ));
  }
  const reference = (v: FormDataEntryValue | null) => {
    const [id, revision] = String(v).split(":");
    return { id, revision: Number(revision) };
  };
  async function selectTask(id: string) {
    const updated = await api(`${base}/tasks/${id}`);
    setTask(updated);
    setTasks((rows) => rows.map((t) => (t.object_id === id ? updated : t)));
  }
  const field = (name: string, label: string, multiline = false) => (
    <label>
      {label}
      {multiline ? (
        <textarea name={name} required maxLength={4000} />
      ) : (
        <input name={name} required maxLength={200} />
      )}
    </label>
  );
  return (
    <section className="research" aria-label="Research and artifacts">
      <h2>Research & artifacts</h2>
      <p>
        Coordinate consented work, retain null results, and inspect the
        materials behind a finding.
      </p>
      <p role="alert">{error}</p>
      <p role="log" aria-label="Research update">
        {message}
      </p>
      <button disabled={busy} onClick={() => run(load)}>
        Refresh research board
      </button>
      <div className="graph-grid">
        <section>
          <h3>Task board</h3>
          <ul>
            {tasks.map((t) => (
              <li key={t.object_id}>
                <button onClick={() => run(() => selectTask(t.object_id))}>
                  {t.content.title} · {t.status.replaceAll("_", " ")}
                </button>
              </li>
            ))}
          </ul>
          {next && (
            <button
              onClick={() =>
                run(async () => {
                  const page = await api(`${base}/tasks?after=${next}`);
                  setTasks([...tasks, ...page.items]);
                  setNext(page.next_cursor);
                })
              }
            >
              Load more tasks
            </button>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(async () => {
                const r = reference(f.get("task"));
                const o = await api(`${base}/objects/${r.id}`);
                const t = await api(
                  `${base}/tasks/${r.id}/open`,
                  "POST",
                  { revision: r.revision, reason: f.get("reason") },
                  o.etag,
                );
                setTask(t);
                setMessage(
                  "Task opened. An invitation still requires the assignee’s consent.",
                );
                const page = await api(`${base}/tasks`);
                setTasks(page.items);
              });
            }}
          >
            <h4>Open a published task</h4>
            <label>
              Task definition
              <select name="task" required>
                <option value="">Choose task</option>
                {options("research_task")}
              </select>
            </label>
            {field("reason", "Reason to open")}
            <button disabled={busy}>Open task</button>
          </form>
        </section>
        <section>
          <h3>Register an artifact</h3>
          <p>
            Digital uploads are limited to 1 MiB of UTF-8 plain text, CSV or
            JSON. Scanning does not publish the artifact. Files are downloaded
            as attachments.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(async () => {
                const data: any = {
                  title: f.get("title"),
                  body: "",
                  language: "en",
                  source_refs: [],
                  kind,
                  license: f.get("license"),
                };
                let bytes: Uint8Array | undefined;
                if (kind === "digital") {
                  const file = f.get("file") as File;
                  if (!file.size || file.size > 1024 * 1024)
                    throw new Error(
                      "Choose a nonempty file no larger than 1 MiB.",
                    );
                  bytes = new Uint8Array(await file.arrayBuffer());
                  Object.assign(data, {
                    filename: file.name,
                    media_type: f.get("media_type"),
                    byte_size: file.size,
                    sha256: Array.from(
                      new Uint8Array(
                        await crypto.subtle.digest(
                          "SHA-256",
                          bytes.buffer as ArrayBuffer,
                        ),
                      ),
                    )
                      .map((b) => b.toString(16).padStart(2, "0"))
                      .join(""),
                  });
                } else
                  Object.assign(data, {
                    custodian: f.get("custodian"),
                    location: f.get("location"),
                    access_protocol: f.get("access_protocol"),
                    integrity_metadata: f.get("integrity_metadata"),
                  });
                const a = await api(`${base}/artifacts`, "POST", data);
                onSelect(a.object);
                if (bytes) {
                  let raw = "";
                  for (let i = 0; i < bytes.length; i += 8192)
                    raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
                  const upload = await api(
                    `${base}/artifacts/${a.object.id}/upload`,
                    "POST",
                    { base64: btoa(raw) },
                    a.artifact.etag,
                  );
                  setMessage(
                    upload.state === "rejected"
                      ? `Upload rejected: ${upload.scan_verdict}`
                      : "Artifact quarantined. Refresh its scan status before explicit publication.",
                  );
                } else
                  setMessage(
                    "Physical artifact registered privately. Review its custody record before publication.",
                  );
                await onChange();
                await load();
              });
            }}
          >
            {field("title", "Artifact title")}
            <label>
              Artifact kind
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="digital">Digital file</option>
                <option value="physical">Physical output</option>
              </select>
            </label>
            {field("license", "License or usage terms", true)}
            {kind === "digital" ? (
              <>
                <label>
                  Artifact file
                  <input
                    type="file"
                    name="file"
                    accept=".txt,.csv,.json"
                    required
                  />
                </label>
                <label>
                  Declared media type
                  <select name="media_type">
                    <option value="text/csv">CSV</option>
                    <option value="text/plain">Plain text</option>
                    <option value="application/json">JSON</option>
                  </select>
                </label>
              </>
            ) : (
              <>
                {field("custodian", "Custodian")}
                {field("location", "Physical location")}
                {field("access_protocol", "Access protocol", true)}
                {field(
                  "integrity_metadata",
                  "Integrity and identification",
                  true,
                )}
              </>
            )}
            <button disabled={busy}>Register artifact</button>
          </form>
          <h4>Artifact status</h4>
          <ul>
            {artifacts.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() =>
                    run(async () =>
                      onSelect(await api(`${base}/objects/${a.id}`)),
                    )
                  }
                >
                  Inspect artifact {a.id.slice(0, 8)}
                </button>{" "}
                · {a.state}
                {a.scan_verdict && ` · ${a.scan_verdict}`}{" "}
                {a.state === "available" && a.kind === "digital" && (
                  <a href={`${base}/artifacts/${a.id}/download`}>
                    Download artifact {a.id.slice(0, 8)}
                  </a>
                )}{" "}
                {["available", "restricted"].includes(a.state) && (
                  <details>
                    <summary>Restrict or retract artifact</summary>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        run(async () => {
                          await api(
                            `${base}/artifacts/${a.id}/transitions`,
                            "POST",
                            { state: f.get("state"), reason: f.get("reason") },
                            a.etag,
                          );
                          setMessage(
                            "Artifact access changed; historical references are retained.",
                          );
                          await load();
                          await onChange();
                        });
                      }}
                    >
                      <label>
                        Artifact action
                        <select name="state">
                          <option value="restricted">Restrict</option>
                          <option value="retracted">Retract</option>
                        </select>
                      </label>
                      {field("reason", "Artifact decision reason", true)}
                      <button disabled={busy}>Change artifact access</button>
                    </form>
                  </details>
                )}
              </li>
            ))}
          </ul>
          <p>
            Refresh the board to see scan completion. Registration and scan
            history are retained.
          </p>
        </section>
      </div>
      {task && (
        <section className="notice" aria-label="Research task details">
          <h3>{task.content.title}</h3>
          <p>
            Work status: {task.status.replaceAll("_", " ")} · definition r
            {task.revision}
          </p>
          {task.result_id && (
            <p>
              Result freshness: {task.result_freshness ?? "unknown"}.{" "}
              {task.result_freshness !== "current" &&
                "Refresh the board after source revalidation. Stale sources require a revised result before completion."}
            </p>
          )}
          <h4>Acceptance criteria</h4>
          <ol>
            {task.content.acceptance_criteria.map((c: string, i: number) => (
              <li key={i}>{c}</li>
            ))}
          </ol>
          <button
            onClick={() =>
              run(async () =>
                onSelect(
                  await api(
                    `${base}/objects/${task.content.method_ref.id}?revision=${task.content.method_ref.revision}`,
                  ),
                ),
              )
            }
          >
            Inspect task method
          </button>
          <h4>Prerequisites</h4>
          <ul>
            {task.dependencies?.map((d: any) => (
              <li key={`${d.id}:${d.revision}`}>
                {d.id} · r{d.revision} · {d.status ?? "not opened"}
              </li>
            ))}
          </ul>
          <p>
            Use a depends_on relationship in Connections & evidence to add
            prerequisites before work starts.
          </p>
          {task.status === "open" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                run(async () => {
                  await api(
                    `${base}/tasks/${task.object_id}/assignment`,
                    "POST",
                    {
                      assignee_id: f.get("assignee"),
                      purpose: f.get("purpose"),
                    },
                    task.etag,
                  );
                  await selectTask(task.object_id);
                  setMessage(
                    "Invitation recorded. The named assignee must accept.",
                  );
                });
              }}
            >
              {field("assignee", "Invited assignee user ID")}
              {field("purpose", "Invitation purpose", true)}
              <button disabled={busy}>Invite assignee</button>
            </form>
          )}
          <ul>
            {task.invitations?.map((i: any) => (
              <li key={i.id}>
                {i.purpose} · {i.state} · expires{" "}
                {new Date(i.expires_at).toLocaleString()}
                {i.state === "pending" && i.assignee_id === userId && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      run(async () => {
                        await api(
                          `${base}/tasks/${task.object_id}/assignment/decisions`,
                          "POST",
                          {
                            invitation_id: i.id,
                            decision: f.get("decision"),
                            reason: f.get("reason"),
                          },
                          i.etag,
                        );
                        await selectTask(task.object_id);
                        setMessage("Assignment decision recorded.");
                      });
                    }}
                  >
                    <label>
                      Invitation decision
                      <select name="decision">
                        <option value="accept">Accept</option>
                        <option value="decline">Decline</option>
                      </select>
                    </label>
                    {field("reason", "Assignment decision reason", true)}
                    <button disabled={busy}>Record assignment decision</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {["in_progress", "returned_for_revision"].includes(task.status) && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                run(async () => {
                  const o = await api(
                    `${base}/tasks/${task.object_id}/results`,
                    "POST",
                    {
                      title: f.get("title"),
                      body: "",
                      language: "en",
                      source_refs: [],
                      method_ref: task.content.method_ref,
                      outcome: f.get("outcome"),
                      measurement_context: f.get("context"),
                      artifact_refs: f.getAll("artifacts").map(reference),
                    },
                    task.etag,
                  );
                  onSelect(o);
                  await onChange();
                  setMessage(
                    "Private research result saved. Publish it explicitly before submitting the task.",
                  );
                });
              }}
            >
              <h4>Record a result</h4>
              {field("title", "Result title")}
              <label>
                Research outcome
                <select name="outcome">
                  {[
                    "positive",
                    "negative",
                    "null",
                    "ambiguous",
                    "interrupted",
                  ].map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </label>
              {field("context", "Measurement context", true)}
              <label>
                Published result artifacts (optional)
                <select multiple name="artifacts">
                  {options("artifact")}
                </select>
              </label>
              <p>
                The result retains this task’s pinned method and definition.
              </p>
              <button disabled={busy}>Save research result</button>
            </form>
          )}
          {!["completed", "cancelled"].includes(task.status) && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                run(async () => {
                  const action = f.get("action");
                  await api(
                    `${base}/tasks/${task.object_id}/transitions`,
                    "POST",
                    {
                      action,
                      reason: f.get("reason"),
                      ...(action === "submit"
                        ? {
                            result_ref: reference(f.get("result")),
                            acceptance_evidence:
                              task.content.acceptance_criteria.map(
                                (_: string, i: number) =>
                                  String(f.get(`criterion${i}`) || ""),
                              ),
                          }
                        : {}),
                      ...(f.get("conflict")
                        ? { conflict_declaration: "none" }
                        : {}),
                    },
                    task.etag,
                  );
                  await selectTask(task.object_id);
                  await onChange();
                  setMessage("Task transition recorded.");
                });
              }}
            >
              <h4>Advance or review work</h4>
              <label>
                Task action
                <select name="action">
                  <option value="start">Start work</option>
                  <option value="submit">Submit for independent review</option>
                  <option
                    value="complete"
                    disabled={task.result_freshness !== "current"}
                  >
                    Complete after review
                  </option>
                  <option value="return">Return for revision</option>
                  <option value="cancel">Cancel task</option>
                </select>
              </label>
              <label>
                Published task result
                <select name="result">
                  <option value="">Choose result for submission</option>
                  {options("result")}
                </select>
              </label>
              {task.content.acceptance_criteria.map((c: string, i: number) => (
                <label key={i}>
                  Evidence for: {c}
                  <textarea name={`criterion${i}`} maxLength={4000} />
                </label>
              ))}
              {field("reason", "Task transition reason", true)}
              <label className="check">
                <input name="conflict" type="checkbox" />I have no conflict in
                this review.
              </label>
              <button disabled={busy}>Record task transition</button>
            </form>
          )}
          {task.result_id && (
            <button
              onClick={() =>
                run(async () =>
                  onSelect(
                    await api(
                      `${base}/objects/${task.result_id}?revision=${task.result_revision}`,
                    ),
                  ),
                )
              }
            >
              Inspect submitted result
            </button>
          )}
          <h4>Task history</h4>
          <ol>
            {task.events?.map((e: any) => (
              <li key={e.id}>
                {e.action} — {e.reason}
                {e.details.acceptance_evidence && (
                  <ul>
                    {e.details.acceptance_evidence.map(
                      (v: string, i: number) => (
                        <li key={i}>{v}</li>
                      ),
                    )}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </section>
  );
}
