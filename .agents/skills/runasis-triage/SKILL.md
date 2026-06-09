---
name: runasis-triage
description: Use when asked to run or maintain Runasis daily triage, inspect this repository for work suggestions, or update the Runasis loop state and Obsidian triage notes without implementing code changes.
---

# Runasis Triage

Run triage for the Runasis repository without changing application code.

## Scope

Runasis is a local Node.js Strava dashboard. It uses Node built-ins only, keeps Strava credentials and activity data local, and verifies with `npm test`.

Core files:

- `.agents/skills/runasis-triage/SKILL.md`: triage workflow, guardrails, and output contract.
- `.agents/skills/runasis-triage/agents/openai.yaml`: skill UI metadata and default prompt.
- `docs/loop/state.md`: compact persistent loop state and user feedback.
- `obsidian/Triage/현재 triage 상태.md`: current human-readable triage summary.
- `obsidian/Triage/History/`: dated triage run history.
- `obsidian/Triage/Suggestions/`: triage-discovered suggestion cards.
- `obsidian/Triage/triage 제안 MOC.md`: suggestion index for Obsidian.
- `server.js`: local HTTP server, Strava sync, storage, personal-best computation, API routing.
- `public/app.js`: client state, chart rendering, dashboard interactions.
- `public/index.html` and `public/styles.css`: UI structure and styling.
- `tests/runasis.test.js`: Node test suite for server, sync, records, charts, and UI rendering.
- `README.md`: setup, usage, and development instructions.

Private or generated files must stay out of recommendations unless the user explicitly asks: `.env`, `data/strava/`, `data/**/*.json`, `.superpowers/`, `.build/`, `Runasis.app/`.

## Triage Workflow

1. Check `git status --short`.
2. Read `docs/loop/state.md`, `obsidian/Triage/현재 triage 상태.md`, and existing `obsidian/Triage/Suggestions/` cards if they exist.
3. Inspect recent context with `git log --oneline -5`.
4. Scan for likely work suggestions:
   - Triage loop quality: whether this skill, its metadata, the automation prompt, `docs/loop/state.md`, and `obsidian/Triage/` still match the user's preferred workflow.
   - Recent changes that need follow-up tests or docs.
   - Fragile areas in Strava auth, CSRF, local file writes, and data deletion.
   - Personal-best, time-best, pace-best, and Riegel calculation risks.
   - Chart/UI regressions, especially SVG labels, scales, responsiveness, and empty states.
   - Oversized or tangled code regions that block small future changes.
5. Run `npm test` unless the user explicitly asks for a no-test triage.
6. Update the triage state files:
   - Keep `docs/loop/state.md` as the compact persistent loop state.
   - Update `obsidian/Triage/현재 triage 상태.md` with the current summary.
   - Add or update one dated note under `obsidian/Triage/History/` for the run.
   - Add, update, merge, or retire suggestion cards under `obsidian/Triage/Suggestions/`.
   - Update `obsidian/Triage/triage 제안 MOC.md` so active suggestions are discoverable.
7. Do not put triage-discovered suggestions in `obsidian/Todo/`; that folder is reserved for user-entered todos.
8. Write state and Obsidian triage notes in Korean unless the user explicitly asks for another language.

## Output

Keep results concise and action-oriented:

- Baseline: branch, dirty state, latest commit, test result.
- Top suggestions: up to 3 items, each with impact, evidence, likely files, and a verification command.
- Deferred: notable ideas intentionally not recommended now.
- Next manual action: the single best task for a human or implementation agent to pick up.
- State files: Korean Markdown, with Obsidian wikilinks for vault notes.

If no useful work is found, record that explicitly with the test result and avoid inventing low-value tasks.

## Guardrails

- Triage is read-mostly. Only `docs/loop/state.md` and files under `obsidian/Triage/` may be updated.
- Do not edit `obsidian/Todo/` during triage unless the user explicitly asks; user-entered todos are separate from triage suggestions.
- Do not edit `obsidian/.obsidian/` settings during triage.
- Do not fetch Strava data, open `.env`, print secrets, or inspect private activity JSON unless the user explicitly asks.
- Do not create commits, branches, pull requests, or code patches as part of this skill.
- Prefer small, verifiable suggestions over broad rewrites.
- Every recommended implementation task should mention how to verify it, usually starting with `npm test`.
