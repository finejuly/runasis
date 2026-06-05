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

test("Strava local timestamp strings keep their calendar date", () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";

  try {
    const app = loadAppContext();
    freezeAppDate(app, "2026-06-03T12:00:00");

    const result = vm.runInContext(`
      appState.rangeDays = "7";
      appState.activities = [
        ${JSON.stringify(runActivity("local-day", "2026-06-02T06:00:00Z"))}
      ];

      const activity = appState.activities[0];
      const range = getDashboardDateRange(appState.activities);
      ({
        activityDay: localDateKey(getActivityLocalDay(activity)),
        formattedDate: formatDate(activity.start_date_local),
        rangeEnd: localDateKey(range.end),
        filteredIds: getFilteredActivities().map((item) => item.id)
      });
    `, app);

    assert.deepEqual(JSON.parse(JSON.stringify(result)), {
      activityDay: "2026-06-02",
      formattedDate: "06/02/2026",
      rangeEnd: "2026-06-02",
      filteredIds: ["local-day"]
    });
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
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

test("detailStatusFromStore treats missing raw payloads as pending when raw ids are tracked", () => {
  const server = loadServerContext();
  const store = {
    activities: [
      { id: 1, sport_type: "Run" },
      { id: 2, sport_type: "Run" }
    ],
    detailsById: new Map([
      ["1", { id: 1, best_efforts: [{ id: "effort-1" }] }],
      ["2", { id: 2, best_efforts: [{ id: "effort-2" }] }]
    ]),
    rawDetailIds: new Set(["2"])
  };

  assert.deepEqual(JSON.parse(JSON.stringify(server.detailStatusFromStore(store))), {
    runCount: 2,
    fetchedRunCount: 2,
    failedRunCount: 0,
    pendingRunCount: 1,
    bestEffortActivityCount: 2,
    bestEffortCount: 2,
    rawRunCount: 1,
    pendingRawRunCount: 1
  });
});

test("detailStatusFromStore reports raw stream coverage when stream ids are tracked", () => {
  const server = loadServerContext();
  const store = {
    activities: [
      { id: 1, sport_type: "Run" },
      { id: 2, sport_type: "Run" }
    ],
    detailsById: new Map([
      ["1", { id: 1, best_efforts: [{ id: "effort-1" }] }],
      ["2", { id: 2, best_efforts: [{ id: "effort-2" }] }]
    ]),
    rawDetailIds: new Set(["1", "2"]),
    rawStreamIds: new Set(["2"])
  };

  assert.deepEqual(JSON.parse(JSON.stringify(server.detailStatusFromStore(store))), {
    runCount: 2,
    fetchedRunCount: 2,
    failedRunCount: 0,
    pendingRunCount: 0,
    bestEffortActivityCount: 2,
    bestEffortCount: 2,
    rawRunCount: 2,
    pendingRawRunCount: 0,
    rawStreamRunCount: 1,
    pendingRawStreamRunCount: 1
  });
});

test("Strava activity fetches request all efforts and all stream keys", async () => {
  const server = loadServerContext();

  vm.runInContext(`
    mockFetches = [];
    fetch = async (url, options = {}) => {
      mockFetches.push({ url: String(url), authorization: options.headers?.authorization || "" });
      return {
        ok: true,
        async json() {
          return {};
        }
      };
    };
  `, server);

  await vm.runInContext("fetchDetailedActivity('access-token', 123)", server);
  await vm.runInContext("fetchActivityStreams('access-token', 123)", server);

  const fetches = vm.runInContext("mockFetches", server);
  assert.match(fetches[0].url, /\/activities\/123\?include_all_efforts=true$/);
  assert.equal(fetches[0].authorization, "Bearer access-token");
  assert.match(fetches[1].url, /\/activities\/123\/streams\?/);
  assert.match(fetches[1].url, /key_by_type=true/);
  assert.match(decodeURIComponent(fetches[1].url), /keys=time,distance,latlng,altitude,velocity_smooth,heartrate,cadence,watts,temp,moving,grade_smooth/);
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

test("syncActivityDetails stores raw detailed activity before sanitized detail", async () => {
  const server = loadServerContext();

  vm.runInContext(`
    mockStore = {
      activities: [{
        id: 123,
        name: "Morning Run",
        sport_type: "Run",
        distance: 5000,
        start_date: "2026-05-01T00:00:00Z"
      }],
      detailsById: new Map(),
      rawStreamIds: new Set()
    };
    mockWrites = [];
    readStore = async () => mockStore;
    ensureAccessToken = async (store) => ({ store, accessToken: "access-token" });
    fetchDetailedActivity = async () => ({
      id: 123,
      name: "Morning Run",
      sport_type: "Run",
      distance: 5000,
      start_date: "2026-05-01T00:00:00Z",
      start_latlng: [37, -122],
      map: { summary_polyline: "encoded" },
      segment_efforts: [{ id: 10 }],
      splits_metric: [{ distance: 1000 }],
      best_efforts: [{
        id: 99,
        name: "5K",
        distance: 5000,
        moving_time: 1500,
        hidden_location: "keep me raw"
      }]
    });
    writeRawActivityDetail = async (id, detail) => {
      mockWrites.push({ kind: "raw", id, detail });
    };
    writeActivityDetail = async (id, detail) => {
      mockWrites.push({ kind: "sanitized", id, detail });
    };
    fetchActivityStreams = async () => ({
      time: { data: [0, 1], series_type: "time", original_size: 2, resolution: "high" },
      distance: { data: [0, 5], series_type: "distance", original_size: 2, resolution: "high" }
    });
    writeRawActivityStream = async (id, streams) => {
      mockWrites.push({ kind: "raw-stream", id, streams });
    };
    writeStore = async (store) => {
      mockWrittenStore = store;
      return store;
    };
  `, server);

  await vm.runInContext("syncActivityDetails({ limit: 1 })", server);

  const result = vm.runInContext(`({
    writes: mockWrites,
    summary: mockWrittenStore.lastDetailSyncSummary
  })`, server);
  const writes = JSON.parse(JSON.stringify(result.writes));

  assert.deepEqual(writes.map((write) => ({ kind: write.kind, id: write.id })), [
    { kind: "raw", id: 123 },
    { kind: "sanitized", id: 123 },
    { kind: "raw-stream", id: 123 }
  ]);
  assert.equal(writes[0].detail.map.summary_polyline, "encoded");
  assert.equal(writes[0].detail.best_efforts[0].hidden_location, "keep me raw");
  assert.equal(writes[1].detail.map, undefined);
  assert.equal(writes[1].detail.best_efforts[0].hidden_location, undefined);
  assert.deepEqual(writes[2].streams.time.data, [0, 1]);
  assert.equal(result.summary.fetched, 1);
  assert.equal(result.summary.rawStreamsFetched, 1);
});

test("syncActivityDetails backfills raw payloads for already sanitized details", async () => {
  const server = loadServerContext();

  vm.runInContext(`
    mockStore = {
      activities: [{
        id: 123,
        name: "Morning Run",
        sport_type: "Run",
        distance: 5000,
        start_date: "2026-05-01T00:00:00Z"
      }],
      detailsById: new Map([["123", {
        id: 123,
        name: "Morning Run",
        sport_type: "Run",
        best_efforts: [{ id: 99, name: "5K", distance: 5000, moving_time: 1500 }]
      }]]),
      rawDetailIds: new Set(),
      rawStreamIds: new Set()
    };
    mockWrites = [];
    readStore = async () => mockStore;
    ensureAccessToken = async (store) => ({ store, accessToken: "access-token" });
    fetchDetailedActivity = async () => ({
      id: 123,
      name: "Morning Run",
      sport_type: "Run",
      distance: 5000,
      start_date: "2026-05-01T00:00:00Z",
      map: { summary_polyline: "encoded" },
      best_efforts: [{ id: 99, name: "5K", distance: 5000, moving_time: 1500 }]
    });
    writeRawActivityDetail = async (id, detail) => {
      mockWrites.push({ kind: "raw", id, detail });
    };
    writeActivityDetail = async (id, detail) => {
      mockWrites.push({ kind: "sanitized", id, detail });
    };
    fetchActivityStreams = async () => ({
      time: { data: [0, 1], series_type: "time", original_size: 2, resolution: "high" }
    });
    writeRawActivityStream = async (id, streams) => {
      mockWrites.push({ kind: "raw-stream", id, streams });
    };
    writeStore = async (store) => {
      mockWrittenStore = store;
      return store;
    };
  `, server);

  await vm.runInContext("syncActivityDetails({ limit: 1 })", server);

  const result = vm.runInContext(`({
    writes: mockWrites,
    rawIds: Array.from(mockWrittenStore.rawDetailIds),
    rawStreamIds: Array.from(mockWrittenStore.rawStreamIds),
    summary: mockWrittenStore.lastDetailSyncSummary
  })`, server);
  const writes = JSON.parse(JSON.stringify(result.writes));

  assert.deepEqual(writes.map((write) => write.kind), ["raw", "sanitized", "raw-stream"]);
  assert.equal(writes[0].detail.map.summary_polyline, "encoded");
  assert.deepEqual(JSON.parse(JSON.stringify(result.rawIds)), ["123"]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.rawStreamIds)), ["123"]);
  assert.equal(result.summary.fetched, 0);
  assert.equal(result.summary.rawBackfilled, 1);
  assert.equal(result.summary.rawStreamsFetched, 1);
  assert.equal(result.summary.remaining, 0);
});

test("syncActivityDetails backfills streams without refetching existing raw details", async () => {
  const server = loadServerContext();

  vm.runInContext(`
    mockStore = {
      activities: [{
        id: 123,
        name: "Morning Run",
        sport_type: "Run",
        distance: 5000,
        start_date: "2026-05-01T00:00:00Z"
      }],
      detailsById: new Map([["123", {
        id: 123,
        name: "Morning Run",
        sport_type: "Run",
        best_efforts: [{ id: 99, name: "5K", distance: 5000, moving_time: 1500 }]
      }]]),
      rawDetailIds: new Set(["123"]),
      rawStreamIds: new Set()
    };
    mockWrites = [];
    mockDetailFetches = 0;
    readStore = async () => mockStore;
    ensureAccessToken = async (store) => ({ store, accessToken: "access-token" });
    fetchDetailedActivity = async () => {
      mockDetailFetches += 1;
      throw new Error("detail should not be refetched");
    };
    fetchActivityStreams = async () => ({
      time: { data: [0, 1], series_type: "time", original_size: 2, resolution: "high" }
    });
    writeRawActivityStream = async (id, streams) => {
      mockWrites.push({ kind: "raw-stream", id, streams });
    };
    writeStore = async (store) => {
      mockWrittenStore = store;
      return store;
    };
  `, server);

  await vm.runInContext("syncActivityDetails({ limit: 1 })", server);

  const result = vm.runInContext(`({
    writes: mockWrites,
    detailFetches: mockDetailFetches,
    rawStreamIds: Array.from(mockWrittenStore.rawStreamIds),
    summary: mockWrittenStore.lastDetailSyncSummary
  })`, server);

  assert.equal(result.detailFetches, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(result.writes.map((write) => write.kind))), ["raw-stream"]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.rawStreamIds)), ["123"]);
  assert.equal(result.summary.fetched, 0);
  assert.equal(result.summary.rawBackfilled, 0);
  assert.equal(result.summary.rawStreamsFetched, 1);
  assert.equal(result.summary.remaining, 0);
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
    mockWrittenRawStream = undefined;
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
    fetchActivityStreams = async (accessToken, id) => {
      mockFetchCalls.push({ accessToken, id, kind: "streams" });
      return {
        time: { data: [0, 1], series_type: "time", original_size: 2, resolution: "high" }
      };
    };
    writeRawActivityDetail = async (id, detail) => { mockWrittenRawDetail = { id, detail }; };
    writeRawActivityStream = async (id, streams) => { mockWrittenRawStream = { id, streams }; };
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
    writtenRawDetail: mockWrittenRawDetail,
    writtenRawStream: mockWrittenRawStream,
    writtenDetail: mockWrittenDetail,
    writtenActivities: mockWrittenStore.activities,
    rawStreamIds: Array.from(mockWrittenStore.rawStreamIds)
  })`, server);

  assert.equal(body.summary.refreshed, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(result.fetchCalls)), [
    { accessToken: "access-token", id: "123" },
    { accessToken: "access-token", id: "123", kind: "streams" }
  ]);
  assert.equal(result.writtenRawDetail.id, "123");
  assert.equal(result.writtenRawDetail.detail.best_efforts[0].id, "new-effort");
  assert.equal(result.writtenRawStream.id, "123");
  assert.deepEqual(JSON.parse(JSON.stringify(result.writtenRawStream.streams.time.data)), [0, 1]);
  assert.equal(result.writtenDetail.id, "123");
  assert.equal(result.writtenDetail.detail.name, "Fixed Run");
  assert.equal(result.writtenDetail.detail.best_efforts[0].id, "new-effort");
  assert.equal(result.writtenActivities[0].name, "Fixed Run");
  assert.equal(result.writtenActivities[0].moving_time, 1490);
  assert.deepEqual(JSON.parse(JSON.stringify(result.rawStreamIds)), ["123"]);
});

test("activity detail refresh marks streams pending when stream refresh fails", async () => {
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
        details_fetched_at: "2026-05-01T00:00:00.000Z"
      }]]),
      rawDetailIds: new Set(["123"]),
      rawStreamIds: new Set(["123"])
    };
    mockFetchCalls = [];
    mockWrittenRawStream = undefined;
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
    fetchActivityStreams = async (accessToken, id) => {
      mockFetchCalls.push({ accessToken, id, kind: "streams" });
      const error = new Error("temporary stream outage");
      error.statusCode = 503;
      throw error;
    };
    writeRawActivityDetail = async (id, detail) => { mockWrittenRawDetail = { id, detail }; };
    writeRawActivityStream = async (id, streams) => { mockWrittenRawStream = { id, streams }; };
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
    writtenRawDetail: mockWrittenRawDetail,
    writtenRawStream: mockWrittenRawStream,
    writtenDetail: mockWrittenDetail,
    rawStreamIds: Array.from(mockWrittenStore.rawStreamIds)
  })`, server);

  assert.equal(body.summary.refreshed, 1);
  assert.equal(body.summary.streamFailed, 1);
  assert.equal(body.summary.streamPending, true);
  assert.match(body.summary.streamErrors[0].message, /temporary stream outage/);
  assert.deepEqual(JSON.parse(JSON.stringify(result.fetchCalls)), [
    { accessToken: "access-token", id: "123" },
    { accessToken: "access-token", id: "123", kind: "streams" }
  ]);
  assert.equal(result.writtenRawDetail.id, "123");
  assert.equal(result.writtenRawDetail.detail.best_efforts[0].id, "new-effort");
  assert.equal(result.writtenRawStream, undefined);
  assert.equal(result.writtenDetail.detail.name, "Fixed Run");
  assert.deepEqual(JSON.parse(JSON.stringify(result.rawStreamIds)), []);
});

