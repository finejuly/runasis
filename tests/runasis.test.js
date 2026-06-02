const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");

function loadAppContext() {
  const context = {
    console,
    document: { addEventListener() {} },
    Intl,
    URLSearchParams,
    window: {
      clearTimeout() {},
      history: { replaceState() {} },
      localStorage: {
        getItem() { return null; },
        setItem() {}
      },
      location: { pathname: "/", search: "" },
      setTimeout() {}
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8"), context);
  return context;
}

function freezeAppDate(app, isoDate) {
  vm.runInContext(`
    {
      const RealDate = Date;
      const fixed = ${JSON.stringify(isoDate)};
      globalThis.Date = class extends RealDate {
        constructor(...args) {
          if (arguments.length === 0) return new RealDate(fixed);
          return new RealDate(...args);
        }

        static now() {
          return new RealDate(fixed).getTime();
        }

        static parse(value) {
          return RealDate.parse(value);
        }

        static UTC(...args) {
          return RealDate.UTC(...args);
        }
      };
    }
  `, app);
}

function runActivity(id, startDateLocal, values = {}) {
  return {
    id,
    name: `Run ${id}`,
    sport_type: "Run",
    start_date_local: startDateLocal,
    distance: 1000,
    moving_time: 300,
    ...values
  };
}

function loadServerContext() {
  const code = fs
    .readFileSync(path.join(ROOT, "server.js"), "utf8")
    .replace(/\nstartServer\(REQUESTED_PORT\);\s*$/, "\n");
  const context = {
    __dirname: ROOT,
    Buffer,
    URL,
    clearTimeout,
    console,
    fetch() {},
    process,
    require,
    setTimeout
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
}

function makeRequest({ method = "GET", url = "/", headers = {}, body = "" } = {}) {
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body) yield Buffer.from(body);
    }
  };
}

function makeResponse() {
  let statusCode = null;
  let body = "";
  let headers = {};
  return {
    writeHead(status, nextHeaders = {}) {
      statusCode = status;
      headers = nextHeaders;
    },
    end(value = "") {
      body += value;
    },
    get statusCode() { return statusCode; },
    get headers() { return headers; },
    get body() { return body; }
  };
}

async function callApi(server, pathname, method = "GET", options = {}) {
  const req = makeRequest({
    method,
    headers: options.headers || {},
    body: options.body || ""
  });
  const res = makeResponse();

  await server.handleApi(req, res, new URL(`http://localhost${pathname}`));
  return res;
}

async function callRequest(server, options) {
  const req = makeRequest(options);
  const res = makeResponse();
  await server.handleRequest(req, res);
  return res;
}

test("formatPace carries rounded seconds into minutes", () => {
  const app = loadAppContext();

  assert.equal(app.formatPace(299.6), "5:00");
  assert.equal(app.formatPace(359.6), "6:00");
});

test("numeric dashboard ranges end yesterday when there is no run today", () => {
  const app = loadAppContext();
  freezeAppDate(app, "2026-05-31T12:00:00");

  const result = vm.runInContext(`
    appState.rangeDays = "7";
    appState.selectedKpiMetric = "distance";
    els.rangeSelect = { selectedIndex: 0, options: [{ textContent: "Last 7 days" }] };
    appState.activities = [
      ${JSON.stringify(runActivity("yesterday", "2026-05-30T07:00:00"))},
      ${JSON.stringify(runActivity("first-day", "2026-05-24T07:00:00"))},
      ${JSON.stringify(runActivity("outside", "2026-05-23T07:00:00"))}
    ];

    const range = getDashboardDateRange(appState.activities);
    const previousRange = getPreviousDashboardDateRange();
    const analysis = buildCumulativeMetricAnalysis(appState.activities, DASHBOARD_METRICS.distance);
    ({
      start: localDateKey(range.start),
      end: localDateKey(range.end),
      filteredIds: getFilteredActivities().map((activity) => activity.id),
      previousStart: localDateKey(previousRange.start),
      previousEnd: localDateKey(previousRange.end),
      cumulativeStart: localDateKey(analysis.tickDates[0]),
      cumulativeEnd: localDateKey(analysis.tickDates.at(-1)),
      cumulativePointCount: analysis.pointCount
    });
  `, app);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    start: "2026-05-24",
    end: "2026-05-30",
    filteredIds: ["yesterday", "first-day"],
    previousStart: "2026-05-17",
    previousEnd: "2026-05-23",
    cumulativeStart: "2026-05-24",
    cumulativeEnd: "2026-05-30",
    cumulativePointCount: 7
  });
});

test("numeric dashboard ranges include today when there is a run today", () => {
  const app = loadAppContext();
  freezeAppDate(app, "2026-05-31T12:00:00");

  const result = vm.runInContext(`
    appState.rangeDays = "7";
    appState.activities = [
      ${JSON.stringify(runActivity("today", "2026-05-31T07:00:00"))},
      ${JSON.stringify(runActivity("first-day", "2026-05-25T07:00:00"))},
      ${JSON.stringify(runActivity("outside", "2026-05-24T07:00:00"))}
    ];

    const range = getDashboardDateRange(appState.activities);
    ({
      start: localDateKey(range.start),
      end: localDateKey(range.end),
      filteredIds: getFilteredActivities().map((activity) => activity.id)
    });
  `, app);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    start: "2026-05-25",
    end: "2026-05-31",
    filteredIds: ["today", "first-day"]
  });
});

test("detailStatusFromStore separates fetched, failed, and pending run details", () => {
  const server = loadServerContext();
  const store = {
    activities: [
      { id: 1, sport_type: "Run" },
      { id: 2, sport_type: "Run" },
      { id: 3, sport_type: "Run" }
    ],
    detailsById: new Map([
      ["1", { id: 1, best_efforts: [{ id: "effort-1" }] }],
      ["2", server.sanitizeActivityDetailError({ id: 2 }, new Error("Not Found"), "2026-05-28T00:00:00.000Z")]
    ])
  };

  assert.deepEqual(JSON.parse(JSON.stringify(server.detailStatusFromStore(store))), {
    runCount: 3,
    fetchedRunCount: 1,
    failedRunCount: 1,
    pendingRunCount: 2,
    bestEffortActivityCount: 1,
    bestEffortCount: 1
  });
});

test("resolveStaticFilePath rejects public directory prefix escapes", () => {
  const server = loadServerContext();

  assert.equal(path.basename(server.resolveStaticFilePath("/index.html")), "index.html");
  assert.throws(
    () => server.resolveStaticFilePath("/../public-evil/index.html"),
    /Forbidden/
  );
});

test("upsertEnvText creates Strava env entries and preserves other values", () => {
  const server = loadServerContext();
  const text = [
    "PORT=3010",
    "STRAVA_CLIENT_ID=old",
    "# Keep local server binding",
    "HOST=127.0.0.1"
  ].join("\n");

  assert.equal(
    server.upsertEnvText(text, {
      STRAVA_CLIENT_ID: "12345",
      STRAVA_CLIENT_SECRET: "secret-value"
    }),
    [
      "PORT=3010",
      "STRAVA_CLIENT_ID=12345",
      "# Keep local server binding",
      "HOST=127.0.0.1",
      "",
      "STRAVA_CLIENT_SECRET=secret-value",
      ""
    ].join("\n")
  );
});

test("normalizeStravaConfigInput rejects invalid setup payloads", () => {
  const server = loadServerContext();

  assert.deepEqual(
    JSON.parse(JSON.stringify(server.normalizeStravaConfigInput({ clientId: "12345", clientSecret: "abc123" }))),
    { clientId: "12345", clientSecret: "abc123" }
  );
  assert.throws(
    () => server.normalizeStravaConfigInput({ clientId: "abc", clientSecret: "abc123" }),
    /Client ID/
  );
  assert.throws(
    () => server.normalizeStravaConfigInput({ clientId: "12345", clientSecret: "abc\n123" }),
    /Client Secret/
  );
});

