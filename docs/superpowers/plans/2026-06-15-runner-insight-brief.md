# Runner Insight Brief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-screen runner insights and a race target panel so Runasis answers post-run, annual-goal, race-goal, and next-run questions earlier.

**Architecture:** Keep the existing static frontend and Node server unchanged at the API layer. Add pure calculation helpers in `public/app.js`, render the new cards from existing `activities` and `personalBests`, and use `localStorage` only for race target preferences.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, Node.js built-in test runner, VM-based frontend tests.

---

## File Structure

- Modify `public/index.html`: add Runner Brief containers, Race Target controls, and rename Training Schedule copy.
- Modify `public/app.js`: add helper constants, state fields, localStorage readers/writers, calculation helpers, event bindings, and render functions.
- Modify `public/styles.css`: style the brief and target panels using existing card/grid patterns.
- Modify `tests/runasis.test.js`: add VM and static HTML/CSS tests for the new behavior.
- Keep `server.js` unchanged.

---

### Task 1: Pure Runner Brief Helpers

**Files:**
- Modify: `tests/runasis.test.js`
- Modify: `public/app.js`

- [ ] **Step 1: Write failing helper tests**

Add tests near the existing dashboard helper tests:

```js
test("buildLatestRunComparison summarizes latest run against matching personal best", () => {
  const app = loadAppContext();
  const result = vm.runInContext(`
    appState.personalBests = {
      distances: [{
        name: "5K",
        distanceKm: 5,
        top: [{ activityId: "pb", movingTime: 1500, paceSecondsPerKm: 300 }]
      }]
    };
    buildLatestRunComparison([
      ${JSON.stringify(runActivity("latest", "2026-06-10T07:00:00", { distance: 6000, moving_time: 1560 }))},
      ${JSON.stringify(runActivity("pb", "2026-05-10T07:00:00", { distance: 5000, moving_time: 1500 }))}
    ]);
  `, app);

  assert.equal(result.title, "Run latest");
  assert.equal(result.value, "6.00 km");
  assert.match(result.detail, /5K/);
});

test("buildTodayRunSuggestion uses saved recent load without overclaiming", () => {
  const app = loadAppContext();
  freezeAppDate(app, "2026-06-15T12:00:00");

  const result = vm.runInContext(`
    buildTodayRunSuggestion([
      ${JSON.stringify(runActivity("today", "2026-06-15T07:00:00", { distance: 5000 }))},
      ${JSON.stringify(runActivity("yesterday", "2026-06-14T07:00:00", { distance: 5000 }))}
    ]);
  `, app);

  assert.equal(result.title, "Recovery or rest");
  assert.match(result.detail, /saved runs/);
});

test("buildYearGoalProgress returns fixed annual goal progress", () => {
  const app = loadAppContext();
  freezeAppDate(app, "2026-06-15T12:00:00");

  const result = vm.runInContext(`
    buildYearGoalProgress([
      ${JSON.stringify(runActivity("one", "2026-01-02T07:00:00", { distance: 100000 }))},
      ${JSON.stringify(runActivity("old", "2025-12-31T07:00:00", { distance: 100000 }))}
    ]);
  `, app);

  assert.equal(result.targetKm, 1000);
  assert.equal(result.completedKm, 100);
  assert.equal(result.remainingKm, 900);
  assert.ok(result.neededKmPerWeek > 0);
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
npm test -- --test-name-pattern="buildLatestRunComparison|buildTodayRunSuggestion|buildYearGoalProgress"
```

Expected: FAIL because the helper functions do not exist.

- [ ] **Step 3: Implement helper constants and functions**

Add near dashboard constants and helper functions in `public/app.js`:

```js
const ANNUAL_DISTANCE_GOAL_KM = 1000;
const COMMON_RECORD_TARGETS = ["5K", "10K", "Half-Marathon", "Marathon"];

function buildRunnerBrief(activities = appState.activities, personalBests = appState.personalBests) {
  return {
    latestRun: buildLatestRunComparison(activities, personalBests),
    today: buildTodayRunSuggestion(activities),
    yearGoal: buildYearGoalProgress(activities)
  };
}
```

Implement:

- `getSortedRuns(activities)` sorted newest first by `getActivityStartTime()`.
- `buildLatestRunComparison(activities, personalBests)` returning `{ title, value, meta, detail, state }`.
- `selectLatestRunRecordComparison(latestRun, personalBests)` choosing common distance targets under latest distance.
- `buildRunDistanceRank(activity, activities)` fallback rank by distance.
- `buildTodayRunSuggestion(activities)` returning conservative copy using today, consecutive run days, 7-day load, and 30-day weekly baseline.
- `buildYearGoalProgress(activities, targetKm = ANNUAL_DISTANCE_GOAL_KM)` returning `{ title, value, meta, detail, targetKm, completedKm, remainingKm, neededKmPerWeek }`.

- [ ] **Step 4: Run helper tests again**

Run:

```bash
npm test -- --test-name-pattern="buildLatestRunComparison|buildTodayRunSuggestion|buildYearGoalProgress"
```

Expected: PASS.

---

### Task 2: Dashboard Runner Brief UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `tests/runasis.test.js`

- [ ] **Step 1: Write failing static and render tests**

Add tests:

```js
test("dashboard exposes Runner Brief before metric controls", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");

  assert.match(html, /id="runnerBrief"/);
  assert.ok(html.indexOf("id=\"runnerBrief\"") < html.indexOf("class=\"kpi-summary-heading\""));
});

test("renderDashboardRunnerBrief fills latest, today, and year goal cards", () => {
  const app = loadAppContext();
  freezeAppDate(app, "2026-06-15T12:00:00");

  const result = vm.runInContext(`
    els.runnerBriefLatestValue = { textContent: "" };
    els.runnerBriefLatestMeta = { textContent: "" };
    els.runnerBriefLatestDetail = { textContent: "" };
    els.runnerBriefTodayValue = { textContent: "" };
    els.runnerBriefTodayMeta = { textContent: "" };
    els.runnerBriefTodayDetail = { textContent: "" };
    els.runnerBriefYearValue = { textContent: "" };
    els.runnerBriefYearMeta = { textContent: "" };
    els.runnerBriefYearDetail = { textContent: "" };
    appState.activities = [
      ${JSON.stringify(runActivity("latest", "2026-06-14T07:00:00", { distance: 10000, moving_time: 3600 }))}
    ];
    renderDashboardRunnerBrief();
    ({
      latest: els.runnerBriefLatestValue.textContent,
      today: els.runnerBriefTodayValue.textContent,
      year: els.runnerBriefYearValue.textContent
    });
  `, app);

  assert.equal(result.latest, "10.00 km");
  assert.ok(result.today.length > 0);
  assert.match(result.year, /10.0 \\/ 1,000 km/);
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
npm test -- --test-name-pattern="Runner Brief|renderDashboardRunnerBrief"
```

Expected: FAIL because markup and render function do not exist.

- [ ] **Step 3: Add dashboard markup**

In `public/index.html`, inside `#dashboardView`, directly after `view-section-heading`, add:

```html
<section class="runner-brief" id="runnerBrief" aria-label="Runner brief">
  <article class="runner-brief-card">
    <span>Latest Run</span>
    <strong id="runnerBriefLatestValue">-</strong>
    <small id="runnerBriefLatestMeta">No saved runs</small>
    <p id="runnerBriefLatestDetail">Import activities to compare your latest run.</p>
  </article>
  <article class="runner-brief-card">
    <span>Today</span>
    <strong id="runnerBriefTodayValue">-</strong>
    <small id="runnerBriefTodayMeta">Based on saved runs</small>
    <p id="runnerBriefTodayDetail">Import activities for a conservative suggestion.</p>
  </article>
  <article class="runner-brief-card">
    <span>Year Goal</span>
    <strong id="runnerBriefYearValue">0.0 / 1,000 km</strong>
    <small id="runnerBriefYearMeta">Current year</small>
    <p id="runnerBriefYearDetail">No current-year runs saved.</p>
  </article>
</section>
```

