"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";

type Decision = "approved" | "changes_requested" | "rejected";

interface ReviewRequirement {
  requirement: {
    id: string;
    reference: string;
    title: string;
    type: string;
    priority: string;
  };
  requirementVersion: {
    version: number;
    statement: string;
    rationale: string | null;
  };
}

interface StakeholderReview {
  token: string;
  status: string;
  expiresAt: string;
  stakeholder: {
    name: string;
    email: string | null;
  } | null;
  baseline: {
    id: string;
    name: string;
    version: number;
    status: string;
    items: ReviewRequirement[];
  };
}

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api").replace(/\/$/, "");

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

export function StakeholderReviewPage({ token }: { token: string }) {
  const [review, setReview] = useState<StakeholderReview | null>(null);
  const [reviewerName, setReviewerName] = useState("");
  const [reviewerEmail, setReviewerEmail] = useState("");
  const [comments, setComments] = useState("");
  const [decision, setDecision] = useState<Decision>("approved");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<StakeholderReview>(`/review/${token}`);
      setReview(data);
      setReviewerName((current) => current || data.stakeholder?.name || "");
      setReviewerEmail((current) => current || data.stakeholder?.email || "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load stakeholder review.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadReview();
  }, [loadReview]);

  async function submitDecision() {
    if (reviewerName.trim().length === 0) {
      setError("Reviewer name is required.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await fetchJson(`/review/${token}/decision`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          reviewerName: reviewerName.trim(),
          reviewerEmail: reviewerEmail.trim().length > 0 ? reviewerEmail.trim() : undefined,
          comments: comments.trim().length > 0 ? comments.trim() : undefined
        })
      });
      setCompleted(true);
      await loadReview();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to submit review decision.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="stakeholder-page">
      <section className="stakeholder-review">
        <header className="stakeholder-header">
          <div className="brand-mark">BA</div>
          <div>
            <p className="eyebrow">Stakeholder review</p>
            <h1>{review?.baseline.name ?? "Requirement review packet"}</h1>
          </div>
        </header>

        {error ? (
          <div className="error-banner" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        {loading ? (
          <div className="loading-panel">
            <LoaderCircle className="spin" size={22} aria-hidden="true" />
            <span>Loading review packet</span>
          </div>
        ) : review ? (
          <>
            <section className="stakeholder-summary">
              <ShieldCheck size={22} aria-hidden="true" />
              <div>
                <strong>
                  Packet v{review.baseline.version} - {formatStatus(review.status)}
                </strong>
                <span>{review.baseline.items.length} requirements awaiting review evidence.</span>
              </div>
            </section>

            <section className="stakeholder-requirements">
              {review.baseline.items.map((item) => (
                <article className="stakeholder-requirement" key={item.requirement.id}>
                  <div>
                    <strong>
                      {item.requirement.reference} - {item.requirement.title}
                    </strong>
                    <span>
                      v{item.requirementVersion.version} - {formatStatus(item.requirement.type)} -{" "}
                      {item.requirement.priority.toUpperCase()}
                    </span>
                  </div>
                  <p>{item.requirementVersion.statement}</p>
                  {item.requirementVersion.rationale ? <small>{item.requirementVersion.rationale}</small> : null}
                </article>
              ))}
            </section>

            <section className="stakeholder-decision">
              {completed || review.status === "completed" ? (
                <div className="completion-panel">
                  <CheckCircle2 size={24} aria-hidden="true" />
                  <strong>Decision recorded</strong>
                  <span>Your review evidence has been saved for the Business Analyst.</span>
                </div>
              ) : (
                <>
                  <div className="field-pair">
                    <label className="field-label">
                      <span>Your name</span>
                      <input onChange={(event) => setReviewerName(event.target.value)} value={reviewerName} />
                    </label>
                    <label className="field-label">
                      <span>Email</span>
                      <input onChange={(event) => setReviewerEmail(event.target.value)} value={reviewerEmail} />
                    </label>
                  </div>

                  <div className="decision-options" aria-label="Review decision">
                    {[
                      { label: "Approve", value: "approved" },
                      { label: "Changes requested", value: "changes_requested" },
                      { label: "Reject", value: "rejected" }
                    ].map((option) => (
                      <label className={decision === option.value ? "decision-option active" : "decision-option"} key={option.value}>
                        <input
                          checked={decision === option.value}
                          onChange={() => setDecision(option.value as Decision)}
                          type="radio"
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>

                  <label className="field-label">
                    <span>Comments</span>
                    <textarea onChange={(event) => setComments(event.target.value)} rows={4} value={comments} />
                  </label>

                  <button className="button primary" disabled={submitting} onClick={() => void submitDecision()} type="button">
                    {submitting ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
                    Submit decision
                  </button>
                </>
              )}
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