test("getConfig treats copied example placeholders as unconfigured", () => {
  const server = loadServerContext();
  const previousId = process.env.STRAVA_CLIENT_ID;
  const previousSecret = process.env.STRAVA_CLIENT_SECRET;

  try {
    process.env.STRAVA_CLIENT_ID = "replace_with_your_client_id";
    process.env.STRAVA_CLIENT_SECRET = "replace_with_your_client_secret";

    assert.equal(server.getConfig().configured, false);
  } finally {
    if (previousId === undefined) delete process.env.STRAVA_CLIENT_ID;
    else process.env.STRAVA_CLIENT_ID = previousId;
    if (previousSecret === undefined) delete process.env.STRAVA_CLIENT_SECRET;
    else process.env.STRAVA_CLIENT_SECRET = previousSecret;
  }
});

test("export endpoints are not exposed", async () => {
  const server = loadServerContext();

  assert.equal((await callApi(server, "/api/export.csv")).statusCode, 404);
  assert.equal((await callApi(server, "/api/export.json")).statusCode, 404);
});

test("activity stream sync endpoint is not exposed", async () => {
  const server = loadServerContext();

  assert.equal((await callApi(server, "/api/activity-streams/sync", "POST", {
    headers: { "content-type": "application/json" },
    body: "{}"
  })).statusCode, 404);
});

test("local server rejects untrusted hosts and cross-origin writes", async () => {
  const server = loadServerContext();

  assert.equal((await callRequest(server, {
    method: "GET",
    url: "/api/status",
    headers: { host: "attacker.test:3000" }
  })).statusCode, 403);

  assert.equal((await callRequest(server, {
    method: "POST",
    url: "/api/sync",
    headers: {
      host: "localhost:3000",
      origin: "https://attacker.test",
      "content-type": "application/json"
    },
    body: "{}"
  })).statusCode, 403);
});

test("json request bodies require json content type and stay size limited", async () => {
  const server = loadServerContext();

  assert.throws(
    () => server.assertJsonRequest(makeRequest({ method: "POST", headers: { "content-type": "text/plain" } })),
    /application\/json/
  );

  await assert.rejects(
    server.parseJsonBody(makeRequest({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "x".repeat(70 * 1024)
    })),
    /too large/
  );
});

test("activity detail sanitizing drops route-heavy fields but keeps best efforts", () => {
  const server = loadServerContext();
  const sanitized = server.sanitizeActivityDetails({
    id: 1,
    name: "Morning Run",
    sport_type: "Run",
    distance: 5000,
    start_latlng: [37, -122],
    map: { summary_polyline: "encoded" },
    segment_efforts: [{ id: 10 }],
    splits_metric: [{ distance: 1000 }],
    best_efforts: [{
      id: 99,
      name: "5K",
      distance: 5000,
      moving_time: 1500,
      elapsed_time: 1510,
      start_date: "2026-05-01T00:00:00Z",
      start_index: 1,
      end_index: 500,
      pr_rank: 1,
      hidden_location: "drop me"
    }]
  }, "2026-05-30T00:00:00.000Z");

  assert.equal(sanitized.name, "Morning Run");
  assert.deepEqual(JSON.parse(JSON.stringify(sanitized.best_efforts)), [{
    id: 99,
    name: "5K",
    distance: 5000,
    moving_time: 1500,
    elapsed_time: 1510,
    start_date: "2026-05-01T00:00:00Z",
    start_index: 1,
    end_index: 500,
    pr_rank: 1
  }]);
  assert.equal(sanitized.map, undefined);
  assert.equal(sanitized.start_latlng, undefined);
  assert.equal(sanitized.segment_efforts, undefined);
  assert.equal(sanitized.splits_metric, undefined);
});

test("failed activity details remain pending for retry", () => {
  const server = loadServerContext();
  const store = {
    activities: [
      { id: 1, sport_type: "Run" },
      { id: 2, sport_type: "Run" }
    ],
    detailsById: new Map([
      ["1", server.sanitizeActivityDetailError({ id: 1 }, new Error("Temporary"), "2026-05-28T00:00:00.000Z")]
    ])
  };

  assert.deepEqual(JSON.parse(JSON.stringify(server.detailStatusFromStore(store))), {
    runCount: 2,
    fetchedRunCount: 0,
    failedRunCount: 1,
    pendingRunCount: 2,
    bestEffortActivityCount: 0,
    bestEffortCount: 0
  });
});

test("activities API includes per-activity detail status metadata", async () => {
  const server = loadServerContext();

  vm.runInContext(`
    readStore = async () => ({
      token: null,
      activities: [
        { id: 1, name: "Fetched Run", sport_type: "Run", start_date: "2026-05-04T00:00:00Z" },
        { id: 2, name: "Failed Run", sport_type: "Run", start_date: "2026-05-03T00:00:00Z" },
        { id: 3, name: "Missing Run", sport_type: "Run", start_date: "2026-05-02T00:00:00Z" },
        { id: 4, name: "Ride", sport_type: "Ride", start_date: "2026-05-01T00:00:00Z" }
      ],
      detailsById: new Map([
        ["1", {
          id: 1,
          sport_type: "Run",
          best_efforts: [{ id: "a" }, { id: "b" }],
          details_fetched_at: "2026-05-05T00:00:00.000Z"
        }],
        ["2", sanitizeActivityDetailError(
          { id: 2, sport_type: "Run" },
          new Error("Not Found"),
          "2026-05-06T00:00:00.000Z"
        )]
      ])
    });
  `, server);

  const response = await callApi(server, "/api/activities");
  const body = JSON.parse(response.body);
  const statuses = Object.fromEntries(body.activities.map((activity) => [String(activity.id), {
    status: activity.detail_status,
    bestEffortCount: activity.best_effort_count,
    fetchedAt: activity.details_fetched_at || null,
    failedAt: activity.details_fetch_failed_at || null,
    error: activity.details_fetch_error?.message || null
  }]));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(statuses, {
    "1": {
      status: "fetched",
      bestEffortCount: 2,
      fetchedAt: "2026-05-05T00:00:00.000Z",
      failedAt: null,
      error: null
    },
    "2": {
      status: "failed",
      bestEffortCount: 0,
      fetchedAt: null,
      failedAt: "2026-05-06T00:00:00.000Z",
      error: "Not Found"
    },
    "3": {
      status: "missing",
      bestEffortCount: 0,
      fetchedAt: null,
      failedAt: null,
      error: null
    },
    "4": {
      status: "not_applicable",
      bestEffortCount: 0,
      fetchedAt: null,
      failedAt: null,
      error: null
    }
  });
});

test("activity detail refresh endpoint refetches one saved run even when cached", async () => {
  const server = loadServerContext();

  vm.runInContext(`
    mockStore = {
      activities: [{
        id: 123,
        name: "Old Run",
        sport_type: "Run",
        distance: 4900,
        moving_time: 1510,
        start_date: "2026-05-01T00:00:00Z"
      }],
      detailsById: new Map([["123", {
        id: 123,
        name: "Old Run",
        sport_type: "Run",
        best_efforts: [{ id: "old-effort", name: "5K", distance: 5000, moving_time: 1500 }],
        details_fetched_at: "2026-05-01T00:00:00.000Z"
      }]])
    };
    mockFetchCalls = [];
    readStore = async () => mockStore;
    ensureAccessToken = async (store) => ({ store, accessToken: "access-token" });
    fetchDetailedActivity = async (accessToken, id) => {
      mockFetchCalls.push({ accessToken, id });
      return {
        id: 123,
        name: "Fixed Run",
        sport_type: "Run",
        distance: 5000,
        moving_time: 1490,
        start_date: "2026-05-01T00:00:00Z",
        best_efforts: [{ id: "new-effort", name: "5K", distance: 5000, moving_time: 1490 }]
      };
    };
    writeActivityDetail = async (id, detail) => { mockWrittenDetail = { id, detail }; };
    writeStore = async (store) => { mockWrittenStore = store; return store; };
  `, server);

  const response = await callApi(server, "/api/activity-details/refresh", "POST", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ activityId: 123 })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  const result = vm.runInContext(`({
    fetchCalls: mockFetchCalls,
    writtenDetail: mockWrittenDetail,
    writtenActivities: mockWrittenStore.activities
  })`, server);

  assert.equal(body.summary.refreshed, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(result.fetchCalls)), [{ accessToken: "access-token", id: "123" }]);
  assert.equal(result.writtenDetail.id, "123");
  assert.equal(result.writtenDetail.detail.name, "Fixed Run");
  assert.equal(result.writtenDetail.detail.best_efforts[0].id, "new-effort");
  assert.equal(result.writtenActivities[0].name, "Fixed Run");
  assert.equal(result.writtenActivities[0].moving_time, 1490);
});

