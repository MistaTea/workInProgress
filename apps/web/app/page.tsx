import { Bot, CheckCircle2, FileText, GitBranch, Link2, Plus, Search, ShieldCheck, Upload } from "lucide-react";

const metrics = [
  { label: "Active projects", value: "3", tone: "teal" },
  { label: "AI drafts awaiting review", value: "18", tone: "amber" },
  { label: "Pending approvals", value: "5", tone: "rose" },
  { label: "Traceability coverage", value: "72%", tone: "indigo" }
];

const workQueue = [
  "Review 7 extracted requirements from claims workshop transcript",
  "Resolve Jira sync conflict for PAY-142 onboarding story",
  "Send baseline v0.3 to operations stakeholder review",
  "Generate test scenarios for approved payment exception requirements"
];

const modules = [
  {
    title: "Requirements",
    body: "Register, refine, quality-review, baseline, and approve structured requirements.",
    icon: CheckCircle2
  },
  {
    title: "Documents",
    body: "Upload transcripts and source documents, then extract draft artefacts with evidence.",
    icon: FileText
  },
  {
    title: "Traceability",
    body: "Link objectives, requirements, stories, tests, decisions, and risks.",
    icon: GitBranch
  },
  {
    title: "Integrations",
    body: "Sync Jira stories and publish approved Confluence pages with audit history.",
    icon: Link2
  }
];

export default function HomePage() {
  return (
    <main className="app-shell">
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
          ].map(
            (item) => (
              <a className={item.label === "Home" ? "active" : ""} href={item.href} key={item.label}>
                {item.label}
              </a>
            )
          )}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Today</p>
            <h1>Business analysis command centre</h1>
          </div>
          <div className="topbar-actions">
            <label className="search">
              <Search size={16} aria-hidden="true" />
              <input aria-label="Search workbench" placeholder="Search projects, requirements, decisions" />
            </label>
            <button className="button secondary" type="button">
              <Upload size={16} aria-hidden="true" />
              Import
            </button>
            <button className="button primary" type="button">
              <Plus size={16} aria-hidden="true" />
              Project
            </button>
          </div>
        </header>

        <section className="metrics" aria-label="Project metrics">
          {metrics.map((metric) => (
            <article className={`metric ${metric.tone}`} key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </article>
          ))}
        </section>

        <section className="content-grid">
          <article className="panel">
            <div className="panel-heading">
              <h2>Work queue</h2>
              <span>4 items</span>
            </div>
            <div className="task-list">
              {workQueue.map((task) => (
                <label className="task" key={task}>
                  <input type="checkbox" />
                  <span>{task}</span>
                </label>
              ))}
            </div>
          </article>

          <article className="panel ai-panel">
            <div className="panel-heading">
              <h2>Contextual AI</h2>
              <Bot size={18} aria-hidden="true" />
            </div>
            <p>
              Drafts are held for BA review before approval, baselining, Jira sync, or Confluence publishing.
            </p>
            <a className="button primary wide" href="/reviews">
              Review AI drafts
            </a>
          </article>
        </section>

        <section className="module-grid" aria-label="Workbench modules">
          {modules.map((module) => {
            const Icon = module.icon;
            return (
              <article className="module-card" key={module.title}>
                <Icon size={20} aria-hidden="true" />
                <h2>{module.title}</h2>
                <p>{module.body}</p>
              </article>
            );
          })}
        </section>

        <section className="approval-band">
          <ShieldCheck size={22} aria-hidden="true" />
          <div>
            <h2>Approval evidence first</h2>
            <p>
              Baselines, stakeholder review links, comments, timestamps, and artefact versions are designed as auditable
              records from the foundation.
            </p>
          </div>
        </section>
      </section>
    </main>
  );
}
