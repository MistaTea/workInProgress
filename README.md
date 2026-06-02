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
