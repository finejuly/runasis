# Runasis UX exploration

Date: 2026-06-16

## Method

I opened the local app at `http://localhost:3000` with the existing connected Strava dataset. The observed dataset had 213 saved activities, 188 runs, and complete best-effort/stream coverage. I did not trigger external Strava authorization, activity import, activity refresh, exclusion, or destructive data deletion. Internal navigation, filters, toggles, details sections, sort controls, help dialogs, and safe confirmation/cancel flows were exercised.

Effort notes use the app's desktop default viewport. "Click" means a direct visible click. "Scroll" means ordinary wheel scrolling from the current screen. Mouse movement cost is folded into whether the control is top-level/visible, below the fold, or buried after long lists.

## Top-level structure

| Area | What it is for | Observed access path | Effort |
| --- | --- | --- | --- |
| Top bar status | Check whether Strava is connected and whether the app is ready. | Initial screen, top right. | 0 clicks, visible. |
| Connect Strava | Start OAuth connection with the configured Strava app. | Initial screen, top right. Not clicked because it leaves the local app. | 0 clicks, visible. |
| Update from Strava | Import or refresh saved activity data from Strava. | Initial screen, top right. Not clicked because it can call external APIs and mutate local data. | 0 clicks, visible. |
| Data tools | Access local data maintenance actions. | Top bar `Data tools` menu. | 1 click, visible. |
| Clear Data confirmation | Delete local Strava tokens and saved activity data after explicit confirmation. | `Data tools` -> `Clear Data`; confirmation modal has `Cancel` and `Clear saved data`. | 2 clicks to reach confirm, destructive action gated by another click. |
| Athlete summary band | Confirm account, last sync, activity count, run count, and detail coverage. | Initial screen below top bar. | 0 clicks, visible. |
| View tabs | Switch between the main workflows: Dashboard, Activities, Personal Bests, Analysis. | Initial screen below summary. | 1 click to any non-default view, visible. |

## Dashboard

The Dashboard answers "How am I doing right now?" and "What changed recently?" It is the best default surface for quick status checks.

| Component | What it seems intended for | Observed access path | Effort |
| --- | --- | --- | --- |
| Runner brief: Latest Run | Compare the latest run with known best efforts and give immediate context. | Default Dashboard. | 0 clicks, visible. |
| Runner brief: Today | Give a conservative training suggestion from recent load. | Default Dashboard. | 0 clicks, visible. |
| Runner brief: Year to Date | Show current-year distance and weekly average. | Default Dashboard. | 0 clicks, visible. |
| Training volume range selector | Change the time window for the Dashboard. Tested `Last 7 days` and back to `Last 30 days`. | Default Dashboard -> Range select. | 1 select interaction, visible. |
| KPI cards: Distance, Activities, Time, Elevation Gain | Switch the cumulative chart metric and compare selected vs previous range. | Default Dashboard -> click a KPI card. | 1 click, visible. |
| Cumulative chart | Visualize accumulated distance/activity/time/elevation over the selected range. | Default Dashboard, below KPI cards. | 0 clicks, partly below first fold. |
| More training detail | Reveal secondary Dashboard analysis: weekly pattern, distance distribution, longest runs, and recent activities. | Default Dashboard -> `More training detail`. | 1 click, visible near chart area. |
| Weekly Distance | Check week-by-week volume pattern. | Open `More training detail`. | 1 click. |
| Distance Distribution | See the mix of short, medium, long, and half-marathon-plus efforts in the selected range. | Open `More training detail`. | 1 click. |
| Longest Runs | Find the longest efforts in the selected range. | Open `More training detail`. | 1 click. |
| Recent Activities | See the latest five activities in the selected range. | Open `More training detail`. | 1 click. |
| Search activities button | Jump from the Dashboard summary to the full Activities workflow. | Open `More training detail` -> `Search activities`. | 2 clicks from initial Dashboard. |

## Activities

The Activities view answers "Find a specific activity" and "What is the data/detail status of my activity history?" It is a workbench for search, filtering, refresh status, and detailed tabular comparison.

