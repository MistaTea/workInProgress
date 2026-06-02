# AGENTS.md

## Repository Mission

Build an AI-powered Senior Business Analyst Workbench for an individual Senior BA, with enterprise-grade governance, source-grounded AI, approval evidence, Jira/Confluence integration, requirements traceability, and document intelligence.

## Source Of Truth

- GitHub is the source of truth for this project.
- Do not rely on persistent local files as the canonical project state.
- If a local checkout is needed for implementation or verification, treat it as temporary, push the completed work to GitHub, then remove the local checkout.
- Prefer GitHub connector or cloud-based workflows where practical.

## Delivery Workflow

- Work incrementally in coherent implementation steps.
- Commit meaningful units of work with clear commit messages.
- Push changes to GitHub after each completed implementation step.
- Prefer direct commits to `master` while this is an early personal project, unless the user asks for feature branches or pull requests.
- Do not overwrite, force-push, or delete remote history unless the user explicitly asks for it.

## Approval And Autonomy Preferences

- Do not pause for routine implementation decisions when the product direction is already clear.
- Make conservative architecture and implementation choices consistent with the existing codebase.
- Ask before destructive actions, secret handling, dependency or licensing decisions with meaningful risk, public deployment, or major scope changes.
- Keep the user informed with concise progress updates, but do not require manual approval for every safe file change or GitHub update.

## Local Storage Preference

- Avoid storing generated deliverables locally except temporary working files needed to perform the task.
- Remove temporary local checkouts after pushing confirmed work to GitHub.
- Do not write directly to the user's home directory.

## Engineering Expectations

- Use the existing monorepo structure: `apps/web`, `apps/api`, `apps/worker`, and `packages/*`.
- Keep AI-generated outputs separate from human-approved artefacts.
- Preserve auditability, approval evidence, source references, and traceability as first-class concerns.
- Add tests and CI as the project matures.
- Prefer focused changes over broad refactors.

## Verification Expectations

- Run the strongest available verification for the current environment.
- If local dependencies or runtime tools are unavailable, add or rely on GitHub Actions CI where possible.
- Clearly report any verification that could not be performed.