test("topbar omits eyebrow copy", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");

  assert.doesNotMatch(html, /class="eyebrow"/);
  assert.doesNotMatch(html, /Running log/);
  assert.doesNotMatch(html, /Strava running log/i);
});

test("topbar reserves a hidden repository icon link", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");

  assert.match(html, /<a class="topbar-icon-link repository-link hidden" id="repositoryLink"[\s\S]*aria-label="View repository"[\s\S]*title="View repository"/);
  assert.match(html, /<svg[\s\S]*aria-hidden="true"[\s\S]*viewBox="0 0 24 24"/);
  assert.match(css, /\.topbar-icon-link\s*{/);
});

test("configureRepositoryLink shows the repository link only when a URL is configured", () => {
  const app = loadAppContext();

  const result = vm.runInContext(`
    function makeLink() {
      const classes = new Set(["hidden"]);
      return {
        href: "",
        rel: "",
        target: "",
        classList: {
          add(name) { classes.add(name); },
          remove(name) { classes.delete(name); },
          contains(name) { return classes.has(name); }
        },
        attributes: {},
        removeAttribute(name) { delete this.attributes[name]; },
        setAttribute(name, value) { this.attributes[name] = value; }
      };
    }

    const hiddenLink = makeLink();
    els.repositoryLink = hiddenLink;
    configureRepositoryLink("");

    const visibleLink = makeLink();
    els.repositoryLink = visibleLink;
    configureRepositoryLink("https://github.com/example/runasis");

    ({
      hiddenIsHidden: hiddenLink.classList.contains("hidden"),
      hiddenHref: hiddenLink.href,
      hiddenDisabled: hiddenLink.attributes["aria-disabled"],
      visibleIsHidden: visibleLink.classList.contains("hidden"),
      visibleHref: visibleLink.href,
      visibleTarget: visibleLink.target,
      visibleRel: visibleLink.rel,
      visibleDisabled: visibleLink.attributes["aria-disabled"]
    });
  `, app);

  assert.equal(result.hiddenIsHidden, true);
  assert.equal(result.hiddenHref, "");
  assert.equal(result.hiddenDisabled, "true");
  assert.equal(result.visibleIsHidden, false);
  assert.equal(result.visibleHref, "https://github.com/example/runasis");
  assert.equal(result.visibleTarget, "_blank");
  assert.equal(result.visibleRel, "noreferrer");
  assert.equal(result.visibleDisabled, undefined);
});

test("topbar exposes one Strava sync action", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  const topbarActions = html.match(/<div class="topbar-actions">[\s\S]*?<\/div>/)?.[0] || "";

  assert.match(topbarActions, /id="syncButton"/);
  assert.doesNotMatch(topbarActions, /id="detailSyncButton"/);
  assert.doesNotMatch(topbarActions, />Best Efforts</);
});

test("syncActivities fetches pending best efforts after activity sync", async () => {
  const app = loadAppContext();

  const result = await vm.runInContext(`
    (async () => {
      const calls = [];
      const button = () => ({ disabled: false, textContent: "" });
      els.connectButton = button();
      els.syncButton = button();
      els.clearButton = button();
      els.stravaConfigSaveButton = button();
      appState.status = {
        configured: true,
        connected: true,
        activityDetails: { pendingRunCount: 0 }
      };
      fetchJson = async (url, options = {}) => {
        calls.push({ url, method: options.method || "GET" });
        if (url === "/api/sync") {
          return {
            summary: { inserted: 1, updated: 2 },
            status: { activityDetails: { pendingRunCount: 3 } }
          };
        }
        if (url === "/api/activity-details/sync") {
          return {
            summary: {
              fetched: 3,
              failed: 0,
              remaining: 0,
              skippedFailed: 0,
              stoppedReason: null
            }
          };
        }
        throw new Error("Unexpected URL " + url);
      };
      loadData = async () => {
        calls.push({ url: "loadData" });
      };
      toast = (message) => {
        calls.push({ url: "toast", message });
      };

      await syncActivities();
      return {
        callUrls: calls.map((call) => call.url).join("|"),
        detailMethod: calls[1].method,
        toastMessage: calls.at(-1).message,
        syncing: appState.syncing,
        detailSyncing: appState.detailSyncing,
        syncText: els.syncButton.textContent
      };
    })()
  `, app);

  assert.equal(result.callUrls, "/api/sync|/api/activity-details/sync|loadData|toast");
  assert.equal(result.detailMethod, "POST");
  assert.match(result.toastMessage, /Sync complete: 1 new, 2 updated/);
  assert.match(result.toastMessage, /Best efforts: 3 new, 0 failed, 0 remaining/);
  assert.equal(result.syncing, false);
  assert.equal(result.detailSyncing, false);
  assert.equal(result.syncText, "Sync");
});

test("syncActivities skips best-effort fetch when no run details are pending", async () => {
  const app = loadAppContext();

  const result = await vm.runInContext(`
    (async () => {
      const calls = [];
      const button = () => ({ disabled: false, textContent: "" });
      els.connectButton = button();
      els.syncButton = button();
      els.clearButton = button();
      els.stravaConfigSaveButton = button();
      appState.status = {
        configured: true,
        connected: true,
        activityDetails: { pendingRunCount: 0 }
      };
      fetchJson = async (url, options = {}) => {
        calls.push({ url, method: options.method || "GET" });
        if (url === "/api/sync") {
          return {
            summary: { inserted: 0, updated: 1 },
            status: { activityDetails: { pendingRunCount: 0 } }
          };
        }
        throw new Error("Unexpected URL " + url);
      };
      loadData = async () => {
        calls.push({ url: "loadData" });
      };
      toast = (message) => {
        calls.push({ url: "toast", message });
      };

      await syncActivities();
      return {
        callUrls: calls.map((call) => call.url).join("|"),
        toastMessage: calls.at(-1).message
      };
    })()
  `, app);

  assert.equal(result.callUrls, "/api/sync|loadData|toast");
  assert.match(result.toastMessage, /Sync complete: 0 new, 1 updated/);
  assert.doesNotMatch(result.toastMessage, /Best efforts:/);
});

test("clear data is disabled while background work is running", () => {
  const app = loadAppContext();

  const result = vm.runInContext(`
    function button() {
      return { disabled: false, textContent: "" };
    }
    els.connectButton = button();
    els.syncButton = button();
    els.clearButton = button();
    els.stravaConfigSaveButton = button();
    appState.status = {
      configured: true,
      connected: true,
      activityDetails: { pendingRunCount: 1 }
    };
    appState.syncing = true;
    updateActionButtons();
    els.clearButton.disabled;
  `, app);

  assert.equal(result, true);
});

test("renderPersonalBestTrendChart keeps the panel caption empty and moves trend into the chart", () => {
  const app = loadAppContext();

  const result = vm.runInContext(`
    els.personalBestTrendLimitButtons = [];
    els.personalBestTrendDistanceSelect = { disabled: false, innerHTML: "" };
    els.personalBestTrendCaption = { textContent: "old caption" };
    els.personalBestTrendChart = { innerHTML: "" };
    appState.personalBestTrendLimit = 10;
    appState.personalBestTrendDistanceName = "5K";
    const efforts = Array.from({ length: 20 }, (_, index) => ({
      movingTime: 1500 - index * 3,
      paceSecondsPerKm: 300 - index,
      startDate: new Date(Date.UTC(2024, index, 1)).toISOString(),
      activityName: "Effort " + (index + 1)
    }));
    appState.personalBests = {
      distances: [{
        name: "5K",
        top: efforts
      }]
    };

    renderPersonalBestTrendChart();
    ({
      caption: els.personalBestTrendCaption.textContent,
      chart: els.personalBestTrendChart.innerHTML
    });
  `, app);

  assert.equal(result.caption, "");
  assert.match(result.chart, />Top 20</);
  assert.doesNotMatch(result.chart, />Top 10</);
  assert.match(result.chart, />Trend -0:12\/yr</);
  assert.doesNotMatch(result.chart, /Trend -0:12\/km/);
  assert.doesNotMatch(result.chart, /highlighting top|based on .*best efforts|5K ·/);
});

