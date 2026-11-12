export function KnowledgeDetails({
  object,
  onReference,
}: {
  object: any;
  onReference: (r: { id: string; revision: number }) => void;
}) {
  const c = object.content;
  const labels: Record<string, string> = {
    kind: "Artifact kind",
    license: "License / usage terms",
    filename: "Filename",
    sha256: "SHA-256 digest",
    media_type: "Media type",
    byte_size: "Size in bytes",
    custodian: "Custodian",
    location: "Physical location",
    access_protocol: "Access protocol",
    integrity_metadata: "Integrity and identification",
    proposition: "Proposition",
    prediction: "Prediction",
    falsification_criteria: "Falsification criteria",
    ordered_steps: "Protocol steps",
    metrics: "Metrics",
    constraints: "Constraints",
    ethical_constraints: "Ethical constraints",
    source: "Source",
    acquisition_context: "Acquisition context",
    source_group_ids: "Shared dataset identifiers",
    outcome: "Result outcome",
    measurement_context: "Measurement context",
    interpretation: "Interpretation",
    limitations: "Limitations",
    rationale: "Rationale",
    acceptance_criteria: "Acceptance criteria",
    polarity: "Evidence polarity",
  };
  const refs: Record<string, string> = {
    claim_ref: "Claim",
    evidence_ref: "Evidence",
    method_ref: "Method",
  };
  return (
    <section aria-label="Structured knowledge details">
      {object.validity !== "active" && (
        <aside className="notice" role="alert">
          This revision is {object.validity}. Its historical content is
          retained; do not treat it as active evidence.
        </aside>
      )}
      {object.freshness !== "current" && (
        <p className="notice">
          Freshness is {object.freshness}. Source revisions may have changed or
          are awaiting revalidation.
        </p>
      )}
      {Object.entries(labels)
        .filter(([k]) => c[k] !== undefined)
        .map(([k, label]) => (
          <div key={k}>
            <h3>{label}</h3>
            {Array.isArray(c[k]) ? (
              <ul>
                {c[k].map((v: string, i: number) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            ) : (
              <p className="body">{c[k]}</p>
            )}
          </div>
        ))}
      {c.uncertainty && (
        <div>
          <h3>Uncertainty</h3>
          <p>
            {c.uncertainty.level} — {c.uncertainty.rationale}
          </p>
          {c.uncertainty.interval && (
            <p>
              Calibrated interval {c.uncertainty.interval.join(" to ")}:{" "}
              {c.uncertainty.calibration_method}
            </p>
          )}
        </div>
      )}
      {Object.entries(refs)
        .filter(([k]) => c[k])
        .map(([k, label]) => (
          <p key={k}>
            <button onClick={() => onReference(c[k])}>
              Inspect {label.toLowerCase()} revision {c[k].revision}
            </button>
          </p>
        ))}
      {[
        ...(c.source_refs ?? []),
        ...(c.artifact_refs ?? []),
        ...(c.input_refs ?? []),
        ...(c.counterevidence_refs ?? []),
      ].map((r: any, i: number) => (
        <p key={i}>
          <button onClick={() => onReference(r)}>
            Inspect source {r.id} · revision {r.revision}
          </button>
        </p>
      ))}
      {c.source_group_ids?.length > 0 && (
        <p>
          Evidence in the same dataset group is correlated, not independent
          confirmation.
        </p>
      )}
    </section>
  );
}