test("personalBestsFromStore computes fixed-time distance bests from streams", async () => {
  const server = loadServerContext();

  vm.runInContext(`
    mockWrittenPersonalBests = null;
    readJson = async (file, fallback) => {
      const text = String(file);
      if (text.endsWith("/raw-streams/1.json")) {
        return {
          time: { data: [0, 900, 2700, 3600] },
          distance: { data: [0, 3000, 9000, 10000] }
        };
      }
      if (text.endsWith("/raw-streams/2.json")) {
        return {
          time: { data: [0, 1800, 3600] },
          distance: { data: [0, 6500, 12000] }
        };
      }
      if (text.endsWith("/raw-streams/3.json")) {
        return {
          time: { data: [0, 120, 300, 600, 1800, 3600, 5400, 7200, 10800, 14400] },
          distance: { data: [0, 700, 1600, 3200, 10000, 19000, 27000, 35000, 50000, 62000] }
        };
      }
      return fallback;
    };
    writeJsonAtomic = async (file, payload) => {
      mockWrittenPersonalBests = payload;
    };
  `, server);

  const { result, sourceFingerprint } = await vm.runInContext(`
    (async () => {
      const store = {
        activities: [
          { id: 1, name: "Progression", sport_type: "Run", start_date: "2026-05-01T12:00:00Z" },
          { id: 2, name: "Tempo", sport_type: "Run", start_date: "2026-05-02T12:00:00Z" },
          { id: 3, name: "Long Run", sport_type: "Run", start_date: "2026-05-03T12:00:00Z" }
        ],
        detailsById: new Map(),
        rawStreamIds: new Set(["1", "2", "3"])
      };
      return {
        result: await personalBestsFromStore(store),
        sourceFingerprint: buildPersonalBestsCacheFingerprint(store)
      };
    })()
  `, server);

  const durations = Object.fromEntries(result.durations.map((duration) => [duration.name, duration]));
  assert.equal(result.durationActivityCount, 3);
  assert.equal(result.durationEffortCount, 33);
  assert.equal(durations["2m"], undefined);
  assert.equal(durations["15s"].top[0].activityId, 3);
  assert.equal(Math.round(durations["15s"].top[0].distance), 88);
  assert.equal(durations["30s"].top[0].activityId, 3);
  assert.equal(Math.round(durations["30s"].top[0].distance), 175);
  assert.equal(durations["1m"].top[0].activityId, 3);
  assert.equal(Math.round(durations["1m"].top[0].distance), 350);
  assert.equal(durations["3m"].top[0].activityId, 3);
  assert.equal(Math.round(durations["3m"].top[0].distance), 1020);
  assert.equal(durations["5m"].top[0].activityId, 3);
  assert.equal(Math.round(durations["5m"].top[0].distance), 1700);
  assert.equal(durations["10m"].top[0].activityId, 3);
  assert.equal(Math.round(durations["10m"].top[0].distance), 3400);
  assert.equal(durations["20m"].top[0].activityId, 3);
  assert.equal(Math.round(durations["20m"].top[0].distance), 6800);
  assert.equal(durations["30m"].top[0].activityId, 3);
  assert.equal(Math.round(durations["30m"].top[0].distance), 10000);
  assert.equal(durations["1h"].top[0].activityId, 3);
  assert.equal(Math.round(durations["1h"].top[0].distance), 19000);
  assert.equal(durations["1.5h"].top[0].activityId, 3);
  assert.equal(Math.round(durations["1.5h"].top[0].distance), 27000);
  assert.equal(durations["2h"].top[0].activityId, 3);
  assert.equal(Math.round(durations["2h"].top[0].distance), 35000);
  assert.equal(durations["2.5h"].top[0].activityId, 3);
  assert.equal(Math.round(durations["2.5h"].top[0].distance), 42500);
  assert.equal(durations["3h"].top[0].activityId, 3);
  assert.equal(Math.round(durations["3h"].top[0].distance), 50000);
  assert.equal(durations["3.5h"].top[0].activityId, 3);
  assert.equal(Math.round(durations["3.5h"].top[0].distance), 56000);
  assert.equal(durations["4h"].top[0].activityId, 3);
  assert.equal(Math.round(durations["4h"].top[0].distance), 62000);
  assert.equal(vm.runInContext("mockWrittenPersonalBests.durationCount", server), 15);
  assert.equal(vm.runInContext("mockWrittenPersonalBests.cache.sourceFingerprint", server), sourceFingerprint);
});

