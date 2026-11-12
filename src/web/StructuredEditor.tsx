import { useState } from "react";
export type Api = (
  path: string,
  method?: string,
  data?: unknown,
  etag?: string,
) => Promise<any>;
export function StructuredEditor({
  base,
  api,
  objects,
  selected,
  onSaved,
  onCancel,
  conflict,
  onRebase,
}: {
  base: string;
  api: Api;
  objects: any[];
  selected?: any;
  onSaved: (o: any) => void;
  onCancel: () => void;
  conflict?: any;
  onRebase: () => void;
}) {
  const [type, setType] = useState(selected?.type ?? "method"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const initial = selected?.content ?? {};
  function lines(value: any) {
    return Array.isArray(value) ? value.join("\n") : (value ?? "");
  }
  function field(
    name: string,
    label: string,
    required = true,
    multiline = true,
  ) {
    return (
      <label key={name}>
        {label}
        {multiline ? (
          <textarea
            name={name}
            defaultValue={lines(initial[name])}
            required={required}
            maxLength={50000}
          />
        ) : (
          <input
            name={name}
            defaultValue={lines(initial[name])}
            required={required}
            maxLength={200}
          />
        )}
      </label>
    );
  }
  function selector(
    name: string,
    label: string,
    types: string[],
    multiple = false,
  ) {
    const defaults = initial[name];
    return (
      <label key={name}>
        {label}
        <select
          name={name}
          multiple={multiple}
          defaultValue={
            multiple
              ? (defaults ?? []).map((r: any) => `${r.id}:${r.revision}`)
              : defaults
                ? `${defaults.id}:${defaults.revision}`
                : ""
          }
          required
        >
          {!multiple && <option value="">Choose published knowledge</option>}
          {objects
            .filter((o) => o.current_revision && types.includes(o.type))
            .map((o) => (
              <option value={`${o.id}:${o.current_revision}`} key={o.id}>
                {o.content.title} · {o.type} · r{o.current_revision}
              </option>
            ))}
        </select>
      </label>
    );
  }
  async function save(form: HTMLFormElement) {
    setError("");
    setBusy(true);
    try {
      const f = new FormData(form),
        str = (n: string) => String(f.get(n) ?? ""),
        list = (n: string) =>
          str(n)
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        ref = (n: string) => {
          const [id, revision] = str(n).split(":");
          return { id, revision: Number(revision) };
        };
      const c: any = {
        ...initial,
        title: str("title"),
        body: str("body"),
        language: "en",
        source_refs: initial.source_refs ?? [],
      };
      if (type === "method")
        Object.assign(c, {
          ordered_steps: list("ordered_steps"),
          metrics: list("metrics"),
          constraints: list("constraints"),
          ethical_constraints: list("ethical_constraints"),
        });
      if (type === "evidence")
        Object.assign(c, {
          source: str("source"),
          acquisition_context: str("acquisition_context"),
          source_group_ids: list("source_group_ids"),
        });
      if (type === "result")
        Object.assign(c, {
          method_ref: ref("method_ref"),
          outcome: str("outcome"),
          measurement_context: str("measurement_context"),
          artifact_refs: [],
        });
      if (type === "hypothesis")
        Object.assign(c, {
          proposition: str("proposition"),
          scope: str("scope"),
          qualifiers: list("qualifiers"),
          prediction: str("prediction"),
          falsification_criteria: str("falsification_criteria"),
        });
      if (type === "thesis")
        Object.assign(c, {
          interpretation: str("interpretation"),
          input_refs: f.getAll("input_refs").map((v) => {
            const [id, r] = String(v).split(":");
            return { id, revision: Number(r) };
          }),
          counterevidence_refs: initial.counterevidence_refs ?? [],
          limitations: str("limitations"),
        });
      if (type === "research_task")
        Object.assign(c, {
          method_ref: ref("method_ref"),
          rationale: str("rationale"),
          acceptance_criteria: list("acceptance_criteria"),
        });
      if (type === "assessment")
        Object.assign(c, {
          claim_ref: ref("claim_ref"),
          evidence_ref: ref("evidence_ref"),
          method_ref: ref("method_ref"),
          polarity: str("polarity"),
          scope: str("scope"),
          rationale: str("rationale"),
          uncertainty: {
            level: str("uncertainty_level"),
            rationale: str("uncertainty_rationale"),
          },
        });
      const o = selected
        ? await api(
            `${base}/objects/${selected.id}/${selected.has_draft ? "draft" : "corrections"}`,
            selected.has_draft ? "PATCH" : "POST",
            {
              content: c,
              reason: str("reason"),
              ...(!selected.has_draft
                ? { base_revision: selected.current_revision }
                : {}),
            },
            selected.etag,
          )
        : await api(`${base}/objects`, "POST", {
            type,
            schema_version: 1,
            content: c,
          });
      onSaved(o);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(e.currentTarget);
      }}
    >
      <h2>
        {selected ? "Revise structured knowledge" : "Build an evidence record"}
      </h2>
      <p>
        Save privately, then review and publish the exact revision. References
        point to published revisions.
      </p>
      <label>
        Knowledge type
        <select
          value={type}
          disabled={!!selected}
          onChange={(e) => setType(e.target.value)}
        >
          {[
            "method",
            "evidence",
            "result",
            "hypothesis",
            "assessment",
            "thesis",
            "research_task",
          ].map((t) => (
            <option value={t} key={t}>
              {t.replace("_", " ")}
            </option>
          ))}
        </select>
      </label>
      {field("title", "Title", true, false)}
      {field("body", "Description", false)}
      {type === "method" && (
        <>
          {field("ordered_steps", "Protocol steps — one per line")}
          {field("metrics", "Measured metrics — one per line")}
          {field("constraints", "Constraints — one per line", false)}
          {field(
            "ethical_constraints",
            "Ethical constraints — one per line",
            false,
          )}
        </>
      )}
      {type === "evidence" && (
        <>
          {field("source", "Source")}
          {field("acquisition_context", "Acquisition context")}
          {field(
            "source_group_ids",
            "Shared dataset identifiers (UUIDs, one per line)",
            false,
          )}
          <p>
            Use the same dataset identifier for evidence drawn from the same
            underlying data. Shared sources are not independent corroboration.
          </p>
        </>
      )}
      {type === "result" && (
        <>
          {selector("method_ref", "Method revision", ["method"])}
          <label>
            Outcome
            <select name="outcome" defaultValue={initial.outcome ?? "null"}>
              {["positive", "negative", "null", "ambiguous", "interrupted"].map(
                (v) => (
                  <option key={v}>{v}</option>
                ),
              )}
            </select>
          </label>
          {field("measurement_context", "Measurement context")}
          <p>Artifact uploads and task execution arrive in the next slice.</p>
        </>
      )}
      {type === "hypothesis" && (
        <>
          {field("proposition", "Proposition")}
          {field("scope", "Scope")}
          {field("qualifiers", "Qualifiers — one per line", false)}
          {field("prediction", "Prediction")}
          {field("falsification_criteria", "Falsification criteria")}
        </>
      )}
      {type === "thesis" && (
        <>
          {field("interpretation", "Interpretation")}
          {selector(
            "input_refs",
            "Referenced knowledge (select one or more)",
            [
              "claim",
              "observation",
              "hypothesis",
              "evidence",
              "assessment",
              "result",
            ],
            true,
          )}
          {field("limitations", "Limitations")}
        </>
      )}
      {type === "research_task" && (
        <>
          {selector("method_ref", "Method revision", ["method"])}
          {field("rationale", "Why this task is necessary")}
          {field("acceptance_criteria", "Acceptance criteria — one per line")}
          <p>
            This defines the task and its graph dependencies. Assignment and
            execution follow in slice 3.
          </p>
        </>
      )}
      {type === "assessment" && (
        <>
          {selector("claim_ref", "Claim or hypothesis revision", [
            "claim",
            "hypothesis",
          ])}
          {selector("evidence_ref", "Evidence revision", ["evidence"])}
          {selector("method_ref", "Assessment method revision", ["method"])}
          <label>
            Evidence interpretation
            <select
              name="polarity"
              defaultValue={initial.polarity ?? "supports"}
            >
              {["supports", "contradicts", "qualifies", "inconclusive"].map(
                (p) => (
                  <option key={p}>{p}</option>
                ),
              )}
            </select>
          </label>
          {field("scope", "Assessment scope")}
          {field("rationale", "Interpretation rationale")}
          <label>
            Uncertainty
            <select
              name="uncertainty_level"
              defaultValue={initial.uncertainty?.level ?? "unknown"}
            >
              {["unknown", "low", "medium", "high"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            Uncertainty rationale
            <textarea
              name="uncertainty_rationale"
              defaultValue={initial.uncertainty?.rationale ?? ""}
              required
            />
          </label>
        </>
      )}
      {selected && (
        <label>
          Reason for this revision
          <input name="reason" required maxLength={4000} />
        </label>
      )}
      <p role="alert">{error}</p>
      {conflict && (
        <aside aria-label="Revision conflict">
          <h3>A newer revision is available</h3>
          <p>
            Your form values are preserved. Compare the latest saved content
            before using it as the new base.
          </p>
          <ContentComparison value={conflict.content} />
          <button type="button" onClick={onRebase}>
            Use latest version as base
          </button>
        </aside>
      )}
      <div className="actions">
        <button className="primary" disabled={busy || !!conflict}>
          Save structured draft
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ContentComparison({ value }: { value: any }) {
  if (value === null || typeof value !== "object")
    return <span>{String(value ?? "")}</span>;
  return (
    <dl>
      {Object.entries(value).map(([key, item]) => (
        <div key={key}>
          <dt>{key.replaceAll("_", " ")}</dt>
          <dd>
            <ContentComparison value={item} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