test("renderPersonalBestChart keeps the panel caption empty", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  const app = loadAppContext();

  const result = vm.runInContext(`
    const toggleClass = { toggle() {} };
    els.personalBestScaleButtons = [{ dataset: { scale: "linear" }, classList: toggleClass }];
    els.personalBestChartCaption = { textContent: "old caption" };
    els.personalBestChart = { innerHTML: "" };
    appState.personalBestScale = "linear";
    appState.personalBests = {
      distances: [
        {
          name: "5K",
          distanceKm: 5,
          top: [{ paceSecondsPerKm: 300, movingTime: 1500 }],
          median: { paceSecondsPerKm: 330, movingTime: 1650, count: 2 }
        },
        {
          name: "10K",
          distanceKm: 10,
          top: [{ paceSecondsPerKm: 330, movingTime: 3300 }],
          median: { paceSecondsPerKm: 360, movingTime: 3600, count: 2 }
        }
      ]
    };

    renderPersonalBestChart();
    ({
      caption: els.personalBestChartCaption.textContent,
      chart: els.personalBestChart.innerHTML
    });
  `, app);

  assert.equal(result.caption, "");
  assert.doesNotMatch(result.chart, /Linear distance axis|Log distance axis/);
  assert.doesNotMatch(html, /Top 1 · Top 3 · Top 10 · Median/);
});

test("renderPersonalBests adds refresh buttons for source activities", () => {
  const app = loadAppContext();

  const result = vm.runInContext(`
    els.personalBestGrid = { innerHTML: "" };
    appState.expandedPersonalBestDistances = new Set();
    appState.refreshingActivityId = null;
    appState.personalBests = {
      detailActivityCount: 1,
      effortCount: 1,
      distances: [{
        name: "5K",
        count: 1,
        top: [{
          activityId: 123,
          activityName: "Fixed Run",
          startDate: "2026-05-01T00:00:00Z",
          movingTime: 1490,
          paceSecondsPerKm: 298
        }]
      }]
    };

    renderPersonalBests();
    els.personalBestGrid.innerHTML;
  `, app);

  assert.match(result, /data-refresh-activity-id="123"/);
  assert.match(result, /aria-label="Refresh Fixed Run"/);
  assert.match(result, /title="Refresh Activity"/);
  assert.match(result, /class="refresh-icon"/);
  assert.match(result, /aria-hidden="true"/);
  assert.doesNotMatch(result, />Refresh Activity</);
});

test("renderRiegelAnalysis leaves redundant secondary analysis text out of the summary and chart caption", () => {
  const app = loadAppContext();

  const result = vm.runInContext(`
    const toggleClass = { toggle() {} };
    els.riegelCaption = { textContent: "" };
    els.riegelProjectionCaption = { textContent: "" };
    els.riegelExponentInput = { disabled: false, value: "" };
    els.riegelExponentModeButtons = [];
    els.riegelFiveKScaleButtons = [{ dataset: { scale: "linear" }, classList: toggleClass }];
    els.riegelFiveKSeriesButtons = [{ dataset: { series: "top1" }, classList: toggleClass }];
    els.riegelSummaryGrid = { innerHTML: "" };
    els.riegelEquivalentChartTitle = { textContent: "" };
    els.riegelFiveKChartCaption = { textContent: "old caption" };
    els.riegelFiveKChart = { innerHTML: "" };
    els.riegelProjectionTable = { innerHTML: "" };
    appState.riegelFiveKScale = "linear";
    appState.riegelFiveKSeries = "top1";
    appState.riegelSourceDistanceName = "5K";
    appState.riegelExponentMode = "median";
    appState.personalBests = {
      distances: [
        { name: "5K", distanceKm: 5, top: [{ movingTime: 1500, paceSecondsPerKm: 300 }] },
        { name: "10K", distanceKm: 10, top: [{ movingTime: 3150, paceSecondsPerKm: 315 }] },
        { name: "Half-Marathon", distanceKm: 21.097, top: [{ movingTime: 7200, paceSecondsPerKm: 341.3 }] }
      ]
    };

    renderRiegelAnalysis();
    ({
      summary: els.riegelSummaryGrid.innerHTML,
      analysisCaption: els.riegelCaption.textContent,
      chartCaption: els.riegelFiveKChartCaption.textContent,
      equivalentTitle: els.riegelEquivalentChartTitle.textContent,
      projectionCaption: els.riegelProjectionCaption.textContent
    });
  `, app);

  assert.match(result.summary, /Median Exponent/);
  assert.doesNotMatch(result.summary, /Your Record/);
  assert.doesNotMatch(result.summary, /Actual record you achieved/);
  assert.doesNotMatch(result.summary, /Baseline Best/);
  assert.doesNotMatch(result.summary, /Baseline Record/);
  assert.doesNotMatch(result.summary, /Expected Record/);
  assert.match(result.summary, />Expected Half-Marathon<[\s\S]*\d+:\d{2}:\d{2}[\s\S]*\d+:\d{2}\/km · <span class="metric-delta/);
  assert.match(result.summary, />Expected Marathon<[\s\S]*\d+:\d{2}:\d{2}[\s\S]*<small>\d+:\d{2}\/km<\/small>/);
  assert.doesNotMatch(result.summary, /Median prediction/);
  assert.doesNotMatch(result.summary, /current record/);
  assert.doesNotMatch(result.summary, /Expected Best/);
  assert.doesNotMatch(result.summary, /Marathon Projection/);
  assert.match(result.summary, /class="kpi-card kpi-card--value-only"[\s\S]*Median Exponent/);
  assert.doesNotMatch(result.summary, /segments · up to/);
  assert.equal(result.analysisCaption, "");
  assert.equal(result.chartCaption, "");
  assert.equal(result.equivalentTitle, "5K Prediction");
  assert.equal(result.projectionCaption, "");
});

test("Riegel equivalent chart has its own help dialog copy", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");

  assert.match(html, /id="riegelEquivalentInfoButton"/);
  assert.match(html, /id="riegelEquivalentInfoDialog"/);
  assert.match(html, /selected baseline distance from each personal best/i);
  assert.doesNotMatch(html, />Source</);
  assert.doesNotMatch(html, /About source prediction/i);
  assert.doesNotMatch(html, /id="riegelCaption"/);
  assert.doesNotMatch(html, /id="riegelProjectionCaption"/);
});

test("Riegel projection panel spans the full analysis grid row", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");

  assert.match(html, /<article class="records-panel analysis-panel analysis-panel--full-row">[\s\S]*<h2 id="riegelProjectionTitle">Riegel Projection<\/h2>/);
  assert.match(css, /\.analysis-panel--full-row\s*{\s*grid-column:\s*1\s*\/\s*-1;\s*}/);
});

test("renderRiegelAnalysis labels the projection table with the selected baseline distance", () => {
  const app = loadAppContext();

  const result = vm.runInContext(`
    const toggleClass = { toggle() {} };
    els.riegelProjectionTitle = { textContent: "old title" };
    els.riegelExponentInput = { disabled: false, value: "" };
    els.riegelExponentModeButtons = [];
    els.riegelFiveKScaleButtons = [{ dataset: { scale: "linear" }, classList: toggleClass }];
    els.riegelFiveKSeriesButtons = [{ dataset: { series: "top1" }, classList: toggleClass }];
    els.riegelSummaryGrid = { innerHTML: "" };
    els.riegelEquivalentChartTitle = { textContent: "" };
    els.riegelExpectedPaceChartCaption = { textContent: "" };
    els.riegelExpectedPaceChart = { innerHTML: "" };
    els.riegelFiveKChartCaption = { textContent: "" };
    els.riegelFiveKChart = { innerHTML: "" };
    els.riegelProjectionTable = { innerHTML: "" };
    appState.riegelFiveKScale = "linear";
    appState.riegelFiveKSeries = "top1";
    appState.riegelSourceDistanceName = "10K";
    appState.riegelExponentMode = "custom";
    appState.riegelCustomExponent = 1;
    appState.personalBests = {
      distances: [
        { name: "5K", distanceKm: 5, top: [{ movingTime: 1500, paceSecondsPerKm: 300 }] },
        { name: "10K", distanceKm: 10, top: [{ movingTime: 3150, paceSecondsPerKm: 315 }] }
      ]
    };

    renderRiegelAnalysis();
    els.riegelProjectionTitle.textContent;
  `, app);

  assert.equal(result, "Riegel Projection · 10K");
});

