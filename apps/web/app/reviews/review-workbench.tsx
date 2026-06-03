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

interface DemoBootstrapResponse {
  project: Project;
  aiDraft: {
    id: string;
  };
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

interface RequirementListItem extends CreatedRequirement {
  statement: string;
  type: RequirementType;
  priority: Priority;
  currentVersion: number;
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

interface ApprovalEvidence {
  id: string;
  decision: "approved" | "changes_requested" | "rejected";
  reviewerName: string;
  reviewerEmail: string | null;
  comments: string | null;
  decidedAt: string;
}

interface ReviewPacket {
  id: string;
  name: string;
  version: number;
  status: string;
  reviewUrl?: string;
  token?: string;
  createdAt: string;
  approvedAt: string | null;
  items: Array<{
    requirement: RequirementListItem;
    requirementVersion: {
      version: number;
      title: string;
      statement: string;
    };
  }>;
  reviewLinks: Array<{
    status: string;
    expiresAt: string;
    stakeholder: {
      name: string;
      email: string | null;
    } | null;
    approvals: ApprovalEvidence[];
  }>;
  approvals: ApprovalEvidence[];
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

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api").replace(/\/$/, "");

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
  const [requirements, setRequirements] = useState<RequirementListItem[]>([]);
  const [reviewPackets, setReviewPackets] = useState<ReviewPacket[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [selectedRequirementIds, setSelectedRequirementIds] = useState<string[]>([]);
  const [packetName, setPacketName] = useState("");
  const [stakeholderName, setStakeholderName] = useState("Operations Manager");
  const [stakeholderEmail, setStakeholderEmail] = useState("ops.manager@example.com");
  const [latestReviewUrl, setLatestReviewUrl] = useState<string | null>(null);
  const [draftDetail, setDraftDetail] = useState<DraftDetail | null>(null);
  const [activeCandidateIndex, setActiveCandidateIndex] = useState(0);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [loadingReviewPackets, setLoadingReviewPackets] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [reviewingCandidate, setReviewingCandidate] = useState<number | null>(null);
  const [creatingPacket, setCreatingPacket] = useState(false);
  const [bootstrappingDemo, setBootstrappingDemo] = useState(false);
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

  const loadRequirements = useCallback(async (projectId: string) => {
    if (!projectId) {
      setRequirements([]);
      setSelectedRequirementIds([]);
      return;
    }

    try {
      const data = await fetchJson<RequirementListItem[]>(`/projects/${projectId}/requirements`);
      setRequirements(data);
      setSelectedRequirementIds((current) => current.filter((id) => data.some((requirement) => requirement.id === id)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load requirements.");
    }
  }, []);

  const loadReviewPackets = useCallback(async (projectId: string) => {
    if (!projectId) {
      setReviewPackets([]);
      return;
    }

    setLoadingReviewPackets(true);
    try {
      const data = await fetchJson<ReviewPacket[]>(`/projects/${projectId}/review-packets`);
      setReviewPackets(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load stakeholder review packets.");
    } finally {
      setLoadingReviewPackets(false);
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

  useEffect(() => {
    void loadRequirements(selectedProjectId);
    void loadReviewPackets(selectedProjectId);
  }, [loadRequirements, loadReviewPackets, selectedProjectId]);

  async function refresh() {
    await loadProjects();
    if (selectedProjectId) {
      await loadDrafts(selectedProjectId);
    }
    if (selectedProjectId && selectedDraftId) {
      await loadDraftDetail(selectedProjectId, selectedDraftId);
    }
    if (selectedProjectId) {
      await loadRequirements(selectedProjectId);
      await loadReviewPackets(selectedProjectId);
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
      await loadRequirements(selectedProjectId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to submit review decision.");
    } finally {
      setReviewingCandidate(null);
    }
  }

  function toggleRequirement(requirementId: string) {
    setSelectedRequirementIds((current) =>
      current.includes(requirementId) ? current.filter((id) => id !== requirementId) : [...current, requirementId]
    );
  }

  async function createStakeholderReviewPacket() {
    if (!selectedProjectId) {
      return;
    }
    if (selectedRequirementIds.length === 0) {
      setError("Select at least one requirement for stakeholder review.");
      return;
    }

    setCreatingPacket(true);
    setLatestReviewUrl(null);
    setError(null);
    try {
      const packet = await fetchJson<ReviewPacket>(`/projects/${selectedProjectId}/review-packets`, {
        method: "POST",
        body: JSON.stringify({
          name: packetName.trim().length > 0 ? packetName.trim() : "Stakeholder review packet",
          requirementIds: selectedRequirementIds,
          stakeholderName,
          stakeholderEmail
        })
      });
      setLatestReviewUrl(packet.token ? `${window.location.origin}/stakeholder-review/${packet.token}` : packet.reviewUrl ?? null);
      setSelectedRequirementIds([]);
      setPacketName("");
      await loadRequirements(selectedProjectId);
      await loadReviewPackets(selectedProjectId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create stakeholder review packet.");
    } finally {
      setCreatingPacket(false);
    }
  }

  async function bootstrapDemo() {
    setBootstrappingDemo(true);
    setLatestReviewUrl(null);
    setError(null);
    try {
      const demo = await fetchJson<DemoBootstrapResponse>("/demo/bootstrap", {
        method: "POST"
      });
      setProjects((current) => [demo.project, ...current.filter((project) => project.id !== demo.project.id)]);
      setSelectedProjectId(demo.project.id);
      setSelectedDraftId(demo.aiDraft.id);
      await loadProjects();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create demo data.");
    } finally {
      setBootstrappingDemo(false);
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
            <button className="button secondary" disabled={bootstrappingDemo} onClick={() => void bootstrapDemo()} type="button">
              {bootstrappingDemo ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <FileSearch size={16} aria-hidden="true" />}
              Load demo
            </button>
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

        <StakeholderReviewPanel
          creatingPacket={creatingPacket}
          latestReviewUrl={latestReviewUrl}
          loading={loadingReviewPackets}
          packetName={packetName}
          reviewPackets={reviewPackets}
          requirements={requirements}
          selectedRequirementIds={selectedRequirementIds}
          stakeholderEmail={stakeholderEmail}
          stakeholderName={stakeholderName}
          onCreatePacket={createStakeholderReviewPacket}
          onPacketNameChange={setPacketName}
          onStakeholderEmailChange={setStakeholderEmail}
          onStakeholderNameChange={setStakeholderName}
          onToggleRequirement={toggleRequirement}
        />
      </section>
    </main>
  );
}

interface StakeholderReviewPanelProps {
  creatingPacket: boolean;
  latestReviewUrl: string | null;
  loading: boolean;
  packetName: string;
  reviewPackets: ReviewPacket[];
  requirements: RequirementListItem[];
  selectedRequirementIds: string[];
  stakeholderEmail: string;
  stakeholderName: string;
  onCreatePacket: () => Promise<void>;
  onPacketNameChange: (value: string) => void;
  onStakeholderEmailChange: (value: string) => void;
  onStakeholderNameChange: (value: string) => void;
  onToggleRequirement: (requirementId: string) => void;
}

function StakeholderReviewPanel({
  creatingPacket,
  latestReviewUrl,
  loading,
  packetName,
  reviewPackets,
  requirements,
  selectedRequirementIds,
  stakeholderEmail,
  stakeholderName,
  onCreatePacket,
  onPacketNameChange,
  onStakeholderEmailChange,
  onStakeholderNameChange,
  onToggleRequirement
}: StakeholderReviewPanelProps) {
  const reviewableRequirements = requirements.filter((requirement) =>
    ["draft", "in_review", "change_requested"].includes(requirement.status)
  );

  return (
    <section className="stakeholder-review-panel" aria-label="Stakeholder review packets">
      <div className="packet-builder">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Stakeholder review</p>
            <h2>Package requirements for approval</h2>
          </div>
          {loading ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <ClipboardCheck size={18} aria-hidden="true" />}
        </div>

        <div className="packet-form">
          <label className="field-label">
            <span>Packet name</span>
            <input onChange={(event) => onPacketNameChange(event.target.value)} value={packetName} />
          </label>
          <div className="field-pair">
            <label className="field-label">
              <span>Reviewer name</span>
              <input onChange={(event) => onStakeholderNameChange(event.target.value)} value={stakeholderName} />
            </label>
            <label className="field-label">
              <span>Reviewer email</span>
              <input onChange={(event) => onStakeholderEmailChange(event.target.value)} value={stakeholderEmail} />
            </label>
          </div>
        </div>

        <div className="requirement-picker">
          {reviewableRequirements.map((requirement) => (
            <label className="requirement-choice" key={requirement.id}>
              <input
                checked={selectedRequirementIds.includes(requirement.id)}
                onChange={() => onToggleRequirement(requirement.id)}
                type="checkbox"
              />
              <span>
                <strong>
                  {requirement.reference} - {requirement.title}
                </strong>
                <small>
                  {formatStatus(requirement.status)} - v{requirement.currentVersion} - {requirement.priority.toUpperCase()}
                </small>
              </span>
            </label>
          ))}

          {reviewableRequirements.length === 0 ? (
            <div className="empty-state compact">
              <FileSearch size={20} aria-hidden="true" />
              <span>No draft or reviewable requirements are available yet.</span>
            </div>
          ) : null}
        </div>

        <div className="packet-actions">
          <button
            className="button primary"
            disabled={creatingPacket || selectedRequirementIds.length === 0}
            onClick={() => void onCreatePacket()}
            type="button"
          >
            {creatingPacket ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <ClipboardCheck size={16} aria-hidden="true" />}
            Create review link
          </button>
          {latestReviewUrl ? (
            <a className="review-url" href={latestReviewUrl} rel="noreferrer" target="_blank">
              Open stakeholder review
            </a>
          ) : null}
        </div>
      </div>

      <div className="packet-history">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Evidence</p>
            <h2>Review decisions</h2>
          </div>
          <span>{reviewPackets.length} packets</span>
        </div>

        <div className="packet-list">
          {reviewPackets.map((packet) => {
            const latestApproval = packet.approvals[0] ?? packet.reviewLinks[0]?.approvals[0] ?? null;
            return (
              <article className="packet-card" key={packet.id}>
                <div className="packet-card-heading">
                  <div>
                    <strong>
                      v{packet.version} - {packet.name}
                    </strong>
                    <span>
                      {packet.items.length} requirements - {formatStatus(packet.status)}
                    </span>
                  </div>
                  <span className={`decision-badge ${packet.status === "approved" ? "accepted" : packet.status === "rejected" ? "rejected" : "pending"}`}>
                    {formatStatus(packet.status)}
                  </span>
                </div>
                <ul className="packet-requirements">
                  {packet.items.map((item) => (
                    <li key={item.requirement.id}>
                      {item.requirement.reference} v{item.requirementVersion.version}
                    </li>
                  ))}
                </ul>
                {latestApproval ? (
                  <div className="approval-evidence">
                    <CheckCircle2 size={16} aria-hidden="true" />
                    <span>
                      {latestApproval.reviewerName} recorded {formatStatus(latestApproval.decision)} on{" "}
                      {shortDate(latestApproval.decidedAt)}.
                    </span>
                  </div>
                ) : (
                  <div className="approval-evidence pending">
                    <Search size={16} aria-hidden="true" />
                    <span>Awaiting stakeholder decision.</span>
                  </div>
                )}
              </article>
            );
          })}

          {!loading && reviewPackets.length === 0 ? (
            <div className="empty-state compact">
              <FileSearch size={20} aria-hidden="true" />
              <span>No stakeholder review packets have been created yet.</span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
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
