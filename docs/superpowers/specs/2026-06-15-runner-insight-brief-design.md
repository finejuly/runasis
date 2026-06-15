# Runner Insight Brief Design

## Goal

Make Runasis answer the runner's first questions earlier:

- How did my latest run compare with my own history?
- Am I moving toward a race target such as a sub-4 marathon?
- Am I on pace for a yearly distance goal?
- What should I consider for the next run?
- Which current performance gap looks most actionable?

The change should reuse saved Strava activities, personal-best records, and the existing Riegel analysis. It should not add external services, machine learning, or medical/recovery claims.

## Persona Findings

Five read-only subagents reviewed the app from separate runner personas.

### Latest-run reviewer

The dashboard starts with volume KPIs and a cumulative chart. Recent Activities are hidden under "More training detail", and activity cards do not say whether a run was near or inside a personal-best record. This makes the common post-run question require tab-hopping.

### Race-goal runner

Analysis already projects marathon and half-marathon outcomes, but there is no goal input. The user can infer sub-4 readiness from Riegel tables, but the app does not state target pace, projected time, or gap to target.

### Annual-distance runner

The cumulative chart already computes useful caption data, but `renderCumulativeMetricChart()` clears the caption. There is no current-year range or annual target summary, so a 1,000 km/year goal is not directly visible.

### Improvement-headroom runner

The Analysis profile computes strength, weakness, and improvement signals, but the card is labeled generically as "Improvement" and the training schedule is hidden. The next actionable focus is not prominent enough.

### Today-run runner

The dashboard has enough deterministic inputs for a conservative next-run suggestion: days since last run, recent 7-day load, recent 30-day baseline, run frequency, and latest run distance. Existing training schedule copy is too generic and should be framed as options rather than prescription.

## Recommended Approach

Use a "Dashboard-first plus Analysis target panel" approach.

1. Add a `Runner Brief` section near the top of the Dashboard.
2. Add a compact `Race Target` panel near the top of Analysis.
3. Reframe `Training Schedule` as `Next Run Options`.
4. Restore useful cumulative chart captions.

This keeps the current tabs intact while making the most common runner questions visible without opening advanced details.

## Runner Brief

Place `Runner Brief` inside the Dashboard, directly below the `Dashboard` heading and above the KPI metric controls. It contains three compact cards:

- `Latest Run`: latest saved run date, distance, pace, duration, and best available comparison.
- `Today`: deterministic suggestion such as "Recovery or rest", "Easy 30-45 min", or "Steady aerobic run", with evidence.
- `Year Goal`: current-year distance against a default 1,000 km target, remaining distance, and needed km/week.

The brief must gracefully degrade:

- No runs: show setup/import guidance.
- No personal best data: show latest run facts and "Import best efforts for record comparison."
- No current-year distance: show 0 km and weekly need.

## Latest-run Comparison

Use existing personal-best data. For the latest run:

- Match official distance PB targets whose distance is less than or equal to the run distance.
- Prefer common targets near the run distance: 5K, 10K, half-marathon, marathon, then longest run rank.
- If the latest run owns the top record for a matched target, label it as a current best.
- Otherwise show the delta to the best effort for the matched target.
- If no PB match exists, show the run's rank by distance among saved runs.

This is not split-level segment analysis. It is a compact summary that points users to Personal Bests for details.

## Today Suggestion

Add a pure helper that returns structured copy based only on saved activities:

- Last run today: suggest recovery/rest or very easy only.
- Consecutive running days >= 3: suggest recovery/rest.
- Last 7 days distance is materially above the recent 30-day weekly baseline: suggest easy/recovery.
- No run in 4+ days and recent load is low: suggest easy re-entry.
- Stable load and a known improvement focus: suggest a controlled workout option.
- Otherwise suggest an easy aerobic run.

Copy must use evidence language such as "Based on saved runs" and avoid certainty about health, fatigue, or injury.

## Year Goal

Add a default local-only annual distance goal:

- Default target: 1,000 km.
- Period: current calendar year.
- Inputs: saved run distance from Jan 1 through the dashboard range end/current local day.
- Output: completed km, percent complete, remaining km, needed km/week through Dec 31.

For this scoped pass, the default target is fixed. Do not add a year-goal input yet.

## Race Target

Add a compact panel at the top of Analysis:

- Distance select defaults to Marathon.
- Goal time defaults to `4:00:00`.
- Show goal pace.
- Reuse current Riegel expected rows to show projected time for the selected distance.
- Show status:
  - "On track by X" when projected time is faster than goal.
  - "Need X faster" and "Need Y sec/km faster" when projected time is slower.
  - "Collect more best efforts" when projection data is missing.

Store target distance and goal time preferences in `localStorage`.

## Next Run Options

Rename visible copy from "Training Schedule" to "Next Run Options". The list remains deterministic and local:

- Include recovery/easy options when recent load suggests caution.
- Include threshold/specific options when load is stable and an improvement signal exists.
- Mention the current limiter or goal target when available.

This section remains secondary to the top-level Today card.

## Data Flow

- No server API changes are required.
- `loadData()` already fetches activities and personal bests.
- New helpers live in `public/app.js` near existing dashboard and analysis helpers.
- Render functions write into new elements in `public/index.html`.
- Styling follows existing card, KPI, and section patterns in `public/styles.css`.

## Testing

Use Node's built-in test runner.

Add focused VM tests for:

- Latest run comparison with no PB data, PB match, and distance-rank fallback.
- Today suggestion for no runs, ran today, high 7-day load, and stable load.
- Year goal math for remaining distance and needed weekly distance.
- Race target projection status for faster than goal, slower than goal, and missing projection.
- Cumulative chart caption rendering.
- Static HTML labels for `Runner Brief`, `Race Target`, and `Next Run Options`.

Run `npm test` before completion.

## Non-goals

- No new Strava scopes.
- No route maps, segment analysis, or GPS split chart.
- No health, injury, or fatigue diagnosis.
- No backend persistence for user goals.
- No redesign of the existing Personal Bests or Analysis chart system.
