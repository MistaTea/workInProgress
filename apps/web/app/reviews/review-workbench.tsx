"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  LoaderCircle,
  RefreshCw,
  Search,
  X
} from "lucide-react";

type ReviewStatus = "generated" | "under_ba_review" | "accepted_by_ba" | "rejected_by_ba";
type RequirementType = "business" | "functional" | "non_functional" | "transition" | "reporting" | "data" | "integration";
type Priority = "must" | "should" | "could" | "wont";

interface Project {
  id: string;
  name: string;
  status: string;
}

interface ReviewSummary {
  totalCandidates: number;
  reviewedCandidates: number;
  acceptedCandidates: number;
  rejectedCandidates: number;
  pendingCandidates: number;
}

interface DraftListItem {
  id: string;
  aiJobId: string | null;
  reviewStatus: ReviewStatus;
  summary: string;
  model: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewSummary: ReviewSummary;
}

interface SourceReference {
  artefactType: string;
  artefactId: string;
  label: string;
  excerpt?: string;
  location?: string;
}

interface CreatedRequirement {
  id: string;
  reference: string;
  title: string;
  status: string;
}

interface CandidateReview {
  decision: "accepted" | "rejected";
  comments: string | null;
  createdRequirement: CreatedRequirement | null;
}

interface RequirementCandidate {
  candidateIndex: number;
  title: string;
  statement: string;
  type: RequirementType;
  priority: Priority;
  rationale?: string;
  assumptions: string[];
  openQuestions: string[];
  sourceReferences: SourceReference[];
  review: CandidateReview | null;
}

interface DraftDetail extends DraftListItem {
  requirementCandidates: RequirementCandidate[];
}

interface CandidateFormState {
  title: string;
  statement: string;
  type: RequirementType;
  priority: Priority;
  rationale: string;
  comments: string;
  rejectionReason: string;
}

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api").replace(/\/$/, "");

const reviewStatusLabels: Record<ReviewStatus, string> = {
  generated: "Generated",
  under_ba_review: "In BA review",
  accepted_by_ba: "BA reviewed",
  rejected_by_ba: "Rejected by BA"
};

const requirementTypes: RequirementType[] = [
  "business",
  "functional",
  "non_functional",
  "transition",
  "reporting",
  "data",
  "integration"
];

const priorities: Priority[] = ["must", "should", "could", "wont"];

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store"
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

function formatStatus(status: string) {
  return status.replace(/_/g, " ");
}