test("best effort target lists match configured distance, time, and pace records", () => {
  const server = loadServerContext();

  const result = vm.runInContext(`
    ({
      distances: PERSONAL_BEST_DISTANCE_TARGETS.map((target) => target.name),
      durations: TIME_BEST_TARGETS.map((target) => target.name),
      paces: PACE_BEST_TARGETS.map((target) => target.name)
    })
  `, server);

  assert.deepEqual(JSON.parse(JSON.stringify(result.distances)), [
    "100m",
    "200m",
    "400m",
    "1/2 mile",
    "1K",
    "1 mile",
    "2K",
    "5K",
    "5 mile",
    "10K",
    "15K",
    "10 mile",
    "20K",
    "Half-Marathon",
    "25K",
    "30K",
    "35K",
    "Marathon"
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.durations)), [
    "15s",
    "30s",
    "1m",
    "3m",
    "5m",
    "10m",
    "20m",
    "30m",
    "1h",
    "1.5h",
    "2h",
    "2.5h",
    "3h",
    "3.5h",
    "4h"
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.paces)), [
    "3:30/km",
    "3:45/km",
    "4:00/km",
    "4:15/km",
    "4:30/km",
    "4:45/km",
    "5:00/km",
    "5:13/km",
    "5:27/km",
    "5:40/km",
    "5:50/km",
    "6:00/km",
    "6:20/km",
    "6:40/km",
    "7:00/km"
  ]);
});

test("personalBestsFromStore computes standard distance bests from streams", async () => {
  const server = loadServerContext();

  vm.runInContext(`
    mockWrittenPersonalBests = null;
    readJson = async (file, fallback) => {
      const text = String(file);
      if (text.endsWith("/raw-streams/1.json")) {
        return {
          time: { data: [0, 1000, 2000, 3000] },
          distance: { data: [0, 5000, 10000, 15000] }
        };
      }
      if (text.endsWith("/raw-streams/2.json")) {
        return {
          time: { data: [0, 900, 1800, 2700] },
          distance: { data: [0, 5000, 10000, 15000] }
        };
      }
      return fallback;
    };
    writeJsonAtomic = async (file, payload) => {
      mockWrittenPersonalBests = payload;
    };
  `, server);

  const result = await vm.runInContext(`
    personalBestsFromStore({
      activities: [
        { id: 1, name: "Older Stream", sport_type: "Run", start_date: "2026-05-01T12:00:00Z" },
        { id: 2, name: "Faster Stream", sport_type: "Run", start_date: "2026-05-02T12:00:00Z" }
      ],
      detailsById: new Map([
        ["1", {
          id: 1,
          name: "Older Detail",
          sport_type: "Run",
          start_date: "2026-05-01T12:00:00Z",
          best_efforts: [{ id: "slow-1", name: "5K", distance: 5000, moving_time: 1500 }]
        }],
        ["2", {
          id: 2,
          name: "Faster Detail",
          sport_type: "Run",
          start_date: "2026-05-02T12:00:00Z",
          best_efforts: [{ id: "slow-2", name: "5K", distance: 5000, moving_time: 1500 }]
        }]
      ]),
      rawStreamIds: new Set(["1", "2"])
    })
  `, server);

  const distances = Object.fromEntries(result.distances.map((distance) => [distance.name, distance]));

  assert.equal(result.detailActivityCount, 2);
  assert.equal(result.distanceCount, 11);
  assert.deepEqual(JSON.parse(JSON.stringify(result.distances.map((distance) => distance.name))), [
    "100m",
    "200m",
    "400m",
    "1/2 mile",
    "1K",
    "1 mile",
    "2K",
    "5K",
    "5 mile",
    "10K",
    "15K"
  ]);
  assert.equal(result.effortCount, 22);
  assert.equal(Math.round(distances["100m"].top[0].movingTime), 18);
  assert.equal(Math.round(distances["200m"].top[0].movingTime), 36);
  assert.equal(distances["1K"].top[0].activityId, 2);
  assert.equal(Math.round(distances["1K"].top[0].movingTime), 180);
  assert.equal(Math.round(distances["2K"].top[0].movingTime), 360);
  assert.equal(distances["5K"].top[0].activityId, 2);
  assert.equal(Math.round(distances["5K"].top[0].movingTime), 900);
  assert.equal(distances["5K"].top[0].effortId, null);
  assert.equal(Math.round(distances["5 mile"].top[0].movingTime), 1448);
  assert.equal(distances["10K"].top[0].activityId, 2);
  assert.equal(Math.round(distances["10K"].top[0].movingTime), 1800);
  assert.equal(distances["15K"].top[0].activityId, 2);
  assert.equal(Math.round(distances["15K"].top[0].movingTime), 2700);
  assert.equal(vm.runInContext("mockWrittenPersonalBests.distanceCount", server), 11);
});

