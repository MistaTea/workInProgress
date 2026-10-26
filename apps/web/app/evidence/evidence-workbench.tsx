"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, FileSearch, LoaderCircle, RefreshCw } from "lucide-react";

type Outcome = "supports" | "needs_follow_up";
type Status =
  | "not_reviewed"
  | "needs_revalidation"
  | "reviewed_for_version"
  | "no_linked_evidence"
  | "unavailable_source";
interface Review {
  id: string;
  outcome: Outcome;
  comment: string | null;
  reviewedAt: string;
  reviewer: { displayName: string };
  requirementVersion: number;
}
interface Summary {
  id: string;
  reference: string;
  title: string;
  currentVersion: number;
  status: Status;
  reasons: string[];
  latestReview: Review | null;
}
interface Detail extends Summary {
  statement: string;
  rationale: string | null;
  expectedFingerprints: string;
  sources: Array<{
    artefactType: string;
    artefactId: string;
    label: string;
    savedExcerpt: string | null;
    currentText: string | null;
    documentName: string | null;
    documentVersion: number | null;
    availability: "available" | "missing" | "unsupported";
    fingerprint: string | null;
  }>;
  history: Review[];
}
const labels: Record<Status, string> = {
  not_reviewed: "Not reviewed",
  needs_revalidation: "Needs revalidation",
  reviewed_for_version: "Reviewed for this version",
  no_linked_evidence: "No linked evidence",
  unavailable_source: "Source unavailable",
};
const outcomeLabel = (outcome: Outcome) =>
  outcome === "supports" ? "Supports requirement" : "Needs follow-up";