test("Riegel baseline is selected from chart bars instead of a dropdown", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  const app = loadAppContext();

  assert.doesNotMatch(html, /id="riegelSourceDistanceSelect"/);
  assert.doesNotMatch(html, /class="select-field riegel-source-field"/);

  assert.doesNotThrow(() => vm.runInContext(`
    const fakeElement = () => ({ addEventListener() {} });
    els.setupForm = fakeElement();
    els.connectButton = fakeElement();
    els.syncButton = fakeElement();
    els.clearButton = fakeElement();
    els.openActivityListButton = fakeElement();
    els.backActivityListButton = fakeElement();
    els.rangeSelect = fakeElement();
    els.allActivitySearchInput = fakeElement();
    els.allActivityRunOnlyInput = fakeElement();
    els.allActivityDetailStatusSelect = fakeElement();
    els.allActivityTable = fakeElement();
    els.activityListView = fakeElement();
    els.personalBestTrendDistanceSelect = fakeElement();
    els.personalBestGrid = fakeElement();
    els.riegelExponentInput = fakeElement();
    els.kpiCards = [];
    els.viewTabs = [];
    els.personalBestScaleButtons = [];
    els.personalBestTrendLimitButtons = [];
    els.allActivitySortButtons = [];
    els.riegelFiveKScaleButtons = [];
    els.riegelFiveKSeriesButtons = [];
    els.riegelExponentModeButtons = [];

    bindEvents();
  `, app));
});

test("all activities is a dashboard drill-down, not a peer top-level tab", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");

  const topTabs = html.match(/<div class="view-tabs"[\s\S]*?<\/div>/)?.[0] || "";
  const recentPanel = html.match(/<h2>Recent Activities<\/h2>[\s\S]*?<tbody id="activityTable">/)?.[0] || "";

  assert.doesNotMatch(topTabs, /data-view="activities"/);
  assert.doesNotMatch(topTabs, />Activities</);
  assert.match(recentPanel, /id="openActivityListButton"/);
  assert.match(html, /id="activityListView"/);
  assert.match(html, /id="backActivityListButton"/);
});

test("renderAllActivities filters, sorts, and keeps refresh actions on run rows", () => {
  const app = loadAppContext();

  const result = vm.runInContext(`
    els.allActivityCountCaption = { textContent: "" };
    els.allActivitySearchInput = { value: "" };
    els.allActivityRunOnlyInput = { checked: false };
    els.allActivityDetailStatusSelect = { value: "all" };
    els.allActivityTable = { innerHTML: "" };
    els.allActivitySortButtons = [];
    appState.activities = [
      {
        id: 1,
        name: "Easy Run",
        sport_type: "Run",
        start_date_local: "2026-05-01T07:00:00",
        distance: 5000,
        moving_time: 1800,
        total_elevation_gain: 20,
        average_heartrate: 140,
        detail_status: "fetched",
        best_effort_count: 3,
        details_fetched_at: "2026-05-01T08:00:00.000Z"
      },
      {
        id: 2,
        name: "Fast Run",
        sport_type: "Run",
        start_date_local: "2026-05-02T07:00:00",
        distance: 5000,
        moving_time: 1500,
        total_elevation_gain: 10,
        average_heartrate: 150,
        detail_status: "missing",
        best_effort_count: 0
      },
      {
        id: 3,
        name: "Commute",
        sport_type: "Ride",
        start_date_local: "2026-05-03T07:00:00",
        distance: 10000,
        moving_time: 2000,
        detail_status: "not_applicable",
        best_effort_count: 0
      }
    ];
    appState.allActivitySearch = "run";
    appState.allActivityRunOnly = true;
    appState.allActivityDetailStatus = "all";
    appState.allActivitySort = { key: "pace", direction: "asc" };

    renderAllActivities();
    ({
      caption: els.allActivityCountCaption.textContent,
      table: els.allActivityTable.innerHTML
    });
  `, app);

  assert.equal(result.caption, "2 shown · 3 saved");
  assert.match(result.table, /Fast Run[\s\S]*Easy Run/);
  assert.doesNotMatch(result.table, /Commute/);
  assert.match(result.table, /data-refresh-activity-id="2"/);
  assert.match(result.table, /data-refresh-activity-id="1"/);
  assert.match(result.table, />Missing</);
  assert.match(result.table, />Fetched/);
});

test("Riegel reference link uses a readable source in a new window", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  const link = html.match(/<a ([^>]+)>Peter Riegel on Wikipedia<\/a>/);

  assert.ok(link);
  assert.match(link[1], /href="https:\/\/en\.wikipedia\.org\/wiki\/Peter_Riegel"/);
  assert.match(link[1], /\starget="_blank"/);
  assert.match(link[1], /\srel="noopener noreferrer"/);
  assert.doesNotMatch(html, /semanticscholar/i);
});

test("Riegel projection table has its own help dialog copy", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");

  assert.match(html, /id="riegelProjectionInfoButton"/);
  assert.match(html, /id="riegelProjectionInfoDialog"/);
  assert.match(html, /estimates each target distance from the selected baseline best/i);
});

test("Riegel analysis omits the segment exponent panel", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");

  assert.doesNotMatch(html, /Distance Segment Exponent/);
  assert.doesNotMatch(html, /riegelExponentCaption/);
  assert.doesNotMatch(html, /riegelExponentTable/);
});

test("expected vs current chart exposes the shared x-axis scale toggle", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  const panel = html.match(/<h2>Expected vs Current by Distance<\/h2>[\s\S]*?<div class="chart-box personal-best-chart expected-gap-chart"/)?.[0] || "";

  assert.match(panel, /aria-label="Expected vs current x-axis scale"/);
  assert.match(panel, /class="scale-option riegel-scale-option active"[^>]*data-scale="linear"/);
  assert.match(panel, /class="scale-option riegel-scale-option"[^>]*data-scale="log"/);
});

test("renderRiegelAnalysis calculates median exponent from the full distance range", () => {
  const app = loadAppContext();

  const result = vm.runInContext(`
    const toggleClass = { toggle() {} };
    els.riegelCaption = { textContent: "" };
    els.riegelProjectionCaption = { textContent: "" };
    els.riegelExponentInput = { disabled: false, value: "" };
    els.riegelExponentModeButtons = [];
    els.riegelFiveKScaleButtons = [{ dataset: { scale: "linear" }, classList: toggleClass }];
    els.riegelFiveKSeriesButtons = [{ dataset: { series: "top1" }, classList: toggleClass }];
    els.riegelSummaryGrid = { innerHTML: "" };
    els.riegelEquivalentChartTitle = { textContent: "" };
    els.riegelFiveKChartCaption = { textContent: "" };
    els.riegelFiveKChart = { innerHTML: "" };
    els.riegelProjectionTable = { innerHTML: "" };
    appState.riegelFiveKScale = "linear";
    appState.riegelFiveKSeries = "top1";
    appState.riegelSourceDistanceName = "5K";
    appState.riegelExponentMode = "median";
    appState.personalBests = {
      distances: [
        { name: "5K", distanceKm: 5, top: [{ movingTime: 1500, paceSecondsPerKm: 300 }] },
        { name: "10K", distanceKm: 10, top: [{ movingTime: 3120, paceSecondsPerKm: 312 }] },
        { name: "Half-Marathon", distanceKm: 21.097, top: [{ movingTime: 7200, paceSecondsPerKm: 341.3 }] },
        { name: "30K", distanceKm: 30, top: [{ movingTime: 12000, paceSecondsPerKm: 400 }] },
        { name: "Marathon", distanceKm: 42.195, top: [{ movingTime: 20000, paceSecondsPerKm: 474 }] }
      ]
    };

    renderRiegelAnalysis();
    ({
      medianExponent: appState.riegelExponent,
      summary: els.riegelSummaryGrid.innerHTML
    });
  `, app);

  assert.ok(Math.abs(result.medianExponent - 1.286) < 0.001);
  assert.match(result.summary, /1\.286/);
});