test("personalBestsFromStore computes fixed-pace distance bests from streams", async () => {
  const server = loadServerContext();

  vm.runInContext(`
    mockWrittenPersonalBests = null;
    readJson = async (file, fallback) => {
      const text = String(file);
      if (text.endsWith("/raw-streams/1.json")) {
        return {
          time: { data: [0, 1800, 3600, 5100] },
          distance: { data: [0, 6000, 6000, 13000] }
        };
      }
      if (text.endsWith("/raw-streams/2.json")) {
        return {
          time: { data: [0, 1200] },
          distance: { data: [0, 4000] }
        };
      }
      return fallback;
    };
    writeJsonAtomic = async (file, payload) => {
      mockWrittenPersonalBests = payload;
    };
  `, server);

  const result = await vm.runInContext(`
    personalBestsFromStore({
      activities: [
        { id: 1, name: "Steady Run", sport_type: "Run", start_date: "2026-05-01T12:00:00Z" },
        { id: 2, name: "Fast Run", sport_type: "Run", start_date: "2026-05-02T12:00:00Z" }
      ],
      detailsById: new Map(),
      rawStreamIds: new Set(["1", "2"])
    })
  `, server);

  const paces = Object.fromEntries(result.paces.map((pace) => [pace.name, pace]));

  assert.deepEqual(JSON.parse(JSON.stringify(result.paces.map((pace) => pace.name))), [
    "3:45/km",
    "4:00/km",
    "4:15/km",
    "4:30/km",
    "4:45/km",
    "5:00/km",
    "5:13/km",
    "5:27/km",
    "5:40/km",
    "5:50/km",
    "6:00/km",
    "6:20/km",
    "6:40/km",
    "7:00/km"
  ]);
  assert.equal(result.paceCount, 14);
  assert.equal(result.paceEffortCount, 23);
  assert.equal(paces["5:00/km"].paceSecondsPerKm, 300);
  assert.equal(paces["5:00/km"].top[0].activityId, 1);
  assert.equal(Math.round(paces["5:00/km"].top[0].durationSeconds), 1500);
  assert.equal(Math.round(paces["5:00/km"].top[0].distance), 7000);
  assert.equal(paces["5:00/km"].top[0].recordKey, "pace|5:00/km|1|3600|5100");
  assert.equal(paces["6:00/km"].top[0].activityId, 1);
  assert.equal(Math.round(paces["6:00/km"].top[0].durationSeconds), 1500);
  assert.equal(Math.round(paces["6:00/km"].top[0].distance), 7000);
  assert.equal(paces["6:40/km"].top[0].activityId, 1);
  assert.equal(Math.round(paces["6:40/km"].top[0].durationSeconds), 5100);
  assert.equal(Math.round(paces["6:40/km"].top[0].distance), 13000);
  assert.equal(vm.runInContext("mockWrittenPersonalBests.paceCount", server), 14);
  assert.equal(vm.runInContext("mockWrittenPersonalBests.paces[0].top.length", server), 1);
});

test("personalBestsFromStore caches every computed record for lower ranks", async () => {
  const server = loadServerContext();

  vm.runInContext(`
    mockWrittenPersonalBests = null;
    readJson = async (file, fallback) => {
      const text = String(file);
      if (text.includes("/raw-streams/")) {
        return {
          time: { data: [0, 300, 1000] },
          distance: { data: [0, 1500, 5000] }
        };
      }
      return fallback;
    };
    writeJsonAtomic = async (file, payload) => {
      mockWrittenPersonalBests = payload;
    };
    const activities = Array.from({ length: 25 }, (_, index) => ({
      id: index + 1,
      name: "Run " + (index + 1),
      sport_type: "Run",
      start_date: new Date(Date.UTC(2026, 4, index + 1)).toISOString()
    }));
    mockStore = {
      activities,
      detailsById: new Map(activities.map((activity) => [String(activity.id), {
        ...activity,
        best_efforts: [{ id: "strava-" + activity.id, name: "5K", distance: 5000, moving_time: 9999 }]
      }])),
      rawStreamIds: new Set(activities.map((activity) => String(activity.id)))
    };
  `, server);

  await vm.runInContext("personalBestsFromStore(mockStore)", server);
  const cached = vm.runInContext("mockWrittenPersonalBests", server);
  const cached5k = cached.distances.find((distance) => distance.name === "5K");
  const cached5min = cached.durations.find((duration) => duration.name === "5m");
  const cachedFivePace = cached.paces.find((pace) => pace.name === "5:00/km");

  assert.equal(cached5k.count, 25);
  assert.equal(cached5k.top.length, 25);
  assert.equal(cached5k.top.every((effort) => effort.effortId === null), true);
  assert.equal(cached5min.count, 25);
  assert.equal(cached5min.top.length, 25);
  assert.equal(cachedFivePace.count, 25);
  assert.equal(cachedFivePace.top.length, 25);
});

test("personalBestsFromStore hides excluded distance, duration, and pace records by default", async () => {
  const server = loadServerContext();

  vm.runInContext(`
    readJson = async (file, fallback) => {
      const text = String(file);
      if (text.endsWith("/derived/excluded-records.json")) {
        return {
          version: 1,
          records: {
            "distance|5K|1|0|750": { excludedAt: "2026-06-01T00:00:00.000Z" },
            "duration|5m|1|0|300": { excludedAt: "2026-06-01T00:00:00.000Z" },
            "pace|5:00/km|1|0|900": { excludedAt: "2026-06-01T00:00:00.000Z" }
          }
        };
      }
      if (text.endsWith("/raw-streams/1.json")) {
        return {
          time: { data: [0, 300, 600, 900] },
          distance: { data: [0, 2000, 4000, 6000] }
        };
      }
      return fallback;
    };
    writeJsonAtomic = async () => {};
    mockStore = {
      activities: [
        { id: 1, name: "Excluded Source", sport_type: "Run", start_date: "2026-05-01T12:00:00Z" }
      ],
      detailsById: new Map(),
      rawStreamIds: new Set(["1"])
    };
  `, server);

  const defaultResult = await vm.runInContext("personalBestsFromStore(mockStore)", server);
  const includeResult = await vm.runInContext("personalBestsFromStore(mockStore, { includeExcluded: true })", server);

  assert.equal(defaultResult.distances.some((distance) => distance.name === "5K"), false);
  assert.equal(defaultResult.durations.some((duration) => duration.name === "5m"), false);
  assert.equal(defaultResult.paces.some((pace) => pace.name === "5:00/km"), false);

  const included5k = includeResult.distances.find((distance) => distance.name === "5K");
  const included5min = includeResult.durations.find((duration) => duration.name === "5m");
  const includedFivePace = includeResult.paces.find((pace) => pace.name === "5:00/km");
  assert.equal(included5k.top[0].recordKey, "distance|5K|1|0|750");
  assert.equal(included5k.top[0].excluded, true);
  assert.equal(included5min.top[0].recordKey, "duration|5m|1|0|300");
  assert.equal(included5min.top[0].excluded, true);
  assert.equal(includedFivePace.top[0].recordKey, "pace|5:00/km|1|0|900");
  assert.equal(includedFivePace.top[0].excluded, true);
  assert.equal(includeResult.includeExcluded, true);
  assert.equal(includeResult.excludedRecordCount, 3);
});