const API = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api").replace(/\/$/, "");
class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function request<T>(
  path: string,
  signal: AbortSignal,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    signal,
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok)
    throw new RequestError(
      response.status,
      `Request failed (${response.status}). Please try again.`,
    );
  return response.json() as Promise<T>;
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Unable to load evidence.";
function Loading({ children }: { children: React.ReactNode }) {
  return (
    <div className="loading-panel" role="status">
      <LoaderCircle className="spin" size={20} aria-hidden="true" />
      {children}
    </div>
  );
}
function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="error-banner" role="alert">
      <AlertCircle size={18} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function EvidenceWorkbench() {
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [projectId, setProjectId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    request<Array<{ id: string; name: string }>>("/projects", controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setProjects(data);
        setProjectId((id) =>
          data.some((p) => p.id === id) ? id : (data[0]?.id ?? ""),
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload]);
  return (
    <main className="app-shell review-shell evidence-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <div className="brand-mark">BA</div>
          <div>
            <strong>BA Clarity</strong>
            <span>Evidence-led business analysis</span>
          </div>
        </div>
        <nav className="nav-list">
          <a href="/">Home</a>
          <a href="/reviews">Reviews</a>
          <a className="active" aria-current="page" href="/evidence">
            Evidence
          </a>
        </nav>
      </aside>
      <section className="review-workspace">
        <header className="review-topbar">
          <div>
            <p className="eyebrow">Source-grounded review</p>
            <h1>Evidence revalidation</h1>
          </div>
          <div className="review-topbar-actions">
            <label className="field-label compact">
              <span>Project</span>
              <select
                value={projectId}
                disabled={loading || !projects.length}
                onChange={(event) => setProjectId(event.target.value)}
              >
                {!projects.length && (
                  <option value="">No project available</option>
                )}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="icon-button"
              type="button"
              disabled={loading}
              onClick={() => setReload((n) => n + 1)}
              aria-label="Refresh projects"
            >
              <RefreshCw size={18} aria-hidden="true" />
            </button>
          </div>
        </header>
        <p className="evidence-notice">
          Compare saved excerpts with current sources. Acknowledgements record a
          human review of an exact requirement version and source snapshot—not
          verified truth or stakeholder approval.
        </p>
        {error && <ErrorBanner>{error}</ErrorBanner>}
        {loading ? (
          <Loading>Loading projects</Loading>
        ) : projectId ? (
          <ProjectEvidence
            key={`${projectId}:${reload}`}
            projectId={projectId}
          />
        ) : (
          !error && (
            <div className="empty-state">
              No projects are available. Create a project in your existing
              workflow first.
            </div>
          )
        )}
      </section>
    </main>
  );
}

function ProjectEvidence({ projectId }: { projectId: string }) {
  const [queue, setQueue] = useState<Summary[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    request<Summary[]>(
      `/projects/${encodeURIComponent(projectId)}/evidence-review`,
      controller.signal,
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        setQueue(data);
        setSelected((id) =>
          data.some((r) => r.id === id) ? id : (data[0]?.id ?? ""),
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, reload]);
  return (
    <section className="review-board" aria-label="Evidence review board">
      <aside className="draft-queue" aria-label="Requirements queue">
        <div className="queue-heading">
          <div>
            <h2>Requirements</h2>
            <span>{queue.length} in this project</span>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Refresh requirement queue"
            disabled={loading}
            onClick={() => setReload((n) => n + 1)}
          >
            <RefreshCw size={17} aria-hidden="true" />
          </button>
        </div>
        {error && <ErrorBanner>{error}</ErrorBanner>}
        {loading ? (
          <Loading>Loading requirements</Loading>
        ) : (
          <div className="draft-list">
            {queue.map((item) => (
              <button
                className={`draft-row evidence-queue-row${selected === item.id ? " active" : ""}`}
                type="button"
                key={item.id}
                aria-pressed={selected === item.id}
                onClick={() => setSelected(item.id)}
              >
                <span>
                  <strong>
                    {item.reference} · {item.title}
                  </strong>
                  <small>
                    Version {item.currentVersion} · {labels[item.status]}
                  </small>
                  {item.latestReview && (
                    <small>
                      Last review: {outcomeLabel(item.latestReview.outcome)} · v
                      {item.latestReview.requirementVersion}
                    </small>
                  )}
                </span>
              </button>
            ))}
            {!queue.length && !error && (
              <div className="empty-state">
                <FileSearch size={22} aria-hidden="true" />
                No requirements in this project.
              </div>
            )}
          </div>
        )}
      </aside>
      <section className="candidate-workarea" aria-label="Requirement evidence">
        {selected ? (
          <RequirementEvidence
            key={selected}
            requirementId={selected}
            onSaved={(detail) =>
              setQueue((rows) =>
                rows.map((row) => (row.id === detail.id ? detail : row)),
              )
            }
          />
        ) : (
          <div className="loading-panel">
            Select a requirement to compare its evidence.
          </div>
        )}
      </section>
    </section>
  );
}

function RequirementEvidence({
  requirementId,
  onSaved,
}: {
  requirementId: string;
  onSaved: (detail: Detail) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const [comment, setComment] = useState("");
  const [reload, setReload] = useState(0);
  const submission = useRef<{ payload: string; requestId: string } | null>(
    null,
  );
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setDetail(null);
    setError("");
    setConflict(false);
    setNotice("");
    submission.current = null;
    request<Detail>(
      `/requirements/${encodeURIComponent(requirementId)}/evidence-review`,
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) setDetail(data);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [requirementId, reload]);
  const canSupport =
    detail &&
    !["no_linked_evidence", "unavailable_source"].includes(detail.status) &&
    detail.sources.length > 0 &&
    detail.sources.every(
      (s) =>
        s.availability === "available" &&
        s.currentText !== null &&
        s.fingerprint !== null,
    );
  async function submit(outcome: Outcome) {
    if (
      !detail ||
      pending.current ||
      conflict ||
      (outcome === "supports" && !canSupport)
    )
      return;
    if (outcome === "needs_follow_up" && !comment.trim()) {
      setError("Add a comment explaining what needs follow-up.");
      return;
    }
    const body = {
      expectedVersion: detail.currentVersion,
      expectedFingerprints: detail.expectedFingerprints,
      outcome,
      comment: comment.trim(),
    };
    const payload = JSON.stringify(body);
    if (submission.current?.payload !== payload)
      submission.current = { payload, requestId: crypto.randomUUID() };
    const controller = new AbortController();
    pending.current = controller;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const updated = await request<Detail>(
        `/requirements/${encodeURIComponent(requirementId)}/evidence-review`,
        controller.signal,
        { ...body, requestId: submission.current.requestId },
      );
      if (controller.signal.aborted) return;
      setDetail(updated);
      onSaved(updated);
      setComment("");
      // Keep the ID for an identical repeat click after success as well as retries.
      setNotice(
        "Evidence review saved for this requirement version and source snapshot. Approval status was not changed.",
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof RequestError && error.status === 409) {
        setConflict(true);
        setError(
          "The requirement or source snapshot changed. Refresh evidence and review it again before submitting. Your decision has not been automatically resubmitted.",
        );
      } else
        setError(
          `${message(error)} If the response was interrupted, retrying the same decision and comment safely reuses its request ID.`,
        );
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setSaving(false);
      }
    }
  }
  return (
    <article className="candidate-panel evidence-detail">
      <div className="evidence-detail-toolbar">
        <h2>Evidence comparison</h2>
        <button
          className="button secondary"
          type="button"
          disabled={loading || saving}
          onClick={() => setReload((n) => n + 1)}
        >
          <RefreshCw size={16} aria-hidden="true" />
          Refresh evidence
        </button>
      </div>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {notice && (
        <p className="reviewed-banner" role="status">
          {notice}
        </p>
      )}
      {loading ? (
        <Loading>Loading requirement and sources</Loading>
      ) : (
        detail && (
          <>
            <header>
              <p className="eyebrow">
                {detail.reference} · Requirement version {detail.currentVersion}
              </p>
              <h2>{detail.title}</h2>
              <span className="review-pill">{labels[detail.status]}</span>
            </header>
            <p className="evidence-text">{detail.statement}</p>
            {detail.rationale && (
              <section>
                <h3>Rationale</h3>
                <p className="evidence-text">{detail.rationale}</p>
              </section>
            )}
            {detail.reasons.length > 0 && (
              <section>
                <h3>Review status reasons</h3>
                <ul>
                  {detail.reasons.map((reason, index) => (
                    <li key={index}>{reason.replace(/_/g, " ")}</li>
                  ))}
                </ul>
              </section>
            )}
            <section aria-label="Linked source comparisons">
              <h3>Linked evidence</h3>
              {!detail.sources.length && (
                <div className="empty-state">
                  No linked evidence. Record follow-up to identify the sources
                  needed.
                </div>
              )}
              {detail.sources.map((source, index) => (
                <article
                  className="evidence-source-card"
                  key={`${source.artefactType}:${source.artefactId}:${index}`}
                >
                  <h4>{source.label}</h4>
                  <p className="evidence-source-meta">
                    {source.documentName ?? source.artefactType}
                    {source.documentVersion !== null
                      ? ` · Document version ${source.documentVersion}`
                      : ""}{" "}
                    · {source.availability}
                  </p>
                  <div className="evidence-comparison">
                    <section>
                      <h5>Saved excerpt</h5>
                      <p className="evidence-text">
                        {source.savedExcerpt ??
                          "No excerpt was saved with this reference."}
                      </p>
                    </section>
                    <section>
                      <h5>Current source · full chunk</h5>
                      <p className="evidence-text">
                        {source.availability === "available"
                          ? (source.currentText ?? "No current text available.")
                          : "Current source cannot be reviewed. It may be missing, outside this project, or an unsupported source type."}
                      </p>
                    </section>
                  </div>
                </article>
              ))}
            </section>
            <section
              className="evidence-decision"
              aria-label="Record evidence review"
            >
              <h3>Record your source review</h3>
              <p>
                This is an evidence acknowledgement only. It does not approve or
                edit the requirement or its sources.
              </p>
              {!canSupport && (
                <p>
                  “Supports requirement” is unavailable until all linked sources
                  can be reviewed in this project.
                </p>
              )}
              <label className="field-label">
                <span>Review comment (required for follow-up; up to 4,000 characters)</span>
                <textarea
                  rows={3}
                  maxLength={4000}
                  value={comment}
                  disabled={saving}
                  onChange={(event) => setComment(event.target.value)}
                />
              </label>
              <div className="review-actions">
                {canSupport && (
                  <button
                    className="button primary"
                    type="button"
                    disabled={saving || conflict}
                    onClick={() => void submit("supports")}
                  >
                    Supports requirement
                  </button>
                )}
                <button
                  className="button secondary"
                  type="button"
                  disabled={saving || conflict}
                  onClick={() => void submit("needs_follow_up")}
                >
                  Needs follow-up
                </button>
                {saving && <span role="status">Saving review…</span>}
              </div>
            </section>
            <section aria-label="Evidence review history">
              <h3>Review history</h3>
              <p>
                Historical decisions apply only to their recorded version and
                source snapshot.
              </p>
              {!detail.history.length ? (
                <p>No evidence reviews recorded.</p>
              ) : (
                <ol className="evidence-history">
                  {detail.history.map((review) => (
                    <li key={review.id}>
                      <strong>
                        {outcomeLabel(review.outcome)} · Requirement v
                        {review.requirementVersion}
                      </strong>
                      <p>
                        {review.reviewer.displayName} ·{" "}
                        <time dateTime={review.reviewedAt}>
                          {new Date(review.reviewedAt).toLocaleString()}
                        </time>
                      </p>
                      {review.comment && (
                        <p className="evidence-text">{review.comment}</p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )
      )}
    </article>
  );
}