| Component | What it seems intended for | Observed access path | Effort |
| --- | --- | --- | --- |
| Activities tab | Enter full activity history. | Top-level `Activities`. | 1 click, visible. |
| Search field | Find an activity by name, sport, or id. Tested with a query that narrowed the list. | Activities view, top controls. | 1 click/type, visible. |
| Runs only checkbox | Filter saved activities down to runs. | Activities view, top controls. | 1 click, visible. |
| Detail status select | Check fetched/missing/failed best-effort detail coverage. Tested `Missing`, which showed an empty result for the current data. | Activities view, top controls. | 1 select interaction, visible. |
| Activity summary cards | Browse recent activities with date, type/name, metrics, detail status, and refresh action. | Activities view default content. | 1 click to view; first cards visible, default 50 cards rendered. |
| Per-activity Refresh | Refresh best-effort data for a specific activity. | Activity card/table row button. Not clicked because it mutates data and may call Strava. | 1 click after locating an activity. |
| Show 50 more | Increase both card and table visible limits by 50. Tested once: 50 -> 100 shown. | Activities view below the first 50 cards. | Requires long scroll or search narrowing, then 1 click. |
| Advanced table | Sort and compare activities by date, name, sport, distance, pace, time, elevation, average HR, detail, and actions. | Activities view below the 50-card list -> `Advanced table`. | About 7 wheel scrolls plus 1 click from the top of Activities. |
| Table sort controls | Sort by detailed columns. Tested distance sort. | Open `Advanced table` -> click column header. | High access cost from initial screen because table is below the long card list. |

## Personal Bests

Personal Bests answers "What are my best performances?" It is deep and powerful, with a repeated structure: type tabs (`Distance`, `Time`, `Pace`) and mode tabs (`Records`, `Curve`, `Timing`, `Trend`).

| Component | What it seems intended for | Observed access path | Effort |
| --- | --- | --- | --- |
| Personal Bests tab | Enter best-effort analysis. | Top-level `Personal Bests`. | 1 click, visible. |
| Type tabs: Distance, Time, Pace | Switch between distance records, fixed-duration records, and target-pace endurance records. | Personal Bests view. | 1 additional click for non-default types. |
| Target rank select | Change the target rank threshold, such as Top 3/5/10/20. | Personal Bests view, top controls. | 1 select interaction, visible. |
| Include Excluded | Include previously excluded efforts in PB views. | Records mode header. Not toggled as an audit target only. | 1 click in Records mode. |
| Distance > Records | Show best efforts for target distances and a ranking table for the selected target. Default selected target was 100m. | Personal Bests default. | 1 click to tab, visible. |
| Distance target list | Choose a race distance such as 5K, 10K, half marathon, or marathon. Tested 5K. | Personal Bests -> Distance -> Records -> target button. | 5K was below the first viewport; requires scroll/target selection after entry. |
| Distance > Records detail table | Inspect ranked efforts for the selected distance and see "target today" pace/time. | Select a target distance. | 1 target click after reaching the target. |
| Records Show More | Expand selected target ranking from top 3 to top 20. Tested on 5K. | Selected target detail table -> `Show More`. | 1 click after selected target. |
| Distance > Curve | Compare pace curve across distances. | Personal Bests -> Distance -> `Curve`. | 2 clicks from initial screen. |
| Distance > Timing | See how recent best efforts are by distance. | Personal Bests -> Distance -> `Timing`. | 2 clicks from initial screen. |
| Distance > Trend | See improvement trend for a selected distance with Top 5/10/20 controls. | Personal Bests -> Distance -> `Trend`. | 2 clicks from initial screen. |
| Time > Records | Show best fixed-duration efforts, such as 15s, 20m, 1h, and longer windows. Default selected target was 15s. | Personal Bests -> `Time`. | 2 clicks from initial screen. |
| Time target list | Choose training-relevant durations such as 20m or 1h. Tested 20m. | Time -> Records -> duration button. | 20m required target selection below the first few short durations. |
| Time > Curve | Compare pace across durations. | Personal Bests -> Time -> `Curve`. | 3 clicks from initial screen. |
| Time > Timing | See recency of fixed-duration bests. | Personal Bests -> Time -> `Timing`. | 3 clicks from initial screen. |
| Time > Trend | See trend for a selected fixed duration. | Personal Bests -> Time -> `Trend`. | 3 clicks from initial screen. |
| Pace > Records | Show how long/far target paces were sustained. Default selected target was 3:30/km. | Personal Bests -> `Pace`. | 2 clicks from initial screen. |
| Pace target list | Choose a target pace such as 5:00/km, 5:27/km, or 6:00/km. | Pace -> Records -> target button. | Common aerobic/race paces are not the default; require selection. |
| Pace > Curve | Compare distance sustained by pace target. | Personal Bests -> Pace -> `Curve`. | 3 clicks from initial screen. |
| Pace > Timing | See recency of target-pace bests. | Personal Bests -> Pace -> `Timing`. | 3 clicks from initial screen. |
| Pace > Trend | See trend for sustained distance at a selected pace. | Personal Bests -> Pace -> `Trend`. | 3 clicks from initial screen. |
| Exclude effort buttons | Remove suspect efforts from best-effort rankings. | Records table row actions. Not clicked because it mutates derived data. | Requires finding a specific record row. |