test("excluded record API stores and removes record keys", async () => {
  const server = loadServerContext();

  vm.runInContext(`
    mockSavedPayloads = [];
    readJson = async (file, fallback) => {
      const text = String(file);
      if (text.endsWith("/derived/excluded-records.json")) {
        return {
          version: 1,
          records: {
            "distance|5K|1|0|750": { excludedAt: "2026-06-01T00:00:00.000Z" }
          }
        };
      }
      return fallback;
    };
    writeJsonAtomic = async (file, payload) => {
      mockSavedPayloads.push({ file: String(file), payload });
    };
  `, server);

  const addResponse = await callApi(server, "/api/excluded-records", "POST", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recordKey: "duration|5 min|2|0|300", excluded: true })
  });
  const removeResponse = await callApi(server, "/api/excluded-records", "POST", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recordKey: "distance|5K|1|0|750", excluded: false })
  });

  const savedPayloads = vm.runInContext("mockSavedPayloads", server);
  assert.equal(addResponse.statusCode, 200);
  assert.equal(removeResponse.statusCode, 200);
  assert.equal(JSON.parse(addResponse.body).excluded, true);
  assert.equal(JSON.parse(removeResponse.body).excluded, false);
  assert.equal(savedPayloads[0].payload.records["duration|5 min|2|0|300"].recordKey, "duration|5 min|2|0|300");
  assert.equal(savedPayloads[1].payload.records["distance|5K|1|0|750"], undefined);
});