- [ ] **Step 4: Wire cache and rendering**

Add the new element IDs to `cacheElements()`. Call `renderDashboardRunnerBrief()` from `render()` before KPI rendering.

Implement `renderDashboardRunnerBrief()`:

```js
function renderDashboardRunnerBrief() {
  const brief = buildRunnerBrief(appState.activities, appState.personalBests);
  renderRunnerBriefCard("Latest", brief.latestRun);
  renderRunnerBriefCard("Today", brief.today);
  renderRunnerBriefCard("Year", brief.yearGoal);
}
```

Use explicit element references rather than query selectors.

- [ ] **Step 5: Add CSS**

Use existing card patterns:

```css
.runner-brief {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 0 0 14px;
}

.runner-brief-card {
  min-width: 0;
  min-height: 132px;
  padding: 16px;
  border: 1px solid var(--line);
  background: var(--surface);
  box-shadow: var(--shadow-soft);
  border-radius: 8px;
  display: grid;
  gap: 5px;
}
```

Add mobile stacking in the existing media query block.

- [ ] **Step 6: Run task tests**

Run:

```bash
npm test -- --test-name-pattern="Runner Brief|renderDashboardRunnerBrief|buildLatestRunComparison|buildTodayRunSuggestion|buildYearGoalProgress"
```

Expected: PASS.

---

### Task 3: Analysis Race Target Panel

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `tests/runasis.test.js`

- [ ] **Step 1: Write failing Race Target tests**

Add tests:

```js
test("buildRaceTargetStatus compares projected marathon with sub-4 goal", () => {
  const app = loadAppContext();
  const result = vm.runInContext(`
    buildRaceTargetStatus({
      targetName: "Marathon",
      goalSeconds: 4 * 60 * 60,
      expectedRows: [{ name: "Marathon", predictedTime: 4 * 60 * 60 + 120, distanceKm: 42.195 }]
    });
  `, app);

  assert.equal(result.value, "Need 2:00 faster");
  assert.match(result.detail, /sec\\/km faster/);
});

test("Analysis exposes Race Target controls", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");

  assert.match(html, /id="raceTargetPanel"/);
  assert.match(html, /id="raceTargetDistanceSelect"/);
  assert.match(html, /id="raceTargetTimeInput"/);
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm test -- --test-name-pattern="Race Target|buildRaceTargetStatus"
```

Expected: FAIL.

- [ ] **Step 3: Add Race Target state and preferences**

Add constants:

```js
const RACE_TARGET_DISTANCE_STORAGE_KEY = "runasis.raceTarget.distance";
const RACE_TARGET_TIME_STORAGE_KEY = "runasis.raceTarget.time";
const DEFAULT_RACE_TARGET_DISTANCE = "Marathon";
const DEFAULT_RACE_TARGET_TIME = "4:00:00";
```

Add `raceTargetDistanceName` and `raceTargetTimeText` to `appState`. Load and save them through `localStorage`.

- [ ] **Step 4: Add panel markup and controls**

In `public/index.html`, inside `#analysisView` after the Analysis heading, add `raceTargetPanel` with distance select, goal time input, value, meta, and detail elements.

- [ ] **Step 5: Implement calculation and rendering**

Add:

- `parseRaceGoalTime(text)` for `H:MM:SS`, `M:SS`, or plain minutes.
- `formatRaceTargetPace(goalSeconds, distanceKm)`.
- `buildRaceTargetStatus({ targetName, goalSeconds, expectedRows })`.
- `renderRaceTargetPanel(distanceAnalysis = buildRiegelAnalysis())`.
- `renderRaceTargetDistanceOptions(targets, selectedName)`.

