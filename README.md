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

## Integration Tests

The API integration test starts the real NestJS application and exercises project and requirement persistence against PostgreSQL.

```bash
docker compose -f infra/docker/docker-compose.local.yml up -d
cp .env.example .env
pnpm db:deploy
pnpm test
```