## Analysis

Analysis answers "What does the model infer from my best efforts?" and "How do my goal and next run options look?" It is less raw-record oriented than Personal Bests and more interpretive.

| Component | What it seems intended for | Observed access path | Effort |
| --- | --- | --- | --- |
| Analysis tab | Enter model-based training and performance interpretation. | Top-level `Analysis`. | 1 click, visible. |
| Riegel help button | Explain the Riegel model and exponent meaning. Tested open/close. | Analysis heading -> `?`. | 2 clicks to open and close, visible. |
| Race Target panel | Compare a goal distance/time with model projection and required pace delta. | Analysis default. | 1 click to Analysis, visible. |
| Race target distance select | Change the goal distance. | Race Target panel. | 1 select interaction inside Analysis. |
| Race target time input | Change the goal time for comparison. | Race Target panel. | 1 click/type inside Analysis. |
| Performance Focus cards | Summarize current strength, limiter, next focus, and expected PR candidate area. | Analysis default. | 1 click to Analysis, visible. |
| Model settings | Adjust record set and Riegel exponent mode/value. Tested opening settings. | Analysis -> `Model settings`. | 2 clicks from initial screen. |
| Analysis type tabs | Switch between Pace by Distance, Pace by Time, and Distance by Pace model comparisons. Tested all three. | Analysis view. | 2 clicks from initial screen for non-default types. |
| Pace by Distance | Compare current race-distance bests against Riegel expectations. | Analysis default. | 1 click to Analysis, visible. |
| Pace by Time | Compare fixed-duration bests against expected pace. | Analysis -> `Pace by Time`. | 2 clicks from initial screen. |
| Distance by Pace | Compare sustained distance at target paces against expectations. | Analysis -> `Distance by Pace`. | 2 clicks from initial screen. |
| More model detail | Reveal expected targets, baseline prediction, and projection rows. Tested open. | Analysis -> `More model detail`. | 2 clicks from initial screen, below main chart. |
| Next run options | Show recovery/endurance/threshold/specific next-run options from recent load and focus. Tested open. | Analysis -> `Next run options`. | 2 clicks plus some vertical movement/scroll from initial screen. |

## Access-cost observations

- The fastest important surfaces are Dashboard runner brief, summary band, Dashboard KPIs, and Analysis race target/performance focus.
- Activities search is also fast: one top-level tab click, then search/filter controls are immediately available.
- Activities advanced table is much slower than its likely usefulness suggests. With 50 activity cards rendered first, the table summary was around 4,800 px below the Activities top and required about 7 wheel scrolls before opening.
- In the initial exploration, Personal Bests was high-depth. The top-level view was one click away, but common runner targets were not the default. Distance defaulted to 100m, Time defaulted to 15s, and Pace defaulted to 3:30/km. Common questions around 5K/10K/half/marathon, 20 minutes/1 hour, and sustainable aerobic/race paces required extra target selection and sometimes scrolling.
- Personal Bests and Analysis use similar conceptual axes: distance, time, and pace. Personal Bests is record-centric; Analysis is model-centric. This distinction is useful but not surfaced as an explicit workflow choice.
- The top bar gives setup/import actions very high prominence even after the app is connected and fully synced. These are important, but probably less frequent than viewing current status, activity search, common PB targets, and goal check.

## Improvement hypotheses

These are not implementation decisions yet; they are hypotheses to compare with the subagent ranking.

1. Promote common runner questions through defaults and hierarchy: latest run, today suggestion, goal check, 5K/10K/half/marathon PBs, 20-minute best, and activity search.
2. Make Activities advanced table easier to reach, either by moving it above the 50-card list, making cards/table a segmented view, or adding a sticky/list-density toggle.
3. Change Personal Bests defaults so the first record view is not centered on 100m/15s/3:30/km unless the user chose those recently, while preserving the natural target list order.
4. Reduce persistent prominence of Connect/Update/Data tools after successful sync, or group them as lower-frequency maintenance actions while keeping sync status visible.
5. Connect Dashboard brief cards to their underlying evidence: Latest Run -> related PB target, Today -> Next run options, Year to Date -> training volume range.
6. Make the repeated Distance/Time/Pace + Records/Curve/Timing/Trend model explicit with clearer workflow labels, because the structure is consistent but cognitively dense.

## Subagent importance and frequency ranking

The subagent reviewed this document as its only source and ranked the likely importance/frequency of surfaces for a runner using the app:

| Rank | Surface | Rationale |
| --- | --- | --- |
| 1 | Dashboard Runner Brief: Latest Run | Most frequent because it gives immediate post-run context against known best efforts. |
| 2 | Dashboard Runner Brief: Today | High-frequency because it turns recent load into an actionable training suggestion. |
| 3 | Activities Search Field / Filters | Runners often need to find a specific run, narrow to runs, or check detail status. |
| 4 | Dashboard KPI Cards + Range Selector | Core volume tracking by distance, activity count, time, and elevation is likely checked often. |
| 5 | Analysis Race Target Panel | Important for goal-oriented runners because it compares target time, projection, and required pace delta. |
| 6 | Personal Bests: Common Distance Records | 5K, 10K, half, and marathon PBs are likely high-value performance checks. |
| 7 | Performance Focus Cards | Useful recurring summary of strength, limiter, next focus, and likely PR area. |
| 8 | Activity Summary Cards | Frequent browsing surface for recent activities, metrics, detail status, and refresh actions. |
| 9 | Next Run Options | Important for planning because it suggests recovery, endurance, threshold, or specific next-run options. |
| 10 | Cumulative Chart | Useful for visualizing progress over the selected range, though less immediate than KPIs. |
| 11 | More Training Detail | Weekly distance, distribution, longest runs, and recent activities support periodic deeper review. |
| 12 | Personal Bests: Time Records | 20-minute and 1-hour efforts are useful fitness benchmarks, but probably less universal than race-distance PBs. |
| 13 | Personal Bests: Pace Records | Sustained target pace views are valuable, especially for aerobic/race pace questions. |
| 14 | Activities Advanced Table + Sort Controls | Important for detailed comparison, sorting, and audit-style review, but likely less casual. |
| 15 | Analysis Model Comparison Tabs | Pace by distance/time and distance by pace are useful interpretive tools for deeper analysis. |
| 16 | Athlete Summary Band / Top Bar Status | Important for trust and readiness, but likely checked less once the app is connected and synced. |
| 17 | Update from Strava | Important maintenance action, but likely less frequent than viewing current status, searches, PBs, and goal checks. |
| 18 | Data Tools / Clear Data | Necessary but low-frequency, especially because destructive actions are rightly gated. |

## Subagent mismatch notes

- Activities Advanced Table seems more useful than its access cost suggests: it sits below 50 cards and requires about 7 wheel scrolls plus a click.
- Personal Bests common targets are high-value but not default; Distance starts at 100m, Time at 15s, and Pace at 3:30/km.
- Top bar maintenance actions get persistent high prominence despite likely lower frequency after sync is complete.
- Next Run Options are actionable but require entering Analysis and additional movement/scroll.
- Dashboard Search Activities shortcut is behind More Training Detail, even though activity search is documented as fast and useful.

## Recommended alignment target

The first improvement pass should make activity search/table access and common PB targets faster without adding a new shortcut layer. Specifically:

1. Put the Activities sortable table before the activity summary cards, so sorting and search are part of the primary Activities structure instead of a buried alternate view.
2. Default Personal Bests to the common target for each target type instead of the smallest measurable target.
3. Preserve the natural order of Personal Bests target lists, because reordering stable lists for convenience can make the target browser harder to reason about.
4. Keep Dashboard focused on summary and brief cards; avoid adding separate fast-path button rows unless a destination is both frequent and semantically missing from the page structure.
5. Move connected-state maintenance actions into a quieter tools cluster while preserving sync status and a clear manual update path.

## Implemented alignment pass

The first code pass implemented the highest-confidence access improvements without changing Strava sync, stored data, or analysis formulas. After review, the pass was revised away from adding more buttons and toward changing defaults and content order:

- Dashboard keeps the existing summary hierarchy and does not add fast-path shortcut rows.
- Activities puts the sortable table before the activity summary cards, making search and sorting immediately available without a separate `Cards` / `Table` view toggle.
- Personal Bests now defaults to common targets when available: `5K` for Distance, `20m` for Time, and `5:00/km` for Pace.
- Personal Bests preserves the existing target-list order; it does not reorder targets or render separate pinned target buttons.

Verification performed:

- `npm test` passed with 153 tests.
- Browser check confirmed Dashboard has no `.dashboard-fast-actions` section and no shortcut button IDs from the discarded approach.
- Browser check confirmed Activities has no result-view toggle and the sortable table appears before `#activitySummaryList`.
- Browser check confirmed Personal Bests defaults to common targets while preserving the natural target-list order and avoiding `.record-target-pins`.
- Mobile viewport check at 390x844 showed no horizontal overflow after the structural changes.