test("personalBestsFromStore reuses a fresh derived cache without rereading streams", async () => {
  const server = loadServerContext();

  vm.runInContext(`
    mockStore = {
      activities: [{ id: 1, name: "Cached Run", sport_type: "Run", start_date: "2026-05-01T12:00:00Z" }],
      detailsById: new Map(),
      rawStreamIds: new Set(["1"]),
      updatedAt: "2026-06-01T00:00:00.000Z",
      lastSyncAt: "2026-06-01T00:00:00.000Z",
      lastDetailSyncAt: "2026-06-01T00:00:00.000Z"
    };
    mockReadPaths = [];
    mockWriteCount = 0;
    mockCachedPersonalBests = {
      generatedAt: "2026-06-01T01:00:00.000Z",
      cache: {
        version: PERSONAL_BESTS_CACHE_VERSION,
        sourceFingerprint: buildPersonalBestsCacheFingerprint(mockStore)
      },
      detailActivityCount: 0,
      effortCount: 0,
      distanceCount: 1,
      distances: [{
        name: "Cached",
        count: 1,
        top: [{
          recordKey: "distance|Cached|1|0|1",
          recordType: "distance",
          activityId: 1,
          name: "Cached",
          distance: 1000,
          distanceKm: 1,
          movingTime: 300,
          elapsedTime: 300,
          paceSecondsPerKm: 300
        }]
      }],
      durationActivityCount: 0,
      durationEffortCount: 0,
      durationCount: 0,
      durations: [],
      paceActivityCount: 0,
      paceEffortCount: 0,
      paceCount: 0,
      paces: []
    };
    readJson = async (file, fallback) => {
      const text = String(file);
      mockReadPaths.push(text);
      if (text.endsWith("/derived/personal-bests.json")) return mockCachedPersonalBests;
      if (text.includes("/raw-streams/")) throw new Error("raw streams should not be read for a fresh cache");
      return fallback;
    };
    writeJsonAtomic = async () => {
      mockWriteCount += 1;
    };
  `, server);

  const result = await vm.runInContext("personalBestsFromStore(mockStore)", server);
  const checks = vm.runInContext(`({
    readPaths: mockReadPaths,
    writeCount: mockWriteCount
  })`, server);

  assert.equal(result.generatedAt, "2026-06-01T01:00:00.000Z");
  assert.equal(result.distances[0].name, "Cached");
  assert.equal(checks.writeCount, 0);
  assert.equal(checks.readPaths.filter((file) => file.includes("/raw-streams/")).length, 0);
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

test("excluded record rows use a distinct text color", () => {
  const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");

  assert.match(css, /\.record-row-excluded td\s*{[^}]*color:\s*var\(--red\);/);
  assert.match(css, /\.record-row-excluded td\.activity-name\s*{[^}]*color:\s*var\(--red\);/);
  assert.doesNotMatch(css, /\.record-row-excluded td\s*{[^}]*color:\s*var\(--muted\);/);
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

test("syncActivities fetches raw details when raw backfill is pending", async () => {
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
        activityDetails: { pendingRunCount: 0, pendingRawRunCount: 0 }
      };
      fetchJson = async (url, options = {}) => {
        calls.push({ url, method: options.method || "GET" });
        if (url === "/api/sync") {
          return {
            summary: { inserted: 0, updated: 1 },
            status: { activityDetails: { pendingRunCount: 0, pendingRawRunCount: 2 } }
          };
        }
        if (url === "/api/activity-details/sync") {
          return {
            summary: {
              fetched: 0,
              rawBackfilled: 2,
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
        toastMessage: calls.at(-1).message
      };
    })()
  `, app);

  assert.equal(result.callUrls, "/api/sync|/api/activity-details/sync|loadData|toast");
  assert.equal(result.detailMethod, "POST");
  assert.match(result.toastMessage, /Raw details: 2 saved/);
});

test("syncActivities fetches streams when stream backfill is pending", async () => {
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
        activityDetails: { pendingRunCount: 0, pendingRawRunCount: 0, pendingRawStreamRunCount: 0 }
      };
      fetchJson = async (url, options = {}) => {
        calls.push({ url, method: options.method || "GET" });
        if (url === "/api/sync") {
          return {
            summary: { inserted: 0, updated: 1 },
            status: { activityDetails: { pendingRunCount: 0, pendingRawRunCount: 0, pendingRawStreamRunCount: 2 } }
          };
        }
        if (url === "/api/activity-details/sync") {
          return {
            summary: {
              fetched: 0,
              rawBackfilled: 0,
              rawStreamsFetched: 2,
              failed: 0,
              streamFailed: 0,
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
        toastMessage: calls.at(-1).message
      };
    })()
  `, app);

  assert.equal(result.callUrls, "/api/sync|/api/activity-details/sync|loadData|toast");
  assert.equal(result.detailMethod, "POST");
  assert.match(result.toastMessage, /Streams: 2 saved/);
});

test("refreshActivityDetail warns when stream refresh remains pending", async () => {
  const app = loadAppContext();

  const result = await vm.runInContext(`
    (async () => {
      const calls = [];
      const button = () => ({ disabled: false, textContent: "" });
      els.connectButton = button();
      els.syncButton = button();
      els.clearButton = button();
      els.stravaConfigSaveButton = button();
      els.excludedRecordsToggleButtons = [];
      appState.status = { connected: true };
      fetchJson = async (url, options = {}) => {
        calls.push({ url, method: options.method || "GET", body: options.body || "" });
        if (url === "/api/activity-details/refresh") {
          return {
            summary: {
              refreshed: 1,
              rawStreamsFetched: 0,
              streamFailed: 1,
              streamPending: true
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

      await refreshActivityDetail("123");
      return {
        calls,
        refreshingActivityId: appState.refreshingActivityId
      };
    })()
  `, app);

  assert.equal(result.refreshingActivityId, null);
  assert.equal(result.calls[0].url, "/api/activity-details/refresh");
  assert.match(result.calls.find((call) => call.url === "toast").message, /Stream refresh failed/);
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

test("renderPersonalBests adds exclusion buttons for source records", () => {
  const app = loadAppContext();

  const result = vm.runInContext(`
    els.personalBestGrid = { innerHTML: "" };
    appState.expandedPersonalBestDistances = new Set();
    appState.excludingRecordKey = null;
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
          recordKey: "distance|5K|123|0|1490",
          movingTime: 1490,
          paceSecondsPerKm: 298
        }]
      }]
    };

    renderPersonalBests();
    els.personalBestGrid.innerHTML;
  `, app);

  assert.match(result, /data-record-exclusion-key="distance\|5K\|123\|0\|1490"/);
  assert.match(result, /data-record-exclusion-excluded="true"/);
  assert.match(result, /aria-label="Exclude Fixed Run"/);
  assert.match(result, /class="record-exclusion-icon"/);
  assert.doesNotMatch(result, />Exclude</);
  assert.match(result, /<th[^>]*>#<\/th>\s*<th[^>]*>Date<\/th>\s*<th[^>]*>Best Time<\/th>\s*<th[^>]*>Pace<\/th>\s*<th[^>]*>Activity<\/th>\s*<th[^>]*>Actions<\/th>/);
  assert.match(result, /<td>1<\/td>\s*<td>05\/01\/2026<\/td>\s*<td>24:50<\/td>\s*<td>4:58\/km<\/td>\s*<td class="activity-name">Fixed Run<\/td>\s*<td class="record-actions">[\s\S]*?<\/td>/);
  assert.doesNotMatch(result, /data-refresh-activity-id="123"/);
});

test("renderTimeBestsView renders fixed-time distance records from streams", () => {
  const app = loadAppContext();

  const result = vm.runInContext(`
    els.personalBestDurationGrid = { innerHTML: "" };
    els.personalBestDurationCaption = { textContent: "" };
    appState.expandedTimeBestDurations = new Set();
    appState.excludingRecordKey = null;
    const timeEfforts = Array.from({ length: 4 }, (_, index) => ({
      activityId: 456 + index,
      activityName: "Tempo " + (index + 1),
      startDate: "2026-05-02T12:00:00Z",
      recordKey: "duration|30 min|" + (456 + index) + "|900|2700",
      distanceKm: 6.5 - index * 0.1,
      paceSecondsPerKm: 1800 / (6.5 - index * 0.1),
      startOffset: 900
    }));
    appState.personalBests = {
      detailActivityCount: 0,
      effortCount: 0,
      durationActivityCount: 1,
      durationEffortCount: 4,
      distances: [],
      durations: [{
        name: "30 min",
        durationSeconds: 1800,
        count: 4,
        top: timeEfforts
      }]
    };

    renderTimeBestsView();
    ({
      caption: els.personalBestDurationCaption.textContent,
      durationGrid: els.personalBestDurationGrid.innerHTML
    });
  `, app);

  assert.equal(result.caption, "1 stream activities · 4 time bests");
  assert.match(result.durationGrid, /30 min/);
  assert.match(result.durationGrid, /6.50 km/);
  assert.match(result.durationGrid, /4:37\/km/);
  assert.doesNotMatch(result.durationGrid, /15:00/);
  assert.match(result.durationGrid, /data-record-exclusion-key="duration\|30 min\|456\|900\|2700"/);
  assert.match(result.durationGrid, /class="record-exclusion-icon"/);
  assert.doesNotMatch(result.durationGrid, />Exclude</);
  assert.match(result.durationGrid, /<th[^>]*>#<\/th>\s*<th[^>]*>Date<\/th>\s*<th[^>]*>Distance<\/th>\s*<th[^>]*>Pace<\/th>\s*<th[^>]*>Activity<\/th>\s*<th[^>]*>Actions<\/th>/);
  assert.match(result.durationGrid, /<td>1<\/td>\s*<td>05\/02\/2026<\/td>\s*<td>6.50 km<\/td>\s*<td>4:37\/km<\/td>\s*<td class="activity-name">Tempo 1<\/td>\s*<td class="record-actions">[\s\S]*?<\/td>/);
  assert.match(result.durationGrid, /data-time-best-toggle="30 min"/);
  assert.match(result.durationGrid, /Show More/);
  assert.doesNotMatch(result.durationGrid, /Tempo 4/);
});

test("renderPaceBestsView renders fixed-pace distance records from streams", () => {
  const app = loadAppContext();

  const result = vm.runInContext(`
    els.personalBestPaceGrid = { innerHTML: "" };
    els.personalBestPaceCaption = { textContent: "" };
    appState.expandedPaceBestTargets = new Set();
    appState.excludingRecordKey = null;
    const paceEfforts = Array.from({ length: 4 }, (_, index) => ({
      activityId: 800 + index,
      activityName: "Pace Run " + (index + 1),
      startDate: "2026-05-03T12:00:00Z",
      recordKey: "pace|5:00/km|" + (800 + index) + "|0|" + (1500 - index * 30),
      durationSeconds: 1500 - index * 30,
      distanceKm: 5 - index * 0.1,
      paceSecondsPerKm: 300
    }));
    appState.personalBests = {
      paceActivityCount: 1,
      paceEffortCount: 4,
      paces: [{
        name: "5:00/km",
        paceSecondsPerKm: 300,
        count: 4,
        top: paceEfforts
      }]
    };

    renderPaceBestsView();
    ({
      caption: els.personalBestPaceCaption.textContent,
      paceGrid: els.personalBestPaceGrid.innerHTML
    });
  `, app);

  assert.equal(result.caption, "1 stream activities · 4 pace bests");
  assert.match(result.paceGrid, /5:00\/km/);
  assert.match(result.paceGrid, /25:00/);
  assert.match(result.paceGrid, /5.00 km/);
  assert.match(result.paceGrid, /data-record-exclusion-key="pace\|5:00\/km\|800\|0\|1500"/);
  assert.match(result.paceGrid, /class="record-exclusion-icon"/);
  assert.match(result.paceGrid, /<th[^>]*>#<\/th>\s*<th[^>]*>Date<\/th>\s*<th[^>]*>Distance<\/th>\s*<th[^>]*>Time<\/th>\s*<th[^>]*>Pace<\/th>\s*<th[^>]*>Activity<\/th>\s*<th[^>]*>Actions<\/th>/);
  assert.match(result.paceGrid, /<td>1<\/td>\s*<td>05\/03\/2026<\/td>\s*<td>5.00 km<\/td>\s*<td>25:00<\/td>\s*<td>5:00\/km<\/td>\s*<td class="activity-name">Pace Run 1<\/td>\s*<td class="record-actions">[\s\S]*?<\/td>/);
  assert.match(result.paceGrid, /data-pace-best-toggle="5:00\/km"/);
  assert.match(result.paceGrid, /Show More/);
  assert.doesNotMatch(result.paceGrid, /Pace Run 4/);
});

test("renderPaceBestsView renders pace best charts like other best charts", () => {
  const app = loadAppContext();

  const result = vm.runInContext(`
    const chartElement = () => ({ innerHTML: "" });
    const captionElement = () => ({ textContent: "" });
    const toggleButton = (dataset) => ({
      dataset,
      classList: {
        active: false,
        toggle(className, enabled) {
          if (className === "active") this.active = Boolean(enabled);
        }
      }
    });
    const effortsFor = (paceSecondsPerKm, baseDurationSeconds, monthOffset) => Array.from({ length: 10 }, (_, index) => {
      const durationSeconds = baseDurationSeconds - index * 20;
      const distanceKm = durationSeconds / paceSecondsPerKm;
      return {
        activityId: 900 + monthOffset * 10 + index,
        activityName: "Pace Chart " + paceSecondsPerKm + " " + (index + 1),
        startDate: new Date(Date.UTC(2025, monthOffset + index, 1)).toISOString(),
        startDateLocal: new Date(2025, monthOffset + index, 1, 8, 0, 0).toISOString(),
        durationSeconds,
        movingTime: durationSeconds,
        distanceKm,
        paceSecondsPerKm,
        recordKey: "pace|" + formatPaceWithUnit(paceSecondsPerKm).replace("/km", "/km") + "|" + (900 + index) + "|0|" + durationSeconds
      };
    });
    const paceFor = (name, paceSecondsPerKm, baseDurationSeconds, monthOffset) => ({
      name,
      paceSecondsPerKm,
      count: 10,
      top: effortsFor(paceSecondsPerKm, baseDurationSeconds, monthOffset),
      median: {
        durationSeconds: baseDurationSeconds - 120,
        distanceKm: (baseDurationSeconds - 120) / paceSecondsPerKm,
        paceSecondsPerKm,
        count: 10
      }
    });
    const targetPaces = [
      ["3:30/km", 210],
      ["3:45/km", 225],
      ["4:00/km", 240],
      ["4:15/km", 255],
      ["4:30/km", 270],
      ["4:45/km", 285],
      ["5:00/km", 300],
      ["5:13/km", 313],
      ["5:27/km", 327],
      ["5:40/km", 340],
      ["5:50/km", 350],
      ["6:00/km", 360],
      ["6:20/km", 380],
      ["6:40/km", 400],
      ["7:00/km", 420]
    ];

    els.personalBestPaceGrid = chartElement();
    els.personalBestPaceCaption = captionElement();
    els.paceBestDurationChart = chartElement();
    els.paceBestDurationChartCaption = captionElement();
    els.paceBestRecencyChart = chartElement();
    els.paceBestRecencyChartCaption = captionElement();
    els.paceBestTrendChart = chartElement();
    els.paceBestTrendCaption = captionElement();
    els.paceBestTrendTargetSelect = { disabled: false, innerHTML: "" };
    els.paceBestDistanceScaleButtons = [
      toggleButton({ scale: "linear" }),
      toggleButton({ scale: "sqrt" })
    ];
    els.paceBestTrendLimitButtons = [
      toggleButton({ limit: "5" }),
      toggleButton({ limit: "10" }),
      toggleButton({ limit: "20" })
    ];
    appState.expandedPaceBestTargets = new Set();
    appState.paceBestDistanceScale = "sqrt";
    appState.paceBestTrendLimit = 10;
    appState.paceBestTrendTargetName = "5:27/km";
    appState.personalBests = {
      paceActivityCount: 15,
      paceEffortCount: 150,
      paces: targetPaces.map(([name, paceSecondsPerKm], index) => (
        paceFor(name, paceSecondsPerKm, 1500 + index * 90, index)
      ))
    };

    renderPaceBestsView();
    ({
      durationChart: els.paceBestDurationChart.innerHTML,
      recencyChart: els.paceBestRecencyChart.innerHTML,
      trendChart: els.paceBestTrendChart.innerHTML,
      trendOptions: els.paceBestTrendTargetSelect.innerHTML,
      sqrtScaleActive: els.paceBestDistanceScaleButtons[1].classList.active,
      top10Active: els.paceBestTrendLimitButtons[1].classList.active,
      visiblePaceAxisLabels: (els.paceBestDurationChart.innerHTML.match(/data-pace-axis-label=/g) || []).length
    });
  `, app);

  assert.equal(result.top10Active, true);
  assert.equal(result.sqrtScaleActive, true);
  assert.match(result.durationChart, /Top 1/);
  assert.match(result.durationChart, /Median/);
  assert.match(result.durationChart, />Distance \(km\)</);
  assert.match(result.durationChart, />Pace</);
  assert.match(result.durationChart, /5:00\/km/);
  assert.match(result.durationChart, /data-y-scale="sqrt"/);
  assert.equal(result.visiblePaceAxisLabels, 8);
  assert.match(result.durationChart, /data-pace-axis-label="5:00\/km"/);
  assert.doesNotMatch(result.durationChart, /data-pace-axis-label="5:13\/km"/);
  assert.match(result.recencyChart, /D-day/);
  assert.match(result.recencyChart, /Newest/);
  assert.match(result.recencyChart, /Oldest/);
  assert.match(result.trendChart, /Selected Bests/);
  assert.match(result.trendChart, /Trend [+-]\d+\.\d km\/yr/);
  assert.match(result.trendChart, />Top 20</);
  assert.match(result.trendOptions, /<option value="5:27\/km" selected>5:27\/km<\/option>/);
});

test("best record tables use fixed column sizing", () => {
  const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");
  const app = loadAppContext();

  const result = vm.runInContext(`
    els.personalBestGrid = { innerHTML: "" };
    els.personalBestDurationGrid = { innerHTML: "" };
    els.personalBestPaceGrid = { innerHTML: "" };
    els.personalBestDurationCaption = { textContent: "" };
    els.personalBestPaceCaption = { textContent: "" };
    appState.expandedPersonalBestDistances = new Set();
    appState.expandedTimeBestDurations = new Set();
    appState.expandedPaceBestTargets = new Set();
    appState.personalBests = {
      detailActivityCount: 1,
      effortCount: 1,
      durationActivityCount: 1,
      durationEffortCount: 1,
      distances: [{
        name: "5K",
        count: 1,
        top: [{
          activityName: "A very long activity name that should not resize the table",
          startDate: "2026-05-01T00:00:00Z",
          recordKey: "distance|5K|1|0|1490",
          movingTime: 1490,
          paceSecondsPerKm: 298
        }]
      }],
      durations: [{
        name: "30 min",
        count: 1,
        top: [{
          activityName: "A very long duration activity name that should not resize the table",
          startDate: "2026-05-02T00:00:00Z",
          recordKey: "duration|30 min|2|0|1800",
          distanceKm: 6.5,
          paceSecondsPerKm: 277
        }]
      }],
      paces: [{
        name: "5:00/km",
        count: 1,
        top: [{
          activityName: "A very long pace activity name that should not resize the table",
          startDate: "2026-05-03T00:00:00Z",
          recordKey: "pace|5:00/km|3|0|1500",
          durationSeconds: 1500,
          distanceKm: 5,
          paceSecondsPerKm: 300
        }]
      }]
    };

    renderPersonalBests();
    renderTimeLimitedBests(appState.personalBests.durations, appState.personalBests);
    renderPaceLimitedBests(appState.personalBests.paces, appState.personalBests);
    ({
      distanceGrid: els.personalBestGrid.innerHTML,
      durationGrid: els.personalBestDurationGrid.innerHTML,
      paceGrid: els.personalBestPaceGrid.innerHTML
    });
  `, app);

  assert.match(css, /\.personal-best-table table\s*{[^}]*table-layout:\s*fixed;/);
  assert.match(css, /\.record-actions-column\s*{[^}]*width:\s*56px;/);
  assert.match(css, /\.record-activity-column\s*{[^}]*width:\s*auto;/);
  assert.match(result.distanceGrid, /<colgroup>[\s\S]*record-activity-column[\s\S]*record-actions-column[\s\S]*<\/colgroup>/);
  assert.match(result.durationGrid, /<colgroup>[\s\S]*record-activity-column[\s\S]*record-actions-column[\s\S]*<\/colgroup>/);
  assert.match(result.paceGrid, /<colgroup>[\s\S]*record-activity-column[\s\S]*record-actions-column[\s\S]*<\/colgroup>/);
});

test("renderTimeBestsView renders time best charts like personal best charts", () => {
  const app = loadAppContext();

  const result = vm.runInContext(`
    const chartElement = () => ({ innerHTML: "" });
    const captionElement = () => ({ textContent: "" });
    const toggleButton = (dataset) => ({
      dataset,
      classList: {
        active: false,
        toggle(className, enabled) {
          if (className === "active") this.active = Boolean(enabled);
        }
      }
    });
    const effortsFor = (durationSeconds, baseDistanceKm, monthOffset) => Array.from({ length: 10 }, (_, index) => {
      const distanceKm = baseDistanceKm - index * 0.05;
      return {
        activityId: 700 + monthOffset * 10 + index,
        activityName: "Time Effort " + durationSeconds + " " + (index + 1),
        startDate: new Date(Date.UTC(2025, monthOffset + index, 1)).toISOString(),
        startDateLocal: new Date(2025, monthOffset + index, 1, 8, 0, 0).toISOString(),
        distanceKm,
        paceSecondsPerKm: durationSeconds / distanceKm,
        startOffset: 300 + index * 10
      };
    });
    const durationFor = (name, durationSeconds, baseDistanceKm, monthOffset) => ({
      name,
      durationSeconds,
      count: 10,
      top: effortsFor(durationSeconds, baseDistanceKm, monthOffset),
      median: {
        distanceKm: baseDistanceKm - 0.25,
        paceSecondsPerKm: durationSeconds / (baseDistanceKm - 0.25),
        count: 10
      }
    });

    els.personalBestDurationGrid = chartElement();
    els.personalBestDurationCaption = captionElement();
    els.timeBestDistanceChart = chartElement();
    els.timeBestDistanceChartCaption = captionElement();
    els.timeBestRecencyChart = chartElement();
    els.timeBestRecencyChartCaption = captionElement();
    els.timeBestTrendChart = chartElement();
    els.timeBestTrendCaption = captionElement();
    els.timeBestTrendDurationSelect = { disabled: false, innerHTML: "" };
    els.timeBestScaleButtons = [
      toggleButton({ scale: "linear" }),
      toggleButton({ scale: "log" })
    ];
    els.timeBestTrendLimitButtons = [
      toggleButton({ limit: "5" }),
      toggleButton({ limit: "10" }),
      toggleButton({ limit: "20" })
    ];
    appState.expandedTimeBestDurations = new Set();
    appState.refreshingActivityId = null;
    appState.timeBestScale = "log";
    appState.timeBestTrendLimit = 10;
    appState.timeBestTrendDurationName = "30 min";
    appState.personalBests = {
      durationActivityCount: 3,
      durationEffortCount: 30,
      distances: [],
      durations: [
        durationFor("20 min", 1200, 4.4, 0),
        durationFor("30 min", 1800, 6.5, 1),
        durationFor("1 hour", 3600, 12.4, 2)
      ]
    };

    renderTimeBestsView();
    ({
      distanceChart: els.timeBestDistanceChart.innerHTML,
      recencyChart: els.timeBestRecencyChart.innerHTML,
      trendChart: els.timeBestTrendChart.innerHTML,
      trendOptions: els.timeBestTrendDurationSelect.innerHTML,
      logScaleActive: els.timeBestScaleButtons[1].classList.active,
      top10Active: els.timeBestTrendLimitButtons[1].classList.active
    });
  `, app);

  assert.equal(result.logScaleActive, true);
  assert.equal(result.top10Active, true);
  assert.match(result.distanceChart, /Top 1/);
  assert.match(result.distanceChart, /Median/);
  assert.match(result.distanceChart, /Pace/);
  assert.match(result.distanceChart, /\/km/);
  assert.match(result.distanceChart, />Time</);
  assert.doesNotMatch(result.distanceChart, /2m/);
  assert.match(result.distanceChart, /20m/);
  assert.match(result.recencyChart, /D-day/);
  assert.match(result.recencyChart, /Newest/);
  assert.match(result.recencyChart, /Oldest/);
  assert.match(result.trendChart, /Selected Bests/);
  assert.match(result.trendChart, /Trend [+-]\d+:\d{2}\/yr/);
  assert.doesNotMatch(result.trendChart, /km\/yr/);
  assert.match(result.trendChart, />Top 20</);
  assert.match(result.trendOptions, /<option value="30 min" selected>30 min<\/option>/);
});

test("best record types live under Personal Bests tabs", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  const pbView = html.match(/<section class="analysis-view hidden" id="pbView"[\s\S]*?<\/section>/)?.[0] || "";
  const topTabs = html.match(/<div class="view-tabs"[\s\S]*?<\/div>/)?.[0] || "";

  assert.doesNotMatch(topTabs, /data-view="time"/);
  assert.doesNotMatch(topTabs, />Time Bests</);
  assert.match(pbView, /data-personal-best-tab="distance"[\s\S]*>Distance</);
  assert.match(pbView, /data-personal-best-tab="time"[\s\S]*>Time</);
  assert.match(pbView, /data-personal-best-tab="pace"[\s\S]*>Pace</);
  assert.match(pbView, /id="personalBestDistanceView"/);
  assert.match(pbView, /id="timeView"/);
  assert.match(pbView, /id="paceView"/);
  assert.match(pbView, /personalBestDurationGrid/);
  assert.match(pbView, /personalBestPaceGrid/);
  assert.match(pbView, /Time-Limited Bests/);
  assert.match(pbView, /Pace Bests/);
  assert.match(pbView, /class="scale-option pace-distance-scale-option active"[^>]*data-scale="linear"/);
  assert.match(pbView, /class="scale-option pace-distance-scale-option"[^>]*data-scale="sqrt"[\s\S]*>Sqrt</);
  assert.doesNotMatch(pbView, /class="scale-option pace-distance-scale-option"[^>]*data-scale="log"[\s\S]*>Log</);
});

test("personal best type tabs stay in one row", () => {
  const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");
  const scaleToggleIndex = css.indexOf(".scale-toggle");
  const personalBestTabsIndex = css.indexOf(".scale-toggle.personal-best-tabs");

  assert.ok(personalBestTabsIndex > scaleToggleIndex);
  assert.match(css, /\.scale-toggle\.personal-best-tabs\s*{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
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
    els.timeBestTrendDurationSelect = fakeElement();
    els.personalBestGrid = fakeElement();
    els.riegelExponentInput = fakeElement();
    els.kpiCards = [];
    els.viewTabs = [];
    els.personalBestScaleButtons = [];
    els.timeBestScaleButtons = [];
    els.personalBestTrendLimitButtons = [];
    els.timeBestTrendLimitButtons = [];
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
  assert.doesNotMatch(topTabs, /data-view="time"/);
  assert.doesNotMatch(topTabs, />Time Bests</);
  assert.match(topTabs, /data-view="pb"[\s\S]*>Personal Bests</);
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
  assert.match(result.chart, /data-riegel-placeholder="true"[\s\S]*No Top 1 35K best effort yet/);
  assert.match(result.chart, />35</);
  assert.match(result.chart, /data-riegel-source-name="Marathon"/);
  assert.match(result.chart, /data-riegel-source-name="35K"/);
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