Call `renderRaceTargetPanel(distanceAnalysis)` from `renderAnalysisView()`.

- [ ] **Step 6: Bind Race Target events**

In `bindEvents()`, add change/input listeners for `raceTargetDistanceSelect` and `raceTargetTimeInput`. On valid input, save preferences and rerender Analysis.

- [ ] **Step 7: Run task tests**

Run:

```bash
npm test -- --test-name-pattern="Race Target|buildRaceTargetStatus|Analysis controls"
```

Expected: PASS.

---

### Task 4: Next Run Options and Captions

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `tests/runasis.test.js`

- [ ] **Step 1: Write failing tests**

Add tests:

```js
test("renderCumulativeMetricChart keeps the computed caption visible", () => {
  const app = loadAppContext();
  freezeAppDate(app, "2026-06-15T12:00:00");

  const result = vm.runInContext(`
    appState.rangeDays = "7";
    appState.selectedKpiMetric = "distance";
    els.cumulativeMetricTitle = { textContent: "" };
    els.cumulativeDistanceCaption = { textContent: "" };
    els.cumulativeDistanceChart = { innerHTML: "" };
    appState.activities = [
      ${JSON.stringify(runActivity("current", "2026-06-14T07:00:00", { distance: 10000 }))},
      ${JSON.stringify(runActivity("previous", "2026-06-07T07:00:00", { distance: 5000 }))}
    ];
    renderCumulativeMetricChart(appState.activities);
    els.cumulativeDistanceCaption.textContent;
  `, app);

  assert.match(result, /Last 7 days/);
  assert.match(result, /Previous/);
});

test("Training Schedule copy is reframed as Next Run Options", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");

  assert.match(html, /Next Run Options/);
  assert.doesNotMatch(html, />Training Schedule</);
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm test -- --test-name-pattern="renderCumulativeMetricChart keeps|Next Run Options"
```

Expected: FAIL.

- [ ] **Step 3: Restore cumulative caption**

In `renderCumulativeMetricChart()`, replace the empty caption assignment with:

```js
els.cumulativeDistanceCaption.textContent = analysis.caption || "";
```

- [ ] **Step 4: Rename schedule copy**

In `public/index.html`, change:

- Summary label: `Training schedule` to `Next run options`.
- Small text: use "How recent load and the diagnostic profile can shape options".
- Panel heading: `Training Schedule` to `Next Run Options`.

- [ ] **Step 5: Make schedule helper load-aware**

Update `buildTrainingSchedule(improveSignal = null)` to call `buildTodayRunSuggestion(appState.activities)` and include recovery/easy options first when the suggestion state indicates caution. Keep existing Endurance, Threshold, Recovery, and Specific intent, but copy should read as options.

- [ ] **Step 6: Run task tests**

Run:

```bash
npm test -- --test-name-pattern="renderCumulativeMetricChart keeps|Next Run Options|analysis profile"
```

Expected: PASS.

---

### Task 5: Full Verification and Cleanup

**Files:**
- Review all modified files.

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Inspect working tree**

Run:

```bash
git status --short
git diff --stat
```

Expected: only intended files changed.

- [ ] **Step 3: Manual UI smoke check**

Start the app:

```bash
npm start
```

Open the local URL in the in-app browser and check:

- Dashboard shows Runner Brief above KPI controls.
- Cards do not overlap at desktop and mobile widths.
- Analysis shows Race Target near the top.
- Next Run Options copy appears instead of Training Schedule.

- [ ] **Step 4: Commit implementation**

Commit the implementation:

```bash
git add public/index.html public/app.js public/styles.css tests/runasis.test.js docs/superpowers/plans/2026-06-15-runner-insight-brief.md
git commit -m "feat: surface runner insight brief"
```
