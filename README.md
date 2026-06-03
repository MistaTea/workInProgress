# AI Senior BA Workbench

An enterprise-grade AI-powered workbench for Senior Business Analysts.

The MVP focuses on:

- Project workspaces
- Requirements management
- Document and transcript intelligence
- AI-generated draft artefacts with human review
- Stakeholder review links and approval evidence
- Jira and Confluence integration boundaries
- Traceability from requirements to stories and test scenarios

## Stack

- Next.js + TypeScript frontend
- NestJS + TypeScript API
- PostgreSQL + pgvector-ready Prisma schema
- OpenAI-backed AI orchestration boundary
- Worker app for async ingestion, AI jobs, and sync jobs

## Apps

- `apps/web`: Product UI
- `apps/api`: Backend API
- `apps/worker`: Background workers

## Packages

- `packages/shared`: Shared domain types and constants
- `packages/ai-schemas`: Structured AI output schemas
- `packages/database`: Prisma schema and database client boundary

## Local Database

The API uses PostgreSQL through Prisma. For local development:

```bash
docker compose -f infra/docker/docker-compose.local.yml up -d
cp .env.example .env
pnpm install
pnpm db:deploy
pnpm dev
```

Until authentication is implemented, the API creates a development workspace owner from:

- `DEFAULT_ORGANISATION_NAME`
- `DEFAULT_OWNER_NAME`
- `DEFAULT_OWNER_EMAIL`

The development identity is an interim boundary and must be replaced by authenticated user context before production use.

## Document Intelligence

The first native ingestion path supports plain text, Markdown, and transcript content. Creating a document stores a
versioned `native://` source URI, queues extraction through Redis, and keeps source text out of API responses.

Document chunks preserve character offsets so downstream AI drafts can cite stable `document_chunk` source references.
The worker uses `text-embedding-3-small` with 1,536 dimensions when `OPENAI_API_KEY` is configured. Binary document
uploads, object storage, PDF/DOCX extraction, and OCR remain future extraction adapters.

## Grounded AI Drafts

Semantic document search ranks same-project chunks using pgvector cosine similarity and the configured embedding model.
It requires `OPENAI_API_KEY` so the query can be embedded with the same model used during document ingestion.
Requirement extraction jobs are explicitly scoped to selected documents, run asynchronously, and use the OpenAI
Responses API with Structured Outputs. The worker rejects citations outside the selected source chunks and stores the
result as an `AiDraftOutput` with review status `generated`; it never creates approved requirements automatically.

The default requirement extraction model is `gpt-5.5` and can be changed with `OPENAI_REQUIREMENT_EXTRACTION_MODEL`.

## BA Review And Requirement Conversion

Requirement extraction drafts support per-candidate BA review. Accepting a candidate creates a normal versioned
requirement with status `draft`, preserves the candidate's document-chunk source references, and records a
`derived_from` traceability link. Source references continue into later requirement versions. Rejecting a candidate
requires a reason. Human decisions are stored separately from the immutable AI output, with reviewer identity,
comments, reviewed payload, timestamps, and audit events.

`accepted_by_ba` means the AI draft review is complete and at least one candidate was accepted; it does not mean the
created requirements are stakeholder-approved or baselined.

## Integration Tests

The integration tests exercise project, document, AI job, requirement, retrieval, and worker persistence against PostgreSQL.

```bash
docker compose -f infra/docker/docker-compose.local.yml up -d
cp .env.example .env
pnpm db:deploy
pnpm test
```
