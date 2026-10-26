"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, FileText, LoaderCircle, RefreshCw } from "lucide-react";

interface Project {
  id: string;
  name: string;
  problemStatement: string | null;
}
interface Dashboard {
  requirementCounts: Record<string, number>;
  pendingApprovals: number;
  aiDraftsAwaitingReview: number;
  openRisks: number;
}
interface DocumentSummary {
  id: string;
  projectId: string;
  name: string;
  documentType: string;
  version: number;
  extractionStatus: string;
  embeddingStatus: string;
  extractionError: string | null;
  embeddingError: string | null;
  _count?: { chunks: number };
}
interface DocumentDetail extends DocumentSummary {
  chunks: Array<{
    id: string;
    chunkIndex: number;
    chunkText: string;
    pageRef: string | null;
    sourceReference: { location?: string };
  }>;
}
const API = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api").replace(/\/$/, "");
const MAX_CONTENT = 20_000;
const display = (value: string) => value.replace(/_/g, " ");
function pendingDocument(doc: DocumentSummary) {
  if (["failed", "queue_failed"].includes(doc.extractionStatus)) return false;
  return (
    ["pending", "queued", "processing"].includes(doc.extractionStatus) ||
    (doc.extractionStatus === "completed" &&
      ["pending", "queued", "processing"].includes(doc.embeddingStatus))
  );
}
const pendingDocuments = (docs: DocumentSummary[]) =>
  docs.some(pendingDocument);
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
  if (!response.ok) {
    let reason = `Request failed (${response.status}).`;
    try {
      const data = (await response.json()) as { message?: string | string[] };
      if (data.message)
        reason = Array.isArray(data.message)
          ? data.message.join(" ")
          : data.message;
    } catch {
      /* Use status fallback. */
    }
    throw new Error(reason);
  }
  return response.json() as Promise<T>;
}
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Unable to complete the request.";
// Each mounted project/document owns its request lifetime. Polling stops at a
// terminal state or read error, resumes on explicit refresh, and never overlaps.
function useResource<T>(
  path: string,
  revision: number,
  pending?: (data: T) => boolean,
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    setError("");
    async function load() {
      try {
        const next = await request<T>(path, controller.signal);
        if (controller.signal.aborted) return;
        setData(next);
        setLoading(false);
        if (pending?.(next)) timer = setTimeout(() => void load(), 2500);
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(errorText(error));
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [path, revision, pending]);
  return { data, loading, error };
}
function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="error-banner" role="alert">
      <AlertCircle size={18} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
function Loading({ children }: { children: React.ReactNode }) {
  return (
    <p className="home-loading" role="status">
      <LoaderCircle className="spin" size={18} aria-hidden="true" />
      {children}
    </p>
  );
}

export function HomeWorkbench({
  initialProjectId,
}: {
  initialProjectId: string;
}) {
  const [projectId, setProjectId] = useState(initialProjectId);
  const [revision, setRevision] = useState(0);
  const projects = useResource<Project[]>("/projects", revision);
  const [created, setCreated] = useState<Project | null>(null);
  useEffect(() => {
    if (created && projects.data?.some((project) => project.id === created.id))
      setCreated(null);
  }, [created, projects.data]);
  const choices =
    created && !projects.data?.some((p) => p.id === created.id)
      ? [created, ...(projects.data ?? [])]
      : (projects.data ?? []);
  const selected = choices.find((project) => project.id === projectId);
  function selectProject(id: string) {
    setProjectId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("projectId", id);
    else url.searchParams.delete("projectId");
    window.history.pushState(null, "", url);
  }
  useEffect(() => {
    const onPop = () =>
      setProjectId(
        new URL(window.location.href).searchParams.get("projectId") ?? "",
      );
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const suffix = selected
    ? `?projectId=${encodeURIComponent(selected.id)}`
    : "";
  return (
    <main className="app-shell home-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <div className="brand-mark">BA</div>
          <div>
            <strong>BA Clarity</strong>
            <span>Evidence-led business analysis</span>
          </div>
        </div>
        <nav className="nav-list">
          <a className="active" aria-current="page" href={`/${suffix}`}>
            Home
          </a>
          <a href={`/reviews${suffix}`}>Reviews</a>
          <a href={`/evidence${suffix}`}>Evidence</a>
        </nav>
      </aside>
      <section className="workspace">
        <header className="review-topbar">
          <div>
            <p className="eyebrow">Your workspace</p>
            <h1>Projects and source intake</h1>
          </div>
          <button
            className="button secondary"
            type="button"
            disabled={projects.loading}
            onClick={() => setRevision((n) => n + 1)}
          >
            <RefreshCw size={16} aria-hidden="true" />
            Refresh projects
          </button>
        </header>
        <p>
          Start with a project, then paste source material for parsing and
          chunking. Intake does not automatically create requirements or run AI
          extraction. Demo data is a separate action in Reviews.
        </p>
        {projects.error && <ErrorBanner>{projects.error}</ErrorBanner>}
        <div className="home-start-grid">
          <section className="home-card" id="projects">
            <h2>Select a project</h2>
            {projects.loading && <Loading>Loading projects</Loading>}
            <label className="field-label">
              <span>Project</span>
              <select
                value={projectId}
                disabled={projects.loading}
                onChange={(event) => selectProject(event.target.value)}
              >
                <option value="">Choose a project</option>
                {projectId && !selected && (
                  <option value={projectId}>
                    Requested project unavailable
                  </option>
                )}
                {choices.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            {!projects.loading && !projects.error && projectId && !selected && (
              <ErrorBanner>
                The requested project is unavailable or does not belong to this
                workspace. Choose an available project; no other project has
                been selected automatically.
              </ErrorBanner>
            )}
            {!projects.loading && !projects.error && !choices.length && (
              <p>
                No projects yet. Create your first project to add source
                material.
              </p>
            )}
          </section>
          <CreateProject
            onCreated={(project) => {
              setCreated(project);
              selectProject(project.id);
              setRevision((n) => n + 1);
            }}
          />
        </div>
        {selected ? (
          <ProjectWorkspace key={selected.id} project={selected} />
        ) : (
          <div className="empty-state">
            <FileText size={22} aria-hidden="true" />
            Select or create a project to view real activity and documents.
          </div>
        )}
      </section>
    </main>
  );
}

function CreateProject({
  onCreated,
}: {
  onCreated: (project: Project) => void;
}) {
  const [name, setName] = useState("");
  const [problem, setProblem] = useState("");
  const [objectives, setObjectives] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    const list = objectives
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (
      !name.trim() ||
      list.length > 20 ||
      list.some((line) => line.length > 500)
    ) {
      setError(
        "Enter a project name and at most 20 objectives of 500 characters each.",
      );
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setSaving(true);
    setError("");
    try {
      const project = await request<Project>("/projects", controller.signal, {
        name: name.trim(),
        ...(problem.trim() ? { problemStatement: problem.trim() } : {}),
        objectives: list,
      });
      if (!controller.signal.aborted) {
        setName("");
        setProblem("");
        setObjectives("");
        onCreated(project);
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          `${errorText(error)} If the response was interrupted, refresh projects before trying again to avoid duplicates.`,
        );
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setSaving(false);
      }
    }
  }
  return (
    <form
      className="home-card"
      aria-label="Create project"
      onSubmit={(event) => void submit(event)}
    >
      <h2>Create a project</h2>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <label className="field-label">
        <span>Project name</span>
        <input
          required
          maxLength={200}
          value={name}
          disabled={saving}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="field-label">
        <span>Problem statement (optional)</span>
        <textarea
          rows={2}
          maxLength={4000}
          value={problem}
          disabled={saving}
          onChange={(e) => setProblem(e.target.value)}
        />
      </label>
      <label className="field-label">
        <span>Objectives (optional, one per line; up to 20)</span>
        <textarea
          rows={2}
          maxLength={10020}
          value={objectives}
          disabled={saving}
          onChange={(e) => setObjectives(e.target.value)}
        />
      </label>
      <button className="button primary" type="submit" disabled={saving}>
        {saving ? "Creating project…" : "Create project"}
      </button>
    </form>
  );
}

function ProjectWorkspace({ project }: { project: Project }) {
  const [revision, setRevision] = useState(0);
  const [documentId, setDocumentId] = useState("");
  const dashboard = useResource<Dashboard>(
    `/projects/${encodeURIComponent(project.id)}/dashboard`,
    revision,
  );
  const documents = useResource<DocumentSummary[]>(
    `/projects/${encodeURIComponent(project.id)}/documents`,
    revision,
    pendingDocuments,
  );
  const prefix = `?projectId=${encodeURIComponent(project.id)}`;
  return (
    <section className="home-project" aria-label="Selected project workspace">
      <header className="review-topbar">
        <div>
          <p className="eyebrow">Selected project</p>
          <h2>{project.name}</h2>
        </div>
        <button
          className="button secondary"
          type="button"
          disabled={dashboard.loading || documents.loading}
          onClick={() => setRevision((n) => n + 1)}
        >
          <RefreshCw size={16} aria-hidden="true" />
          Refresh project
        </button>
      </header>
      {project.problemStatement && (
        <p className="home-source-text">{project.problemStatement}</p>
      )}
      {dashboard.error && (
        <ErrorBanner>
          Project counts could not be refreshed: {dashboard.error}
        </ErrorBanner>
      )}
      {dashboard.loading ? (
        <Loading>Loading project activity</Loading>
      ) : (
        dashboard.data && (
          <section className="metrics" aria-label="Current project counts">
            {[
              {
                label: "Requirements",
                value: Object.values(dashboard.data.requirementCounts).reduce(
                  (sum, count) => sum + count,
                  0,
                ),
              },
              {
                label: "AI drafts awaiting review",
                value: dashboard.data.aiDraftsAwaitingReview,
              },
              {
                label: "Active review links",
                value: dashboard.data.pendingApprovals,
              },
              { label: "Open risks", value: dashboard.data.openRisks },
            ].map((metric) => (
              <article className="metric" key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </article>
            ))}
          </section>
        )
      )}
      <div className="home-links">
        <a className="button secondary" href={`/reviews${prefix}`}>
          Open project reviews
        </a>
        <a className="button secondary" href={`/evidence${prefix}`}>
          Open project evidence
        </a>
      </div>
      <div className="home-intake-grid">
        <DocumentIntake
          projectId={project.id}
          onCreated={(document) => {
            setDocumentId(document.id);
            setRevision((n) => n + 1);
          }}
        />
        <section
          className="home-card"
          id="documents"
          aria-label="Project documents"
        >
          <h2>Source documents</h2>
          {documents.error && (
            <ErrorBanner>
              Document updates paused: {documents.error} Use Refresh project to
              retry.
            </ErrorBanner>
          )}
          {documents.loading && <Loading>Loading documents</Loading>}
          {documents.data?.some(pendingDocument) && !documents.error && (
            <p role="status">
              Checking processing status automatically. If a document stays
              queued, the ingestion worker may be unavailable.
            </p>
          )}
          <div className="home-document-list">
            {documents.data?.map((doc) => (
              <button
                type="button"
                className={`draft-row${documentId === doc.id ? " active" : ""}`}
                aria-pressed={documentId === doc.id}
                key={doc.id}
                onClick={() => setDocumentId(doc.id)}
              >
                <span>
                  <strong>{doc.name}</strong>
                  <small>
                    v{doc.version} · Parsing: {display(doc.extractionStatus)}
                  </small>
                  <small>
                    Embeddings: {display(doc.embeddingStatus)} ·{" "}
                    {doc._count?.chunks ?? 0} chunks
                  </small>
                </span>
              </button>
            ))}
          </div>
          {!documents.loading &&
            !documents.error &&
            !documents.data?.length && (
              <p>No source documents yet. Paste text to begin.</p>
            )}
        </section>
      </div>
      {documentId ? (
        <DocumentInspector
          key={documentId}
          documentId={documentId}
          projectId={project.id}
          onRetried={() => setRevision((n) => n + 1)}
        />
      ) : (
        <p>
          Select a document to inspect its processing status and full chunks.
        </p>
      )}
    </section>
  );
}

function DocumentIntake({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: (document: DocumentDetail) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("text/plain");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    if (!name.trim() || !content.trim()) {
      setError("Enter a document name and source text.");
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const document = await request<DocumentDetail>(
        `/projects/${encodeURIComponent(projectId)}/documents`,
        controller.signal,
        { name: name.trim(), documentType: type, content },
      );
      if (!controller.signal.aborted) {
        setName("");
        setContent("");
        onCreated(document);
        setNotice(
          "Source document saved. Check its processing status below; no requirements were generated.",
        );
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          `${errorText(error)} If the response was interrupted, refresh project documents before retrying to avoid duplicates.`,
        );
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setSaving(false);
      }
    }
  }
  return (
    <form
      className="home-card"
      aria-label="Paste source document"
      onSubmit={(event) => void submit(event)}
    >
      <h2>Paste source material</h2>
      <p>
        Native text is parsed into source chunks. Embeddings are skipped when
        embedding configuration is unavailable.
      </p>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {notice && (
        <p className="reviewed-banner" role="status">
          {notice}
        </p>
      )}
      <label className="field-label">
        <span>Document name</span>
        <input
          required
          maxLength={200}
          disabled={saving}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="field-label">
        <span>Document type</span>
        <select
          value={type}
          disabled={saving}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="text/plain">Plain text</option>
          <option value="text/markdown">Markdown</option>
          <option value="transcript">Transcript</option>
        </select>
      </label>
      <label className="field-label">
        <span>
          Source text (up to {MAX_CONTENT.toLocaleString()} characters)
        </span>
        <textarea
          required
          rows={8}
          maxLength={MAX_CONTENT}
          value={content}
          disabled={saving}
          onChange={(e) => setContent(e.target.value)}
        />
      </label>
      <small>
        {content.length.toLocaleString()} / {MAX_CONTENT.toLocaleString()}{" "}
        characters
      </small>
      <button className="button primary" type="submit" disabled={saving}>
        {saving ? "Saving source…" : "Save source document"}
      </button>
    </form>
  );
}

function DocumentInspector({
  documentId,
  projectId,
  onRetried,
}: {
  documentId: string;
  projectId: string;
  onRetried: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");
  const result = useResource<DocumentDetail>(
    `/documents/${encodeURIComponent(documentId)}`,
    revision,
    pendingDocument,
  );
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const doc = result.data?.projectId === projectId ? result.data : null;
  async function retry() {
    if (!doc || pending.current || pendingDocument(doc)) return;
    const controller = new AbortController();
    pending.current = controller;
    setRetrying(true);
    setError("");
    try {
      await request(
        `/documents/${encodeURIComponent(documentId)}/ingest`,
        controller.signal,
        {},
      );
      if (!controller.signal.aborted) {
        setRevision((n) => n + 1);
        onRetried();
      }
    } catch (error) {
      if (!controller.signal.aborted) setError(errorText(error));
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setRetrying(false);
      }
    }
  }
  const failed =
    doc &&
    (["failed", "queue_failed"].includes(doc.extractionStatus) ||
      doc.embeddingStatus === "failed");
  return (
    <section className="home-card" aria-label="Document detail">
      <header className="review-topbar">
        <h2>{doc?.name ?? "Document detail"}</h2>
        <button
          className="button secondary"
          type="button"
          disabled={result.loading || retrying}
          onClick={() => setRevision((n) => n + 1)}
        >
          Refresh document
        </button>
      </header>
      {result.error && (
        <ErrorBanner>
          {result.error} Automatic updates are paused; refresh to resume.
        </ErrorBanner>
      )}
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {result.loading && <Loading>Loading source chunks</Loading>}
      {doc && (
        <>
          <p>
            Document version {doc.version} · {doc.documentType}
          </p>
          <dl className="home-status-grid">
            <div>
              <dt>Parsing and chunking</dt>
              <dd>{display(doc.extractionStatus)}</dd>
            </div>
            <div>
              <dt>Embeddings</dt>
              <dd>{display(doc.embeddingStatus)}</dd>
            </div>
          </dl>
          {pendingDocument(doc) && !result.error && (
            <p role="status">
              Processing is pending. Checking automatically; you can leave this
              page and return later. If processing remains stuck, the service may need operator recovery; active work cannot be safely forced to retry here.
            </p>
          )}
          {doc.embeddingStatus === "skipped" && (
            <p>
              Embeddings were skipped. Parsed chunks remain available; this is
              not an AI-generated requirement set.
            </p>
          )}
          {doc.extractionError && (
            <ErrorBanner>Parsing: {doc.extractionError}</ErrorBanner>
          )}
          {doc.embeddingError && (
            <ErrorBanner>Embeddings: {doc.embeddingError}</ErrorBanner>
          )}
          {failed && (
            <button
              className="button secondary"
              type="button"
              disabled={retrying || result.loading || pendingDocument(doc)}
              onClick={() => void retry()}
            >
              {retrying ? "Retrying…" : "Retry processing"}
            </button>
          )}
          <h3>Source chunks ({doc.chunks.length})</h3>
          {doc.chunks.length === 0 && (
            <p>No parsed chunks are available yet.</p>
          )}
          {doc.chunks.map((chunk) => (
            <article className="home-chunk" key={chunk.id}>
              <h4>Chunk {chunk.chunkIndex + 1}</h4>
              {(chunk.pageRef || chunk.sourceReference.location) && (
                <small>{chunk.pageRef ?? chunk.sourceReference.location}</small>
              )}
              <p className="home-source-text">{chunk.chunkText}</p>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