function shortDate(value: string | null) {
  if (!value) {
    return "Not completed";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function candidateState(candidate: RequirementCandidate): CandidateFormState {
  return {
    title: candidate.title,
    statement: candidate.statement,
    type: candidate.type,
    priority: candidate.priority,
    rationale: candidate.rationale ?? "",
    comments: "",
    rejectionReason: ""
  };
}

export function ReviewWorkbench() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [drafts, setDrafts] = useState<DraftListItem[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [draftDetail, setDraftDetail] = useState<DraftDetail | null>(null);
  const [activeCandidateIndex, setActiveCandidateIndex] = useState(0);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [reviewingCandidate, setReviewingCandidate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  const activeCandidate = useMemo(
    () =>
      draftDetail?.requirementCandidates.find((candidate) => candidate.candidateIndex === activeCandidateIndex) ??
      draftDetail?.requirementCandidates[0] ??
      null,
    [activeCandidateIndex, draftDetail]
  );

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    setError(null);
    try {
      const data = await fetchJson<Project[]>("/projects");
      setProjects(data);
      setSelectedProjectId((current) => current || data[0]?.id || "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load projects.");
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  const loadDrafts = useCallback(async (projectId: string) => {
    if (!projectId) {
      setDrafts([]);
      setSelectedDraftId("");
      setDraftDetail(null);
      return;
    }

    setLoadingDrafts(true);
    setError(null);
    try {
      const data = await fetchJson<DraftListItem[]>(`/projects/${projectId}/ai/drafts`);
      setDrafts(data);
      setSelectedDraftId((current) => {
        if (current && data.some((draft) => draft.id === current)) {
          return current;
        }

        return data[0]?.id || "";
      });
      if (data.length === 0) {
        setDraftDetail(null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load AI drafts.");
    } finally {
      setLoadingDrafts(false);
    }
  }, []);

  const loadDraftDetail = useCallback(async (projectId: string, draftId: string) => {
    if (!projectId || !draftId) {
      setDraftDetail(null);
      return;
    }

    setLoadingDetail(true);
    setError(null);
    try {
      const data = await fetchJson<DraftDetail>(`/projects/${projectId}/ai/drafts/${draftId}`);
      setDraftDetail(data);
      setActiveCandidateIndex((current) => {
        if (data.requirementCandidates.some((candidate) => candidate.candidateIndex === current)) {
          return current;
        }

        return data.requirementCandidates[0]?.candidateIndex ?? 0;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load AI draft detail.");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    void loadDrafts(selectedProjectId);
  }, [loadDrafts, selectedProjectId]);

  useEffect(() => {
    void loadDraftDetail(selectedProjectId, selectedDraftId);
  }, [loadDraftDetail, selectedDraftId, selectedProjectId]);

  async function refresh() {
    await loadProjects();
    if (selectedProjectId) {
      await loadDrafts(selectedProjectId);
    }
    if (selectedProjectId && selectedDraftId) {
      await loadDraftDetail(selectedProjectId, selectedDraftId);
    }
  }

  async function submitCandidateReview(candidate: RequirementCandidate, form: CandidateFormState, decision: "accepted" | "rejected") {
    if (!selectedProjectId || !selectedDraftId) {
      return;
    }

    const comments = form.comments.trim();
    const rejectionReason = form.rejectionReason.trim();
    if (decision === "rejected" && rejectionReason.length === 0) {
      setError("A rejection reason is required.");
      return;
    }

    setReviewingCandidate(candidate.candidateIndex);
    setError(null);
    try {
      const body =
        decision === "accepted"
          ? {
              decision,
              ...(comments.length > 0 ? { comments } : {}),
              requirement: {
                title: form.title.trim(),
                statement: form.statement.trim(),
                type: form.type,
                priority: form.priority,
                rationale: form.rationale.trim().length > 0 ? form.rationale.trim() : null
              }
            }
          : {
              decision,
              comments: rejectionReason
            };

      const updatedDraft = await fetchJson<DraftDetail>(
        `/projects/${selectedProjectId}/ai/drafts/${selectedDraftId}/requirement-candidates/${candidate.candidateIndex}/review`,
        {
          method: "POST",
          body: JSON.stringify(body)
        }
      );
      setDraftDetail(updatedDraft);
      await loadDrafts(selectedProjectId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to submit review decision.");
    } finally {
      setReviewingCandidate(null);
    }
  }

  return (
    <main className="app-shell review-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <div className="brand-mark">BA</div>
          <div>
            <strong>Workbench</strong>
            <span>Senior BA Copilot</span>
          </div>
        </div>
        <nav className="nav-list">
          {[
            { label: "Home", href: "/" },
            { label: "Projects", href: "#" },
            { label: "Requirements", href: "#" },
            { label: "Documents", href: "#" },
            { label: "Traceability", href: "#" },
            { label: "Reviews", href: "/reviews" },
            { label: "Integrations", href: "#" },
            { label: "Reports", href: "#" }
          ].map((item) => (
            <a className={item.label === "Reviews" ? "active" : ""} href={item.href} key={item.label}>
              {item.label}
            </a>
          ))}
        </nav>
      </aside>

      <section className="review-workspace">
        <header className="review-topbar">
          <div>
            <p className="eyebrow">AI draft governance</p>
            <h1>BA review queue</h1>
          </div>
          <div className="review-topbar-actions">
            <label className="field-label compact">
              <span>Project</span>
              <select
                aria-label="Project"
                disabled={loadingProjects || projects.length === 0}
                onChange={(event) => setSelectedProjectId(event.target.value)}
                value={selectedProjectId}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="icon-button" disabled={loadingProjects || loadingDrafts || loadingDetail} onClick={refresh} type="button">
              <RefreshCw size={17} aria-hidden="true" />
              <span className="sr-only">Refresh</span>
            </button>
          </div>
        </header>

        {error ? (
          <div className="error-banner" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        <section className="review-board" aria-label="AI draft review board">
          <aside className="draft-queue" aria-label="AI draft queue">
            <div className="queue-heading">
              <div>
                <h2>{selectedProject?.name ?? "No project selected"}</h2>
                <span>{drafts.length} AI drafts</span>
              </div>
              {loadingDrafts ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <ClipboardCheck size={18} aria-hidden="true" />}
            </div>

            <div className="draft-list">
              {drafts.map((draft) => (
                <button
                  className={draft.id === selectedDraftId ? "draft-row active" : "draft-row"}
                  key={draft.id}
                  onClick={() => setSelectedDraftId(draft.id)}
                  type="button"
                >
                  <span className={`status-dot ${draft.reviewStatus}`} aria-hidden="true" />
                  <span>
                    <strong>{draft.summary}</strong>
                    <small>
                      {draft.reviewSummary.pendingCandidates} pending of {draft.reviewSummary.totalCandidates} candidates
                    </small>
                  </span>
                  <em>{reviewStatusLabels[draft.reviewStatus]}</em>
                </button>
              ))}

              {!loadingDrafts && drafts.length === 0 ? (
                <div className="empty-state">
                  <FileSearch size={22} aria-hidden="true" />
                  <span>No AI requirement drafts are available for this project.</span>
                </div>
              ) : null}
            </div>
          </aside>

          <section className="candidate-workarea">
            {loadingDetail ? (
              <div className="loading-panel">
                <LoaderCircle className="spin" size={22} aria-hidden="true" />
                <span>Loading draft evidence</span>
              </div>
            ) : draftDetail && activeCandidate ? (
              <>
                <div className="draft-summary">
                  <div>
                    <span className={`review-pill ${draftDetail.reviewStatus}`}>{reviewStatusLabels[draftDetail.reviewStatus]}</span>
                    <h2>{draftDetail.summary}</h2>
                    <p>
                      Created {shortDate(draftDetail.createdAt)}. Reviewed {shortDate(draftDetail.reviewedAt)}.
                    </p>
                  </div>
                  <div className="summary-metrics" aria-label="Draft review metrics">
                    <span>
                      <strong>{draftDetail.reviewSummary.acceptedCandidates}</strong>
                      Accepted
                    </span>
                    <span>
                      <strong>{draftDetail.reviewSummary.rejectedCandidates}</strong>
                      Rejected
                    </span>
                    <span>
                      <strong>{draftDetail.reviewSummary.pendingCandidates}</strong>
                      Pending
                    </span>
                  </div>
                </div>

                <div className="candidate-layout">
                  <nav className="candidate-tabs" aria-label="Requirement candidates">
                    {draftDetail.requirementCandidates.map((candidate) => (
                      <button
                        className={candidate.candidateIndex === activeCandidate.candidateIndex ? "candidate-tab active" : "candidate-tab"}
                        key={candidate.candidateIndex}
                        onClick={() => setActiveCandidateIndex(candidate.candidateIndex)}
                        type="button"
                      >
                        {candidate.review?.decision === "accepted" ? (
                          <CheckCircle2 size={16} aria-hidden="true" />
                        ) : candidate.review?.decision === "rejected" ? (
                          <X size={16} aria-hidden="true" />
                        ) : (
                          <Search size={16} aria-hidden="true" />
                        )}
                        <span>{candidate.title}</span>
                      </button>
                    ))}
                  </nav>

                  <CandidateReviewPanel
                    candidate={activeCandidate}
                    isSubmitting={reviewingCandidate === activeCandidate.candidateIndex}
                    onSubmit={submitCandidateReview}
                  />
                </div>
              </>
            ) : (
              <div className="loading-panel">
                <FileSearch size={22} aria-hidden="true" />
                <span>Select a project with AI drafts to start reviewing.</span>
              </div>
            )}
          </section>
        </section>
      </section>
    </main>
  );
}

interface CandidateReviewPanelProps {
  candidate: RequirementCandidate;
  isSubmitting: boolean;
  onSubmit: (candidate: RequirementCandidate, form: CandidateFormState, decision: "accepted" | "rejected") => Promise<void>;
}

function CandidateReviewPanel({ candidate, isSubmitting, onSubmit }: CandidateReviewPanelProps) {
  const [form, setForm] = useState<CandidateFormState>(() => candidateState(candidate));
  const reviewed = candidate.review !== null;

  useEffect(() => {
    setForm(candidateState(candidate));
  }, [candidate]);

  function updateForm<K extends keyof CandidateFormState>(key: K, value: CandidateFormState[K]) {
    setForm((current) => ({
      ...current,
      [key]: value
    }));
  }

  return (
    <article className="candidate-panel">
      <header className="candidate-heading">
        <div>
          <span className="candidate-index">Candidate {candidate.candidateIndex + 1}</span>
          <h2>{candidate.title}</h2>
        </div>
        <span className={reviewed ? `decision-badge ${candidate.review?.decision}` : "decision-badge pending"}>
          {candidate.review?.decision ?? "pending"}
        </span>
      </header>

      {reviewed ? (
        <div className="reviewed-banner">
          {candidate.review?.decision === "accepted" ? <CheckCircle2 size={18} aria-hidden="true" /> : <X size={18} aria-hidden="true" />}
          <span>
            {candidate.review?.decision === "accepted"
              ? `Created ${candidate.review.createdRequirement?.reference ?? "a draft requirement"}.`
              : candidate.review?.comments}
          </span>
        </div>
      ) : null}

      <div className="candidate-grid">
        <section className="candidate-edit">
          <label className="field-label">
            <span>Requirement title</span>
            <input
              disabled={reviewed || isSubmitting}
              onChange={(event) => updateForm("title", event.target.value)}
              value={form.title}
            />
          </label>

          <label className="field-label">
            <span>Requirement statement</span>
            <textarea
              disabled={reviewed || isSubmitting}
              onChange={(event) => updateForm("statement", event.target.value)}
              rows={5}
              value={form.statement}
            />
          </label>

          <div className="field-pair">
            <label className="field-label">
              <span>Type</span>
              <select
                disabled={reviewed || isSubmitting}
                onChange={(event) => updateForm("type", event.target.value as RequirementType)}
                value={form.type}
              >
                {requirementTypes.map((type) => (
                  <option key={type} value={type}>
                    {formatStatus(type)}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-label">
              <span>Priority</span>
              <select
                disabled={reviewed || isSubmitting}
                onChange={(event) => updateForm("priority", event.target.value as Priority)}
                value={form.priority}
              >
                {priorities.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field-label">
            <span>Rationale</span>
            <textarea
              disabled={reviewed || isSubmitting}
              onChange={(event) => updateForm("rationale", event.target.value)}
              rows={3}
              value={form.rationale}
            />
          </label>

          <label className="field-label">
            <span>BA acceptance comment</span>
            <textarea
              disabled={reviewed || isSubmitting}
              onChange={(event) => updateForm("comments", event.target.value)}
              rows={2}
              value={form.comments}
            />
          </label>

          <label className="field-label">
            <span>Rejection reason</span>
            <textarea
              disabled={reviewed || isSubmitting}
              onChange={(event) => updateForm("rejectionReason", event.target.value)}
              rows={2}
              value={form.rejectionReason}
            />
          </label>

          <div className="review-actions">
            <button
              className="button primary"
              disabled={reviewed || isSubmitting}
              onClick={() => void onSubmit(candidate, form, "accepted")}
              type="button"
            >
              {isSubmitting ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
              Accept
            </button>
            <button
              className="button danger"
              disabled={reviewed || isSubmitting}
              onClick={() => void onSubmit(candidate, form, "rejected")}
              type="button"
            >
              <X size={16} aria-hidden="true" />
              Reject
            </button>
          </div>
        </section>

        <aside className="evidence-panel" aria-label="Candidate evidence">
          <h3>Source evidence</h3>
          <div className="evidence-list">
            {candidate.sourceReferences.map((source) => (
              <article className="evidence-item" key={`${source.artefactType}:${source.artefactId}:${source.location ?? ""}`}>
                <strong>{source.label}</strong>
                <span>
                  {formatStatus(source.artefactType)}
                  {source.location ? ` - ${source.location}` : ""}
                </span>
                {source.excerpt ? <p>{source.excerpt}</p> : null}
              </article>
            ))}
          </div>

          {candidate.assumptions.length > 0 ? (
            <div className="evidence-group">
              <h3>Assumptions</h3>
              <ul>
                {candidate.assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {candidate.openQuestions.length > 0 ? (
            <div className="evidence-group">
              <h3>Open questions</h3>
              <ul>
                {candidate.openQuestions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </article>
  );
}