test("renderRiegelAnalysis draws median expected record line on baseline prediction chart", () => {
  const app = loadAppContext();

  const chart = vm.runInContext(`
    const toggleClass = { toggle() {} };
    els.riegelCaption = { textContent: "" };
    els.riegelProjectionCaption = { textContent: "" };
    els.riegelExponentInput = { disabled: false, value: "" };
    els.riegelExponentModeButtons = [];
    els.riegelFiveKScaleButtons = [{ dataset: { scale: "linear" }, classList: toggleClass }];
    els.riegelFiveKSeriesButtons = [{ dataset: { series: "top1" }, classList: toggleClass }];
    els.riegelSummaryGrid = { innerHTML: "" };
    els.riegelEquivalentChartTitle = { textContent: "" };
    els.riegelFiveKChartCaption = { textContent: "" };
    els.riegelFiveKChart = { innerHTML: "" };
    els.riegelProjectionTable = { innerHTML: "" };
    appState.riegelFiveKScale = "linear";
    appState.riegelFiveKSeries = "top1";
    appState.riegelSourceDistanceName = "5K";
    appState.riegelExponentMode = "median";
    appState.personalBests = {
      distances: [
        { name: "400m", distanceKm: 0.4, top: [{ movingTime: 80, paceSecondsPerKm: 200 }] },
        { name: "5K", distanceKm: 5, top: [{ movingTime: 1500, paceSecondsPerKm: 300 }] },
        { name: "10K", distanceKm: 10, top: [{ movingTime: 3150, paceSecondsPerKm: 315 }] }
      ]
    };

    renderRiegelAnalysis();
    els.riegelFiveKChart.innerHTML;
  `, app);

  assert.match(chart, /Expected 5K/);
  assert.match(chart, /data-tooltip="Expected 5K/);
  assert.match(chart, /stroke="#7f4aa4"/);
  assert.doesNotMatch(chart, /Expected 5K[\s\S]*stroke="#c7672f"/);
});

test("renderRiegelAnalysis scales baseline prediction chart from the full distance range", () => {
  const app = loadAppContext();

  const chart = vm.runInContext(`
    const toggleClass = { toggle() {} };
    const efforts = (movingTime, paceSecondsPerKm) => Array.from({ length: 10 }, (_, index) => ({
      movingTime: movingTime + index,
      paceSecondsPerKm
    }));
    els.riegelCaption = { textContent: "" };
    els.riegelProjectionCaption = { textContent: "" };
    els.riegelExponentInput = { disabled: false, value: "" };
    els.riegelExponentModeButtons = [];
    els.riegelFiveKScaleButtons = [{ dataset: { scale: "linear" }, classList: toggleClass }];
    els.riegelFiveKSeriesButtons = [{ dataset: { series: "top10" }, classList: toggleClass }];
    els.riegelSummaryGrid = { innerHTML: "" };
    els.riegelEquivalentChartTitle = { textContent: "" };
    els.riegelFiveKChartCaption = { textContent: "" };
    els.riegelFiveKChart = { innerHTML: "" };
    els.riegelProjectionTable = { innerHTML: "" };
    appState.riegelFiveKScale = "linear";
    appState.riegelFiveKSeries = "top10";
    appState.riegelSourceDistanceName = "5K";
    appState.riegelExponentMode = "default";
    appState.personalBests = {
      distances: [
        { name: "5K", distanceKm: 5, top: efforts(1500, 300) },
        { name: "10K", distanceKm: 10, top: efforts(3300, 330) },
        { name: "Half-Marathon", distanceKm: 21.097, top: efforts(7200, 341.3) },
        { name: "30K", distanceKm: 30, top: efforts(14400, 480) },
        { name: "Marathon", distanceKm: 42.195, top: efforts(25200, 597.2) }
      ]
    };

    renderRiegelAnalysis();
    els.riegelFiveKChart.innerHTML;
  `, app);

  const paceLabels = [...chart.matchAll(/>(\d+):(\d{2})</g)]
    .map((match) => Number(match[1]) * 60 + Number(match[2]));
  assert.ok(Math.max(...paceLabels) >= 9 * 60);
});

test("renderRiegelAnalysis draws selected expected pace over the current pace graph", () => {
  const app = loadAppContext();

  const result = vm.runInContext(`
    const toggleClass = { toggle() {} };
    const efforts = (top1, top3, top10) => Array.from({ length: 10 }, (_, index) => ({
      movingTime: index === 0 ? top1 : index === 2 ? top3 : index === 9 ? top10 : top1 + index * 10,
      paceSecondsPerKm: 1
    }));
    els.riegelExponentInput = { disabled: false, value: "" };
    els.riegelExponentModeButtons = [];
    els.riegelFiveKScaleButtons = [{ dataset: { scale: "linear" }, classList: toggleClass }];
    els.riegelFiveKSeriesButtons = [
      { dataset: { series: "top1" }, classList: toggleClass },
      { dataset: { series: "top3" }, classList: toggleClass },
      { dataset: { series: "top10" }, classList: toggleClass }
    ];
    els.riegelSummaryGrid = { innerHTML: "" };
    els.riegelEquivalentChartTitle = { textContent: "" };
    els.riegelExpectedPaceChartCaption = { textContent: "old caption" };
    els.riegelExpectedPaceChart = { innerHTML: "" };
    els.riegelFiveKChartCaption = { textContent: "" };
    els.riegelFiveKChart = { innerHTML: "" };
    els.riegelProjectionTable = { innerHTML: "" };
    appState.riegelFiveKScale = "linear";
    appState.riegelFiveKSeries = "top3";
    appState.riegelSourceDistanceName = "5K";
    appState.riegelExponentMode = "custom";
    appState.riegelCustomExponent = 1;
    appState.personalBests = {
      distances: [
        { name: "5K", distanceKm: 5, top: efforts(1500, 1530, 1600) },
        { name: "10K", distanceKm: 10, top: efforts(3600, 3660, 3800) },
        { name: "20K", distanceKm: 20, top: efforts(9000, 9300, 9600) }
      ]
    };

    renderRiegelAnalysis();
    ({
      caption: els.riegelExpectedPaceChartCaption.textContent,
      chart: els.riegelExpectedPaceChart.innerHTML
    });
  `, app);

  assert.equal(result.caption, "");
  assert.match(result.chart, /aria-label="Riegel split pace and pace-gap bar chart by distance for Top 3"/);
  assert.match(result.chart, /data-riegel-distance-scale="linear"/);
  assert.match(result.chart, /data-riegel-panel="pace"/);
  assert.match(result.chart, /data-riegel-panel="gap"/);
  assert.match(result.chart, />Expected Top 3</);
  assert.match(result.chart, />Current Top 3</);
  assert.doesNotMatch(result.chart, />Gap bars</);
  assert.doesNotMatch(result.chart, /data-riegel-legend="gap"/);
  assert.doesNotMatch(result.chart, /data-riegel-expected-pace-series="top1"/);
  assert.doesNotMatch(result.chart, /data-riegel-expected-pace-series="top10"/);
  assert.match(result.chart, />5K</);
  assert.match(result.chart, />10K</);
  assert.match(result.chart, /data-riegel-expected-pace-distance="10K"/);
  assert.match(result.chart, /data-riegel-expected-pace-series="top3"/);
  assert.match(result.chart, /data-riegel-current-pace-distance="10K"/);
  assert.match(result.chart, /data-riegel-gap-bar-distance="10K"/);
  assert.match(result.chart, /<rect[\s\S]*data-riegel-gap-bar-distance="20K"/);
  assert.match(result.chart, /data-riegel-pace-gap-seconds="0"/);
  assert.match(result.chart, /data-riegel-pace-gap-seconds="-60"/);
  assert.match(result.chart, /data-riegel-pace-gap-seconds="99"/);
  assert.match(result.chart, />\+0:10</);
  assert.match(result.chart, />-0:10</);
  assert.match(result.chart, /y="338\.0"[\s\S]*height="48\.0"[\s\S]*data-riegel-gap-bar-distance="20K"/);
  assert.match(result.chart, /y="290\.0"[\s\S]*height="48\.0"[\s\S]*data-riegel-gap-bar-distance="5K"/);
  assert.match(result.chart, />\+1:39\/km</);
  assert.match(result.chart, />-1:00\/km</);
  assert.match(result.chart, />match</);
  assert.match(result.chart, /data-riegel-gap-label="20K"/);
  assert.match(result.chart, /Expected Top 3 10K[\s\S]*1:01:00[\s\S]*6:06\/km[\s\S]*Matches current Top 3/);
  assert.match(result.chart, /Current Top 3 10K[\s\S]*1:01:00[\s\S]*6:06\/km/);
  assert.match(result.chart, />Pace \(min\/km\)</);
  assert.match(result.chart, />Pace Gap \(sec\/km\)</);
  assert.match(result.chart, /text-anchor="end"[^>]*>Current faster</);
  assert.match(result.chart, /text-anchor="end"[^>]*>Current slower</);
});

test("renderRiegelAnalysis keeps expected pace through marathon without a current record", () => {
  const app = loadAppContext();

  const result = vm.runInContext(`
    const toggleClass = { toggle() {} };
    const makeTop = (time) => Array.from({ length: 10 }, (_, index) => ({
      movingTime: time + index * 5,
      paceSecondsPerKm: 1
    }));
    els.riegelExponentInput = { disabled: false, value: "" };
    els.riegelExponentModeButtons = [];
    els.riegelFiveKScaleButtons = [{ dataset: { scale: "linear" }, classList: toggleClass }];
    els.riegelFiveKSeriesButtons = [{ dataset: { series: "top1" }, classList: toggleClass }];
    els.riegelSummaryGrid = { innerHTML: "" };
    els.riegelEquivalentChartTitle = { textContent: "" };
    els.riegelExpectedPaceChartCaption = { textContent: "old caption" };
    els.riegelExpectedPaceChart = { innerHTML: "" };
    els.riegelFiveKChartCaption = { textContent: "" };
    els.riegelFiveKChart = { innerHTML: "" };
    els.riegelProjectionTable = { innerHTML: "" };
    appState.riegelFiveKScale = "linear";
    appState.riegelFiveKSeries = "top1";
    appState.riegelSourceDistanceName = "5K";
    appState.riegelExponentMode = "custom";
    appState.riegelCustomExponent = 1;
    appState.personalBests = {
      distances: [
        { name: "5K", distanceKm: 5, top: makeTop(1500) },
        { name: "10K", distanceKm: 10, top: makeTop(3300) },
        { name: "20K", distanceKm: 20, top: makeTop(7200) },
        { name: "30K", distanceKm: 30, top: makeTop(11700) }
      ]
    };

    renderRiegelAnalysis();
    els.riegelExpectedPaceChart.innerHTML;
  `, app);

  assert.match(result, /data-riegel-expected-pace-distance="Marathon"/);
  assert.match(result, /data-riegel-distance-label="Marathon"/);
  assert.doesNotMatch(result, /data-riegel-current-pace-distance="Marathon"/);
  assert.doesNotMatch(result, /data-riegel-gap-bar-distance="Marathon"/);
  assert.doesNotMatch(result, /data-riegel-expected-pace-distance="50K"/);
});

test("renderRiegelAnalysis suppresses crowded expected gap text labels", () => {
  const app = loadAppContext();

  const result = vm.runInContext(`
    const toggleClass = { toggle() {} };
    const makeTop = (time) => Array.from({ length: 10 }, (_, index) => ({
      movingTime: time + index * 5,
      paceSecondsPerKm: 1
    }));
    els.riegelExponentInput = { disabled: false, value: "" };
    els.riegelExponentModeButtons = [];
    els.riegelFiveKScaleButtons = [{ dataset: { scale: "linear" }, classList: toggleClass }];
    els.riegelFiveKSeriesButtons = [{ dataset: { series: "top1" }, classList: toggleClass }];
    els.riegelSummaryGrid = { innerHTML: "" };
    els.riegelEquivalentChartTitle = { textContent: "" };
    els.riegelExpectedPaceChartCaption = { textContent: "old caption" };
    els.riegelExpectedPaceChart = { innerHTML: "" };
    els.riegelFiveKChartCaption = { textContent: "" };
    els.riegelFiveKChart = { innerHTML: "" };
    els.riegelProjectionTable = { innerHTML: "" };
    appState.riegelFiveKScale = "linear";
    appState.riegelFiveKSeries = "top1";
    appState.riegelSourceDistanceName = "5K";
    appState.riegelExponentMode = "custom";
    appState.riegelCustomExponent = 1;
    appState.personalBests = {
      distances: [
        { name: "400m", distanceKm: 0.4, top: makeTop(90) },
        { name: "1/2 mile", distanceKm: 0.805, top: makeTop(190) },
        { name: "1K", distanceKm: 1, top: makeTop(245) },
        { name: "1 mile", distanceKm: 1.609, top: makeTop(430) },
        { name: "2 mile", distanceKm: 3.219, top: makeTop(910) },
        { name: "5K", distanceKm: 5, top: makeTop(1500) },
        { name: "10K", distanceKm: 10, top: makeTop(3300) },
        { name: "20K", distanceKm: 20, top: makeTop(7200) },
        { name: "30K", distanceKm: 30, top: makeTop(11700) }
      ]
    };

    renderRiegelAnalysis();
    ({
      caption: els.riegelExpectedPaceChartCaption.textContent,
      chart: els.riegelExpectedPaceChart.innerHTML
    });
  `, app);

  const gapLabelCount = (result.chart.match(/data-riegel-gap-label=/g) || []).length;
  const distanceLabelCount = (result.chart.match(/data-riegel-distance-label=/g) || []).length;

  assert.equal(result.caption, "");
  assert.equal(gapLabelCount, 0);
  assert.ok(distanceLabelCount < 9);
});

test("renderRiegelAnalysis separates crowded expected pace chart labels", () => {
  const app = loadAppContext();

  const result = vm.runInContext(`
    const toggleClass = { toggle() {} };
    const makeTop = (time) => Array.from({ length: 10 }, (_, index) => ({
      movingTime: time + index * 5,
      paceSecondsPerKm: 1
    }));
    els.riegelExponentInput = { disabled: false, value: "" };
    els.riegelExponentModeButtons = [];
    els.riegelFiveKScaleButtons = [{ dataset: { scale: "log" }, classList: toggleClass }];
    els.riegelFiveKSeriesButtons = [{ dataset: { series: "top1" }, classList: toggleClass }];
    els.riegelSummaryGrid = { innerHTML: "" };
    els.riegelEquivalentChartTitle = { textContent: "" };
    els.riegelExpectedPaceChartCaption = { textContent: "old caption" };
    els.riegelExpectedPaceChart = { innerHTML: "" };
    els.riegelFiveKChartCaption = { textContent: "" };
    els.riegelFiveKChart = { innerHTML: "" };
    els.riegelProjectionTable = { innerHTML: "" };
    appState.riegelFiveKScale = "log";
    appState.riegelFiveKSeries = "top1";
    appState.riegelSourceDistanceName = "5K";
    appState.riegelExponentMode = "custom";
    appState.riegelCustomExponent = 1;
    appState.personalBests = {
      distances: [
        { name: "400m", distanceKm: 0.4, top: makeTop(90) },
        { name: "1/2 mile", distanceKm: 0.805, top: makeTop(190) },
        { name: "1K", distanceKm: 1, top: makeTop(245) },
        { name: "1 mile", distanceKm: 1.609, top: makeTop(430) },
        { name: "2 mile", distanceKm: 3.219, top: makeTop(910) },
        { name: "5K", distanceKm: 5, top: makeTop(1500) },
        { name: "10K", distanceKm: 10, top: makeTop(3300) },
        { name: "15K", distanceKm: 15, top: makeTop(5100) },
        { name: "20K", distanceKm: 20, top: makeTop(7200) },
        { name: "30K", distanceKm: 30, top: makeTop(11700) }
      ]
    };

    renderRiegelAnalysis();
    els.riegelExpectedPaceChart.innerHTML;
  `, app);

  const svgHeight = Number(result.match(/viewBox="0 0 980 (\d+)"/)?.[1] || 0);
  const axisLabelY = Number(result.match(/data-riegel-axis-label="pace"[^>]*y="([\d.]+)"/)?.[1] || 0);
  const gapAxisLabelY = Number(result.match(/data-riegel-axis-label="gap"[^>]*y="([\d.]+)"/)?.[1] || 0);
  const legendY = Number(result.match(/data-riegel-legend="expected"[^>]*translate\(\d+, ([\d.]+)\)/)?.[1] || 0);
  const xAxisLabelY = Number(result.match(/data-riegel-axis-label="distance"[^>]*y="([\d.]+)"/)?.[1] || 0);
  const paceTickYs = [...result.matchAll(/<text class="axis-label" x="10" y="([\d.]+)">\d+:\d{2}<\/text>/g)]
    .map((match) => Number(match[1]));
  const gapTickYs = [...result.matchAll(/<text class="axis-label" x="10" y="([\d.]+)">(?:[+-]0:\d{2}|0)<\/text>/g)]
    .map((match) => Number(match[1]));
  const distanceLabelYs = [...result.matchAll(/data-riegel-distance-label="[^"]+"[^>]*y="([\d.]+)"/g)]
    .map((match) => Number(match[1]));

  assert.ok(svgHeight >= 480);
  assert.ok(legendY - axisLabelY >= 24);
  assert.ok(gapAxisLabelY - Math.max(...paceTickYs) >= 24);
  assert.ok(Math.min(...gapTickYs) - gapAxisLabelY >= 24);
  assert.ok(Math.min(...distanceLabelYs) <= xAxisLabelY - 28);
  assert.ok(distanceLabelYs.length <= 6);
});

test("renderRiegelAnalysis shows placeholders for official best-effort distances without efforts", () => {
  const app = loadAppContext();

  const result = vm.runInContext(`
    const toggleClass = { toggle() {} };
    els.riegelCaption = { textContent: "" };
    els.riegelProjectionCaption = { textContent: "" };
    els.riegelExponentInput = { disabled: false, value: "" };
    els.riegelExponentModeButtons = [];
    els.riegelFiveKScaleButtons = [{ dataset: { scale: "linear" }, classList: toggleClass }];
    els.riegelFiveKSeriesButtons = [{ dataset: { series: "top1" }, classList: toggleClass }];
    els.riegelSummaryGrid = { innerHTML: "" };
    els.riegelEquivalentChartTitle = { textContent: "" };
    els.riegelFiveKChartCaption = { textContent: "" };
    els.riegelFiveKChart = { innerHTML: "" };
    els.riegelProjectionTable = { innerHTML: "" };
    appState.riegelFiveKScale = "linear";
    appState.riegelFiveKSeries = "top1";
    appState.riegelSourceDistanceName = "1/2 mile";
    appState.riegelExponentMode = "default";
    appState.personalBests = {
      distances: [
        { name: "1/2 mile", distanceKm: 0.805, top: [{ movingTime: 200, paceSecondsPerKm: 248.4 }] },
        { name: "5K", distanceKm: 5, top: [{ movingTime: 1500, paceSecondsPerKm: 300 }] },
        { name: "10K", distanceKm: 10, top: [{ movingTime: 3150, paceSecondsPerKm: 315 }] }
      ]
    };

    renderRiegelAnalysis();
    ({
      chart: els.riegelFiveKChart.innerHTML
    });
  `, app);

  assert.match(result.chart, /data-riegel-placeholder="true"[\s\S]*No Top 1 Marathon best effort yet/);
  assert.match(result.chart, /data-riegel-placeholder="true"[\s\S]*No Top 1 50K best effort yet/);
  assert.match(result.chart, />50</);
  assert.match(result.chart, /data-riegel-source-name="Marathon"/);
  assert.match(result.chart, /data-riegel-source-name="50K"/);
});

test("renderRiegelAnalysis can use a predicted official distance as the baseline", () => {
  const app = loadAppContext();

  const result = vm.runInContext(`
    const toggleClass = { toggle() {} };
    els.riegelCaption = { textContent: "" };
    els.riegelProjectionCaption = { textContent: "" };
    els.riegelExponentInput = { disabled: false, value: "" };
    els.riegelExponentModeButtons = [];
    els.riegelFiveKScaleButtons = [{ dataset: { scale: "linear" }, classList: toggleClass }];
    els.riegelFiveKSeriesButtons = [{ dataset: { series: "top1" }, classList: toggleClass }];
    els.riegelSummaryGrid = { innerHTML: "" };
    els.riegelEquivalentChartTitle = { textContent: "" };
    els.riegelFiveKChartCaption = { textContent: "" };
    els.riegelFiveKChart = { innerHTML: "" };
    els.riegelProjectionTable = { innerHTML: "" };
    appState.riegelFiveKScale = "linear";
    appState.riegelFiveKSeries = "top1";
    appState.riegelSourceDistanceName = "Marathon";
    appState.riegelExponentMode = "default";
    appState.personalBests = {
      distances: [
        { name: "1/2 mile", distanceKm: 0.805, top: [{ movingTime: 200, paceSecondsPerKm: 248.4 }] },
        { name: "5K", distanceKm: 5, top: [{ movingTime: 1500, paceSecondsPerKm: 300 }] },
        { name: "10K", distanceKm: 10, top: [{ movingTime: 3150, paceSecondsPerKm: 315 }] }
      ]
    };

    renderRiegelAnalysis();
    ({
      caption: els.riegelCaption.textContent,
      projectionCaption: els.riegelProjectionCaption.textContent,
      title: els.riegelEquivalentChartTitle.textContent,
      summary: els.riegelSummaryGrid.innerHTML,
      chart: els.riegelFiveKChart.innerHTML
    });
  `, app);

  assert.equal(result.caption, "");
  assert.equal(result.projectionCaption, "");
  assert.equal(result.title, "Marathon Prediction");
  assert.doesNotMatch(result.summary, /Expected Record/);
  assert.match(result.summary, /Expected Half-Marathon/);
  assert.match(result.summary, /Expected Marathon/);
  assert.doesNotMatch(result.summary, /Predicted from other distances · Top 1 · Marathon/);
  assert.doesNotMatch(result.summary, /Your Record/);
  assert.match(result.chart, /riegel-source-bar placeholder active[\s\S]*data-riegel-source-name="Marathon"/);
});

test("renderRiegelAnalysis projects every available personal-best distance", () => {
  const app = loadAppContext();

  const result = vm.runInContext(`
    const toggleClass = { toggle() {} };
    els.riegelCaption = { textContent: "" };
    els.riegelProjectionCaption = { textContent: "" };
    els.riegelExponentInput = { disabled: false, value: "" };
    els.riegelExponentModeButtons = [];
    els.riegelFiveKScaleButtons = [{ dataset: { scale: "linear" }, classList: toggleClass }];
    els.riegelFiveKSeriesButtons = [{ dataset: { series: "top1" }, classList: toggleClass }];
    els.riegelSummaryGrid = { innerHTML: "" };
    els.riegelEquivalentChartTitle = { textContent: "" };
    els.riegelFiveKChartCaption = { textContent: "" };
    els.riegelFiveKChart = { innerHTML: "" };
    els.riegelProjectionTable = { innerHTML: "" };
    appState.riegelFiveKScale = "linear";
    appState.riegelFiveKSeries = "top1";
    appState.riegelSourceDistanceName = "5K";
    appState.riegelExponentMode = "median";
    appState.personalBests = {
      distances: [
        { name: "400m", distanceKm: 0.4, top: [{ movingTime: 80, paceSecondsPerKm: 200 }] },
        { name: "1 mile", distanceKm: 1.609, top: [{ movingTime: 430, paceSecondsPerKm: 267.2 }] },
        { name: "5K", distanceKm: 5, top: [{ movingTime: 1500, paceSecondsPerKm: 300 }] },
        { name: "10K", distanceKm: 10, top: [{ movingTime: 3150, paceSecondsPerKm: 315 }] }
      ]
    };

    renderRiegelAnalysis();
    els.riegelProjectionTable.innerHTML;
  `, app);

  assert.match(result, />400m</);
  assert.match(result, />1 mile</);
  assert.match(result, />5K</);
  assert.match(result, />10K</);
  assert.ok(result.indexOf(">400m<") < result.indexOf(">1 mile<"));
  assert.ok(result.indexOf(">1 mile<") < result.indexOf(">5K<"));
  assert.ok(result.indexOf(">5K<") < result.indexOf(">10K<"));
});
