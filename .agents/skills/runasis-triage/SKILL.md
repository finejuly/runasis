---
name: runasis-triage
description: Use when asked to run or maintain Runasis daily triage, inspect this repository for work suggestions, or update Runasis loop state and Obsidian Work/Triage notes without implementing code changes.
---

# Runasis Triage

Run triage for the Runasis repository without changing application code.

## Scope

Runasis is a local Node.js Strava dashboard. It uses Node built-ins only, keeps Strava credentials and activity data local, and verifies with `npm test`.

Core files:

- `.agents/skills/runasis-triage/SKILL.md`: triage workflow, guardrails, and output contract.
- `.agents/skills/runasis-triage/agents/openai.yaml`: skill UI metadata and default prompt.
- `docs/loop/state.md`: compact persistent loop state and user feedback, not a work item board.
- `obsidian/Triage/현재 triage 상태.md`: current human-readable triage loop summary, not a work item board.
- `obsidian/Triage/History/`: dated triage run history.
- `obsidian/Work/작업.md`: primary work guide for Obsidian.
- `obsidian/Work/Inbox/`, `Next/`, `Doing/`, `Blocked/`, `Done/`, `Dropped/`: status folders for work item files. The containing folder is the item's status.
- `server.js`: local HTTP server, Strava sync, storage, personal-best computation, API routing.
- `public/app.js`: client state, chart rendering, dashboard interactions.
- `public/index.html` and `public/styles.css`: UI structure and styling.
- `tests/runasis.test.js`: Node test suite for server, sync, records, charts, and UI rendering.
- `README.md`: setup, usage, and development instructions.

Private or generated files must stay out of recommendations unless the user explicitly asks: `.env`, `data/strava/`, `data/**/*.json`, `.superpowers/`, `.build/`, `Runasis.app/`.

## Triage Workflow

1. Check `git status --short`.
2. Read `docs/loop/state.md`, `obsidian/Triage/현재 triage 상태.md`, `obsidian/Work/작업.md`, and existing work item files under `obsidian/Work/{Inbox,Next,Doing,Blocked,Done,Dropped}/` if they exist.
3. Inspect recent context with `git log --oneline -5`.
4. Scan for likely work suggestions:
   - Triage loop quality: whether this skill, its metadata, the automation prompt, `docs/loop/state.md`, `obsidian/Triage/`, and `obsidian/Work/작업.md` still match the user's preferred workflow.
   - Recent changes that need follow-up tests or docs.
   - Fragile areas in Strava auth, CSRF, local file writes, and data deletion.
   - Personal-best, time-best, pace-best, and Riegel calculation risks.
   - Chart/UI regressions, especially SVG labels, scales, responsiveness, and empty states.
   - Oversized or tangled code regions that block small future changes.
5. Run `npm test` unless the user explicitly asks for a no-test triage.
6. Update the triage state files:
   - Keep `docs/loop/state.md` as the compact persistent loop state, not a duplicate work item list.
   - Update `obsidian/Triage/현재 triage 상태.md` as a compact loop summary, not a duplicate work item list.
   - Add or update one dated note under `obsidian/Triage/History/` for the run.
   - Add or update work item files in the appropriate status folder under `obsidian/Work/`.
   - Change a work item's status by moving its file between status folders; do not add or maintain a `status` frontmatter property.
   - Use `source: triage`, `source_ref`, and `managed_by: triage` for provenance and automation safety.
   - Do not recreate separate `Todo/`, `Suggestions/`, `Archive/`, or item index pages.
   - Update `obsidian/Work/작업.md` only if the operating rules change, not for routine item additions or moves.
7. Write state and Obsidian triage notes in Korean unless the user explicitly asks for another language.

## Output

Keep results concise and action-oriented:

- Baseline: branch, dirty state, latest commit, test result.
- Top work items: up to 3 items, each with status folder, source, impact, evidence, likely files, and a verification command.
- Deferred: notable ideas intentionally not recommended now.
- Next manual action: the single best task for a human or implementation agent to pick up.
- State files: Korean Markdown, with Obsidian wikilinks for vault notes. Prefer folder moves over maintaining separate status/source index pages.

If no useful work is found, record that explicitly with the test result and avoid inventing low-value tasks.

## Guardrails

- Triage is read-mostly. Only `docs/loop/state.md`, files under `obsidian/Triage/`, and files under `obsidian/Work/` may be updated.
- Do not edit `obsidian/.obsidian/` settings during triage.
- Do not fetch Strava data, open `.env`, print secrets, or inspect private activity JSON unless the user explicitly asks.
- Do not create commits, branches, pull requests, or code patches as part of this skill.
- Prefer small, verifiable suggestions over broad rewrites.
- Every recommended implementation task should mention how to verify it, usually starting with `npm test`.
