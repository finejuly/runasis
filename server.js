const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

ensureSupportedRuntime();

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const ENV_PATH = path.join(ROOT, ".env");
const DATA_DIR = path.join(ROOT, "data");
const LEGACY_STORE_PATH = path.join(DATA_DIR, "strava-store.json");
const STRAVA_DATA_DIR = path.join(DATA_DIR, "strava");
const AUTH_PATH = path.join(STRAVA_DATA_DIR, "auth.json");
const SYNC_STATE_PATH = path.join(STRAVA_DATA_DIR, "sync-state.json");
const ACTIVITIES_DIR = path.join(STRAVA_DATA_DIR, "activities");
const ACTIVITIES_INDEX_PATH = path.join(ACTIVITIES_DIR, "index.json");
const DETAILS_DIR = path.join(ACTIVITIES_DIR, "details");
const RAW_DETAILS_DIR = path.join(ACTIVITIES_DIR, "raw-details");
const RAW_STREAMS_DIR = path.join(ACTIVITIES_DIR, "raw-streams");
const DERIVED_DIR = path.join(STRAVA_DATA_DIR, "derived");
const PERSONAL_BESTS_CACHE_PATH = path.join(DERIVED_DIR, "personal-bests.json");
const EXCLUDED_RECORDS_PATH = path.join(DERIVED_DIR, "excluded-records.json");

loadEnvFile();

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const JSON_BODY_LIMIT_BYTES = 64 * 1024;
const REQUESTED_PORT = Number(process.env.PORT || 3000);
const HOST = resolveHost(process.env.HOST || "127.0.0.1");
const STRICT_PORT = process.env.STRICT_PORT === "1";
let activePort = REQUESTED_PORT;
const MAX_SYNC_PAGES = Number(process.env.STRAVA_MAX_SYNC_PAGES || 200);
const MAX_DETAIL_SYNC_ACTIVITIES = normalizePositiveInteger(process.env.STRAVA_MAX_DETAIL_SYNC_ACTIVITIES) || 40;
const PERSONAL_BESTS_CACHE_VERSION = 8;
const EXCLUDED_RECORDS_VERSION = 1;
const ACTIVITY_STREAM_KEYS = [
  "time",
  "distance",
  "latlng",
  "altitude",
  "velocity_smooth",
  "heartrate",
  "cadence",
  "watts",
  "temp",
  "moving",
  "grade_smooth"
];
const TIME_BEST_TARGETS = [
  { name: "15s", durationSeconds: 15 },
  { name: "30s", durationSeconds: 30 },
  { name: "1m", durationSeconds: 60 },
  { name: "3m", durationSeconds: 3 * 60 },
  { name: "5m", durationSeconds: 5 * 60 },
  { name: "10m", durationSeconds: 10 * 60 },
  { name: "20m", durationSeconds: 20 * 60 },
  { name: "30m", durationSeconds: 30 * 60 },
  { name: "1h", durationSeconds: 60 * 60 },
  { name: "1.5h", durationSeconds: 90 * 60 },
  { name: "2h", durationSeconds: 2 * 60 * 60 },
  { name: "2.5h", durationSeconds: 2.5 * 60 * 60 },
  { name: "3h", durationSeconds: 3 * 60 * 60 },
  { name: "3.5h", durationSeconds: 3.5 * 60 * 60 },
  { name: "4h", durationSeconds: 4 * 60 * 60 }
];
const PACE_BEST_TARGETS = [
  { name: "3:30/km", paceSecondsPerKm: 3 * 60 + 30 },
  { name: "3:45/km", paceSecondsPerKm: 3 * 60 + 45 },
  { name: "4:00/km", paceSecondsPerKm: 4 * 60 },
  { name: "4:15/km", paceSecondsPerKm: 4 * 60 + 15 },
  { name: "4:30/km", paceSecondsPerKm: 4 * 60 + 30 },
  { name: "4:45/km", paceSecondsPerKm: 4 * 60 + 45 },
  { name: "5:00/km", paceSecondsPerKm: 5 * 60 },
  { name: "5:13/km", paceSecondsPerKm: 5 * 60 + 13 },
  { name: "5:27/km", paceSecondsPerKm: 5 * 60 + 27 },
  { name: "5:40/km", paceSecondsPerKm: 5 * 60 + 40 },
  { name: "5:50/km", paceSecondsPerKm: 5 * 60 + 50 },
  { name: "6:00/km", paceSecondsPerKm: 6 * 60 },
  { name: "6:20/km", paceSecondsPerKm: 6 * 60 + 20 },
  { name: "6:40/km", paceSecondsPerKm: 6 * 60 + 40 },
  { name: "7:00/km", paceSecondsPerKm: 7 * 60 }
];
const PERSONAL_BEST_DISTANCE_TARGETS = [
  { name: "100m", distance: 100 },
  { name: "200m", distance: 200 },
  { name: "400m", distance: 400 },
  { name: "1/2 mile", distance: 804.672 },
  { name: "1K", distance: 1000 },
  { name: "1 mile", distance: 1609.344 },
  { name: "2K", distance: 2000 },
  { name: "5K", distance: 5000 },
  { name: "5 mile", distance: 8046.72 },
  { name: "10K", distance: 10000 },
  { name: "15K", distance: 15000 },
  { name: "10 mile", distance: 16093.44 },
  { name: "20K", distance: 20000 },
  { name: "Half-Marathon", distance: 21097.5 },
  { name: "25K", distance: 25000 },
  { name: "30K", distance: 30000 },
  { name: "35K", distance: 35000 },
  { name: "Marathon", distance: 42195 }
];
const PREFERRED_BEST_EFFORT_ORDER = PERSONAL_BEST_DISTANCE_TARGETS.map((target) => target.name);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const authStates = new Map();
const csrfToken = crypto.randomBytes(32).toString("hex");

function ensureSupportedRuntime() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 18 && typeof fetch === "function") return;

  console.error(`Runasis error: Node.js 18 or newer with fetch support is required. Current: ${process.version}`);
  process.exit(1);
}

function resolveHost(host) {
  if (isLoopbackHostname(host) || process.env.RUNASIS_ALLOW_UNSAFE_HOST === "1") {
    return host;
  }

  console.error(`Runasis error: HOST must be localhost or a loopback address. Current: ${host}`);
  process.exit(1);
}

function loadEnvFile() {
  try {
    const text = require("node:fs").readFileSync(ENV_PATH, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const index = line.indexOf("=");
      const key = line.slice(0, index).trim();
      let value = line.slice(index + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        try {
          value = JSON.parse(value);
        } catch {
          value = value.slice(1, -1);
        }
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`Could not read .env: ${error.message}`);
    }
  }
}

function getConfig() {
  const clientId = process.env.STRAVA_CLIENT_ID || "";
  const clientSecret = process.env.STRAVA_CLIENT_SECRET || "";
  return {
    clientId,
    clientSecret,
    redirectUri: resolveRedirectUri(),
    configured: isUsableStravaConfig(clientId, clientSecret)
  };
}

function isUsableStravaConfig(clientId, clientSecret) {
  if (isPlaceholderConfigValue(clientId) || isPlaceholderConfigValue(clientSecret)) return false;
  try {
    normalizeStravaConfigInput({ clientId, clientSecret });
    return true;
  } catch {
    return false;
  }
}

function isPlaceholderConfigValue(value) {
  const text = String(value || "").trim().toLowerCase();
  return !text || text.startsWith("replace_with_") || text === "your_client_id" || text === "your_client_secret";
}

function normalizeStravaConfigInput(body) {
  const clientId = String(body.clientId ?? body.STRAVA_CLIENT_ID ?? "").trim();
  const clientSecret = String(body.clientSecret ?? body.STRAVA_CLIENT_SECRET ?? "").trim();

  if (!clientId || !clientSecret) {
    const error = new Error("Enter both Client ID and Client Secret.");
    error.statusCode = 400;
    throw error;
  }

  if (!/^\d{1,32}$/.test(clientId)) {
    const error = new Error("Enter the numeric Client ID from your Strava app page.");
    error.statusCode = 400;
    throw error;
  }

  if (clientSecret.length > 256 || /[\r\n]/.test(clientSecret)) {
    const error = new Error("Client Secret is invalid.");
    error.statusCode = 400;
    throw error;
  }

  return { clientId, clientSecret };
}

async function saveStravaConfig(body) {
  const config = normalizeStravaConfigInput(body);
  let existingText = "";
  try {
    existingText = await fs.readFile(ENV_PATH, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const nextText = upsertEnvText(existingText, {
    STRAVA_CLIENT_ID: config.clientId,
    STRAVA_CLIENT_SECRET: config.clientSecret
  });
  await writeTextAtomic(ENV_PATH, nextText);

  process.env.STRAVA_CLIENT_ID = config.clientId;
  process.env.STRAVA_CLIENT_SECRET = config.clientSecret;

  return getConfig();
}

function upsertEnvText(text, updates) {
  const lines = text.trim() ? text.replace(/\r\n/g, "\n").split("\n") : [];
  const updated = new Set();
  const nextLines = lines.map((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match || !Object.prototype.hasOwnProperty.call(updates, match[1])) return line;
    updated.add(match[1]);
    return `${match[1]}=${formatEnvValue(updates[match[1]])}`;
  });

  const missing = Object.entries(updates)
    .filter(([key]) => !updated.has(key))
    .map(([key, value]) => `${key}=${formatEnvValue(value)}`);

  if (missing.length) {
    if (nextLines.length && nextLines.at(-1).trim()) nextLines.push("");
    nextLines.push(...missing);
  }

  return `${nextLines.join("\n").replace(/\n*$/, "")}\n`;
}

function formatEnvValue(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:@+-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function resolveRedirectUri() {
  const fallback = `http://localhost:${activePort}/auth/strava/callback`;
  const configured = process.env.STRAVA_REDIRECT_URI || "";
  if (!configured) return fallback;

  try {
    const url = new URL(configured);
    const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (isLocal && url.pathname === "/auth/strava/callback") {
      url.port = String(activePort);
      return url.toString();
    }
  } catch {
    return fallback;
  }

  return process.env.RUNASIS_ALLOW_UNSAFE_REDIRECT === "1" ? configured : fallback;
}

function emptyStore() {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    athlete: null,
    token: null,
    scopes: [],
    activities: [],
    detailsById: new Map(),
    rawDetailIds: new Set(),
    rawStreamIds: new Set(),
    lastSyncAt: null,
    lastSyncSummary: null,
    lastDetailSyncAt: null,
    lastDetailSyncSummary: null,
    createdAt: now,
    updatedAt: now
  };
}

async function readStore() {
  await ensureStoreMigrated();

  const [auth, syncState, activityIndex, detailsById, rawDetailIds, rawStreamIds] = await Promise.all([
    readJson(AUTH_PATH, emptyAuthStore()),
    readJson(SYNC_STATE_PATH, emptySyncState()),
    readJson(ACTIVITIES_INDEX_PATH, emptyActivityIndex()),
    readActivityDataMap(DETAILS_DIR),
    listActivityDataIds(RAW_DETAILS_DIR),
    listActivityDataIds(RAW_STREAMS_DIR)
  ]);

  return buildStore({ auth, syncState, activityIndex, detailsById, rawDetailIds, rawStreamIds });
}

async function writeStore(store) {
  await ensureDataDirs();

  const now = new Date().toISOString();
  const auth = {
    schemaVersion: 2,
    athlete: store.athlete || null,
    token: store.token || null,
    scopes: store.scopes || [],
    createdAt: store.createdAt || now,
    updatedAt: now
  };
  const syncState = {
    schemaVersion: 2,
    lastSyncAt: store.lastSyncAt || null,
    lastSyncSummary: store.lastSyncSummary || null,
    lastDetailSyncAt: store.lastDetailSyncAt || null,
    lastDetailSyncSummary: store.lastDetailSyncSummary || null,
    createdAt: store.createdAt || now,
    updatedAt: now
  };
  const activityIndex = {
    schemaVersion: 2,
    activities: (store.activities || []).map(sanitizeActivity),
    createdAt: store.createdAt || now,
    updatedAt: now
  };

  await Promise.all([
    writeJsonAtomic(AUTH_PATH, auth),
    writeJsonAtomic(SYNC_STATE_PATH, syncState),
    writeJsonAtomic(ACTIVITIES_INDEX_PATH, activityIndex)
  ]);

  return buildStore({
    auth,
    syncState,
    activityIndex,
    detailsById: store.detailsById || new Map(),
    rawDetailIds: store.rawDetailIds || new Set(),
    rawStreamIds: store.rawStreamIds || new Set()
  });
}

function emptyAuthStore() {
  return {
    schemaVersion: 2,
    athlete: null,
    token: null,
    scopes: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function emptySyncState() {
  return {
    schemaVersion: 2,
    lastSyncAt: null,
    lastSyncSummary: null,
    lastDetailSyncAt: null,
    lastDetailSyncSummary: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function emptyActivityIndex() {
  return {
    schemaVersion: 2,
    activities: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function buildStore({ auth, syncState, activityIndex, detailsById, rawDetailIds, rawStreamIds }) {
  return {
    schemaVersion: 2,
    athlete: auth.athlete || null,
    token: auth.token || null,
    scopes: auth.scopes || [],
    activities: Array.isArray(activityIndex.activities) ? activityIndex.activities : [],
    detailsById: detailsById || new Map(),
    rawDetailIds: rawDetailIds || new Set(),
    rawStreamIds: rawStreamIds || new Set(),
    lastSyncAt: syncState.lastSyncAt || null,
    lastSyncSummary: syncState.lastSyncSummary || null,
    lastDetailSyncAt: syncState.lastDetailSyncAt || null,
    lastDetailSyncSummary: syncState.lastDetailSyncSummary || null,
    createdAt: auth.createdAt || activityIndex.createdAt || syncState.createdAt || new Date().toISOString(),
    updatedAt: [auth.updatedAt, activityIndex.updatedAt, syncState.updatedAt].filter(Boolean).sort().at(-1) || null
  };
}

async function ensureStoreMigrated() {
  await ensureDataDirs();
  if (await pathExists(ACTIVITIES_INDEX_PATH)) return;

  try {
    const text = await fs.readFile(LEGACY_STORE_PATH, "utf8");
    const legacy = { ...emptyStore(), ...JSON.parse(text) };
    await migrateLegacyStore(legacy);
  } catch (error) {
    if (error.code === "ENOENT") {
      await writeStore(emptyStore());
      return;
    }
    throw error;
  }
}

async function migrateLegacyStore(legacy) {
  const detailWrites = [];
  const activities = [];
  const detailIds = new Set();

  for (const activity of legacy.activities || []) {
    if (!activity?.id) continue;
    activities.push(sanitizeActivity(activity));
    if (hasDetailedActivityData(activity)) {
      const fetchedAt = activity.details_fetched_at || legacy.lastDetailSyncAt || legacy.updatedAt || new Date().toISOString();
      detailIds.add(String(activity.id));
      detailWrites.push(writeActivityDetail(activity.id, sanitizeActivityDetails(activity, fetchedAt)));
    }
  }

  await writeStore({
    ...legacy,
    activities,
    detailsById: new Map()
  });
  await Promise.all(detailWrites);

  if (detailIds.size) {
    const syncState = await readJson(SYNC_STATE_PATH, emptySyncState());
    if (!syncState.lastDetailSyncSummary) {
      syncState.lastDetailSyncSummary = {
        migrated: detailIds.size,
        remaining: activities.filter(isRun).length - detailIds.size,
        syncedAt: syncState.lastDetailSyncAt || legacy.updatedAt || new Date().toISOString()
      };
      await writeJsonAtomic(SYNC_STATE_PATH, syncState);
    }
  }
}

function hasDetailedActivityData(activity) {
  return Boolean(
    activity.details_fetched_at ||
    Array.isArray(activity.best_efforts) ||
    Array.isArray(activity.segment_efforts) ||
    Array.isArray(activity.splits_metric) ||
    Array.isArray(activity.splits_standard) ||
    Array.isArray(activity.laps)
  );
}

async function ensureDataDirs() {
  const directories = [DATA_DIR, STRAVA_DATA_DIR, ACTIVITIES_DIR, DETAILS_DIR, RAW_DETAILS_DIR, RAW_STREAMS_DIR, DERIVED_DIR];
  await Promise.all(directories.map(async (directory) => {
    await fs.mkdir(directory, { recursive: true, mode: PRIVATE_DIR_MODE });
    await fs.chmod(directory, PRIVATE_DIR_MODE).catch(() => {});
  }));
}

async function readJson(filePath, fallback) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: PRIVATE_DIR_MODE });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: PRIVATE_FILE_MODE
  });
  await fs.rename(temporaryPath, filePath);
  await fs.chmod(filePath, PRIVATE_FILE_MODE).catch(() => {});
}

async function writeTextAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, value, {
    encoding: "utf8",
    mode: PRIVATE_FILE_MODE
  });
  await fs.rename(temporaryPath, filePath);
  await fs.chmod(filePath, PRIVATE_FILE_MODE).catch(() => {});
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function readActivityDataMap(directory) {
  const ids = await listActivityDataIds(directory);
  const entries = await Promise.all(Array.from(ids, async (id) => {
    return [id, await readJson(activityDataPath(directory, id), null)];
  }));
  return new Map(entries.filter(([, value]) => value));
}

async function listActivityDataIds(directory) {
  try {
    const files = await fs.readdir(directory);
    return new Set(files
      .filter((file) => file.endsWith(".json"))
      .map((file) => path.basename(file, ".json")));
  } catch (error) {
    if (error.code === "ENOENT") return new Set();
    throw error;
  }
}

function activityDataPath(directory, id) {
  const safeId = String(id).replace(/[^0-9A-Za-z_-]/g, "");
  if (!safeId) throw new Error("Activity id is required.");
  return path.join(directory, `${safeId}.json`);
}

function normalizeActivityId(value) {
  const id = String(value ?? "").trim();
  if (!/^[0-9A-Za-z_-]+$/.test(id)) {
    const error = new Error("Activity id is required.");
    error.statusCode = 400;
    throw error;
  }
  return id;
}

async function writeActivityDetail(id, detail) {
  await writeJsonAtomic(activityDataPath(DETAILS_DIR, id), detail);
}

async function writeRawActivityDetail(id, detail) {
  await writeJsonAtomic(activityDataPath(RAW_DETAILS_DIR, id), detail);
}

async function writeRawActivityStream(id, streams) {
  await writeJsonAtomic(activityDataPath(RAW_STREAMS_DIR, id), streams);
}

async function clearStore() {
  await fs.rm(STRAVA_DATA_DIR, { recursive: true, force: true });
  const empty = await writeStore(emptyStore());
  await writeJsonAtomic(LEGACY_STORE_PATH, {
    schemaVersion: 1,
    athlete: null,
    token: null,
    scopes: [],
    activities: [],
    lastSyncAt: null,
    lastSyncSummary: null,
    lastDetailSyncAt: null,
    lastDetailSyncSummary: null,
    createdAt: empty.createdAt,
    updatedAt: new Date().toISOString()
  });
  return empty;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, statusCode, text, headers = {}) {
  res.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    ...headers
  });
  res.end(text);
}

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function sanitizeActivity(activity) {
  return compactObject({
    id: activity.id,
    name: activity.name,
    distance: activity.distance,
    moving_time: activity.moving_time,
    elapsed_time: activity.elapsed_time,
    total_elevation_gain: activity.total_elevation_gain,
    type: activity.type,
    sport_type: activity.sport_type || activity.type,
    workout_type: activity.workout_type,
    start_date: activity.start_date,
    start_date_local: activity.start_date_local,
    timezone: activity.timezone,
    utc_offset: activity.utc_offset,
    average_speed: activity.average_speed,
    max_speed: activity.max_speed,
    average_heartrate: activity.average_heartrate,
    max_heartrate: activity.max_heartrate,
    suffer_score: activity.suffer_score,
    calories: activity.calories,
    gear_id: activity.gear_id,
    commute: activity.commute,
    trainer: activity.trainer,
    manual: activity.manual,
    private: activity.private,
    visibility: activity.visibility,
    kudos_count: activity.kudos_count,
    achievement_count: activity.achievement_count
  });
}

function sanitizeActivityDetails(activity, fetchedAt) {
  const bestEfforts = Array.isArray(activity.best_efforts)
    ? activity.best_efforts.map(sanitizeBestEffort)
    : undefined;

  return compactObject({
    ...sanitizeActivity(activity),
    best_efforts: bestEfforts,
    sport_type: activity.sport_type || activity.type,
    details_fetched_at: fetchedAt,
    details_fetch_failed_at: null,
    details_fetch_error: null
  });
}

function sanitizeBestEffort(effort) {
  return compactObject({
    id: effort.id,
    name: effort.name,
    distance: effort.distance,
    moving_time: effort.moving_time,
    elapsed_time: effort.elapsed_time,
    start_date: effort.start_date,
    start_date_local: effort.start_date_local,
    start_index: effort.start_index,
    end_index: effort.end_index,
    pr_rank: effort.pr_rank
  });
}

function sanitizeActivityDetailError(activity, error, failedAt) {
  return compactObject({
    ...sanitizeActivity(activity),
    details_fetched_at: null,
    details_fetch_failed_at: failedAt,
    details_fetch_error: compactObject({
      statusCode: error.statusCode || null,
      message: error.message || "Activity detail fetch failed"
    })
  });
}

function statusFromStore(store) {
  const runs = store.activities.filter(isRun);
  const latest = store.activities
    .map((activity) => activity.start_date)
    .filter(Boolean)
    .sort()
    .at(-1);
  return {
    configured: getConfig().configured,
    connected: Boolean(store.token?.refresh_token),
    athlete: store.athlete ? {
      id: store.athlete.id,
      username: store.athlete.username,
      firstname: store.athlete.firstname,
      lastname: store.athlete.lastname,
      city: store.athlete.city,
      state: store.athlete.state,
      country: store.athlete.country,
      profile: store.athlete.profile
    } : null,
    scopes: store.scopes || [],
    activityCount: store.activities.length,
    runCount: runs.length,
    latestActivityAt: latest || null,
    lastSyncAt: store.lastSyncAt,
    lastSyncSummary: store.lastSyncSummary,
    lastDetailSyncAt: store.lastDetailSyncAt,
    lastDetailSyncSummary: store.lastDetailSyncSummary,
    activityDetails: detailStatusFromStore(store),
    csrfToken,
    redirectUri: getConfig().redirectUri,
    dataRoot: path.relative(ROOT, STRAVA_DATA_DIR),
    dataFile: path.relative(ROOT, ACTIVITIES_INDEX_PATH)
  };
}

function detailStatusFromStore(store) {
  const runs = store.activities.filter(isRun);
  const detailsById = store.detailsById || new Map();
  const rawDetailIds = typeof store.rawDetailIds?.has === "function" ? store.rawDetailIds : null;
  const rawStreamIds = typeof store.rawStreamIds?.has === "function" ? store.rawStreamIds : null;
  const rawRunCount = rawDetailIds
    ? runs.filter((activity) => rawDetailIds.has(String(activity.id))).length
    : null;
  const rawStreamRunCount = rawStreamIds
    ? runs.filter((activity) => rawStreamIds.has(String(activity.id))).length
    : null;
  const pendingRunCount = rawDetailIds
    ? runs.filter((activity) => {
      const id = String(activity.id);
      return !isSuccessfulActivityDetail(detailsById.get(id)) || !rawDetailIds.has(id);
    }).length
    : null;
  const pendingRawStreamRunCount = rawStreamIds
    ? runs.length - rawStreamRunCount
    : null;
  const records = runs
    .map((activity) => detailsById.get(String(activity.id)))
    .filter(Boolean);
  const fetched = records.filter(isSuccessfulActivityDetail);
  const failed = records.filter(isFailedActivityDetail);
  const bestEffortActivities = fetched.filter((activity) => Array.isArray(activity.best_efforts) && activity.best_efforts.length > 0);
  const bestEffortCount = fetched.reduce((total, activity) => total + (Array.isArray(activity.best_efforts) ? activity.best_efforts.length : 0), 0);
  return compactObject({
    runCount: runs.length,
    fetchedRunCount: fetched.length,
    failedRunCount: failed.length,
    pendingRunCount: rawDetailIds ? pendingRunCount : runs.length - fetched.length,
    bestEffortActivityCount: bestEffortActivities.length,
    bestEffortCount,
    rawRunCount: rawDetailIds ? rawRunCount : undefined,
    pendingRawRunCount: rawDetailIds ? runs.length - rawRunCount : undefined,
    rawStreamRunCount: rawStreamIds ? rawStreamRunCount : undefined,
    pendingRawStreamRunCount: rawStreamIds ? pendingRawStreamRunCount : undefined
  });
}

function activityListItemFromStore(activity, detailsById = new Map()) {
  const detail = detailsById.get(String(activity.id));
  const status = detailStatusForActivity(activity, detail);
  const bestEffortCount = Array.isArray(detail?.best_efforts) ? detail.best_efforts.length : 0;

  return compactObject({
    ...sanitizeActivity(activity),
    detail_status: status,
    best_effort_count: bestEffortCount,
    details_fetched_at: detail?.details_fetched_at || null,
    details_fetch_failed_at: detail?.details_fetch_failed_at || null,
    details_fetch_error: detail?.details_fetch_error || null
  });
}

function detailStatusForActivity(activity, detail) {
  if (!isRun(activity)) return "not_applicable";
  if (isFailedActivityDetail(detail)) return "failed";
  if (isSuccessfulActivityDetail(detail)) return "fetched";
  return "missing";
}

function isSuccessfulActivityDetail(detail) {
  return Boolean(detail && !isFailedActivityDetail(detail));
}

function isFailedActivityDetail(detail) {
  return Boolean(detail?.details_fetch_failed_at || detail?.details_fetch_error);
}

function buildPersonalBestsCacheFingerprint(store) {
  const activities = (store.activities || [])
    .map((activity) => ({
      id: String(activity?.id || ""),
      name: activity?.name || null,
      sportType: activity?.sport_type || activity?.type || null,
      startDate: activity?.start_date || null,
      startDateLocal: activity?.start_date_local || null,
      distance: Number(activity?.distance || 0),
      movingTime: Number(activity?.moving_time || 0)
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const details = Array.from((store.detailsById || new Map()).entries())
    .map(([id, detail]) => ({
      id: String(id),
      activityId: String(detail?.id || id),
      name: detail?.name || null,
      sportType: detail?.sport_type || detail?.type || null,
      startDate: detail?.start_date || null,
      startDateLocal: detail?.start_date_local || null,
      fetchedAt: detail?.details_fetched_at || null,
      failedAt: detail?.details_fetch_failed_at || null,
      error: detail?.details_fetch_error || null
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const rawStreamIds = iterableToSortedStrings(store.rawStreamIds);

  return hashJson({
    cacheVersion: PERSONAL_BESTS_CACHE_VERSION,
    personalBestDistanceTargets: PERSONAL_BEST_DISTANCE_TARGETS,
    timeBestTargets: TIME_BEST_TARGETS,
    paceBestTargets: PACE_BEST_TARGETS,
    updatedAt: store.updatedAt || null,
    lastSyncAt: store.lastSyncAt || null,
    lastDetailSyncAt: store.lastDetailSyncAt || null,
    activities,
    details,
    rawStreamIds
  });
}

function iterableToSortedStrings(value) {
  if (!value || typeof value[Symbol.iterator] !== "function") return [];
  return Array.from(value).map(String).sort();
}

function hashJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function readPersonalBestsCache(sourceFingerprint) {
  const payload = await readJson(PERSONAL_BESTS_CACHE_PATH, null);
  if (!isFreshPersonalBestsCache(payload, sourceFingerprint)) return null;
  return payload;
}

function isFreshPersonalBestsCache(payload, sourceFingerprint) {
  return Boolean(
    payload &&
    payload.cache?.version === PERSONAL_BESTS_CACHE_VERSION &&
    payload.cache?.sourceFingerprint === sourceFingerprint &&
    Array.isArray(payload.distances) &&
    Array.isArray(payload.durations) &&
    Array.isArray(payload.paces)
  );
}

async function readExcludedRecords() {
  const payload = await readJson(EXCLUDED_RECORDS_PATH, emptyExcludedRecords());
  return normalizeExcludedRecords(payload);
}

function emptyExcludedRecords() {
  return {
    version: EXCLUDED_RECORDS_VERSION,
    records: {}
  };
}

function normalizeExcludedRecords(payload) {
  const normalized = emptyExcludedRecords();
  const records = payload?.records && typeof payload.records === "object" && !Array.isArray(payload.records)
    ? payload.records
    : {};
  for (const [key, value] of Object.entries(records)) {
    const recordKey = normalizeRecordKey(key);
    if (!recordKey) continue;
    normalized.records[recordKey] = {
      recordKey,
      excludedAt: value?.excludedAt || new Date(0).toISOString()
    };
  }
  return normalized;
}

async function setRecordExcluded(recordKeyValue, excluded) {
  const recordKey = normalizeRecordKey(recordKeyValue);
  if (!recordKey) {
    const error = new Error("Record key is required.");
    error.statusCode = 400;
    throw error;
  }

  const excludedRecords = await readExcludedRecords();
  if (excluded) {
    excludedRecords.records[recordKey] = {
      recordKey,
      excludedAt: new Date().toISOString()
    };
  } else {
    delete excludedRecords.records[recordKey];
  }
  await writeJsonAtomic(EXCLUDED_RECORDS_PATH, excludedRecords);

  return {
    ok: true,
    recordKey,
    excluded: Boolean(excluded),
    excludedRecordCount: Object.keys(excludedRecords.records).length
  };
}

function normalizeRecordKey(value) {
  const recordKey = String(value ?? "").trim();
  if (!recordKey || recordKey.length > 512 || /[\r\n]/.test(recordKey)) return "";
  return recordKey;
}

async function personalBestsFromStore(store, options = {}) {
  const sourceFingerprint = buildPersonalBestsCacheFingerprint(store);
  const cached = await readPersonalBestsCache(sourceFingerprint);
  const payload = cached || await computePersonalBestsFromStore(store, sourceFingerprint);
  const excludedRecords = await readExcludedRecords();
  return applyRecordExclusions(payload, excludedRecords, {
    includeExcluded: options.includeExcluded
  });
}

function applyRecordExclusions(payload, excludedRecords, options = {}) {
  const excludedKeys = new Set(Object.keys(excludedRecords?.records || {}));
  const includeExcluded = Boolean(options.includeExcluded);
  const distances = filterRecordGroups(payload.distances || [], excludedKeys, includeExcluded, summarizeMedianPersonalBestEffort);
  const durations = filterRecordGroups(payload.durations || [], excludedKeys, includeExcluded, summarizeMedianTimeBestEffort);
  const paces = filterRecordGroups(payload.paces || [], excludedKeys, includeExcluded, summarizeMedianPaceBestEffort);

  return {
    ...payload,
    includeExcluded,
    excludedRecordCount: excludedKeys.size,
    detailActivityCount: countUniqueRecordActivities(distances),
    effortCount: countGroupRecords(distances),
    distanceCount: distances.length,
    distances,
    durationActivityCount: countUniqueRecordActivities(durations),
    durationEffortCount: countGroupRecords(durations),
    durationCount: durations.length,
    durations,
    paceActivityCount: countUniqueRecordActivities(paces),
    paceEffortCount: countGroupRecords(paces),
    paceCount: paces.length,
    paces
  };
}

function filterRecordGroups(groups, excludedKeys, includeExcluded, summarizeMedian) {
  return groups
    .map((group) => {
      const records = (group.top || [])
        .map((record) => markRecordExclusion(record, excludedKeys))
        .filter((record) => includeExcluded || !record.excluded);
      return {
        ...group,
        count: records.length,
        median: summarizeMedian(records),
        top: records
      };
    })
    .filter((group) => group.count > 0);
}

function markRecordExclusion(record, excludedKeys) {
  const recordKey = record.recordKey || buildRecordKey(record.recordType, record.name, record.activityId, record.startOffset, record.endOffset);
  return {
    ...record,
    recordKey,
    excluded: excludedKeys.has(recordKey)
  };
}

function countGroupRecords(groups) {
  return groups.reduce((total, group) => total + Number(group.count || 0), 0);
}

function countUniqueRecordActivities(groups) {
  const activityIds = new Set();
  for (const group of groups) {
    for (const record of group.top || []) {
      if (record?.activityId) activityIds.add(String(record.activityId));
    }
  }
  return activityIds.size;
}

async function computePersonalBestsFromStore(store, sourceFingerprint) {
  const distanceBests = await distanceBestsFromStore(store);
  const timeBests = await timeBestsFromStore(store);
  const paceBests = await paceBestsFromStore(store);
  const generatedAt = new Date().toISOString();
  const payload = {
    generatedAt,
    cache: {
      version: PERSONAL_BESTS_CACHE_VERSION,
      sourceFingerprint,
      generatedAt
    },
    detailActivityCount: distanceBests.activityCount,
    effortCount: distanceBests.effortCount,
    distanceCount: distanceBests.distances.length,
    distances: distanceBests.distances,
    durationActivityCount: timeBests.activityCount,
    durationEffortCount: timeBests.effortCount,
    durationCount: timeBests.durations.length,
    durations: timeBests.durations,
    paceActivityCount: paceBests.activityCount,
    paceEffortCount: paceBests.effortCount,
    paceCount: paceBests.paces.length,
    paces: paceBests.paces
  };

  await writeJsonAtomic(PERSONAL_BESTS_CACHE_PATH, payload);
  return payload;
}

async function distanceBestsFromStore(store) {
  const groups = new Map(PERSONAL_BEST_DISTANCE_TARGETS.map((target) => [target.name, []]));
  const activityById = activityMapFromStore(store);
  let activityCount = 0;
  let effortCount = 0;

  for (const rawId of rawStreamIdsFromStore(store)) {
    const id = String(rawId);
    const activity = activityById.get(id);
    if (!activity || !isRun(activity)) continue;

    const streams = await readJson(activityDataPath(RAW_STREAMS_DIR, id), null);
    const efforts = distanceBestEffortsForActivity(activity, streams);
    if (!efforts.length) continue;

    activityCount += 1;
    for (const effort of efforts) {
      const group = groups.get(effort.name);
      if (!group) continue;
      effortCount += 1;
      group.push(effort);
    }
  }

  const distances = PERSONAL_BEST_DISTANCE_TARGETS
    .map((target) => {
      const sorted = (groups.get(target.name) || []).sort(comparePersonalBestEfforts);
      const medianEffort = summarizeMedianPersonalBestEffort(sorted);
      return {
        name: target.name,
        distance: target.distance,
        distanceKm: round(target.distance / 1000, 3),
        count: sorted.length,
        median: medianEffort,
        top: sorted
      };
    })
    .filter((distance) => distance.count > 0)
    .sort(compareBestEffortGroups);

  return { activityCount, effortCount, distances };
}

function activityMapFromStore(store) {
  const activityById = new Map();
  for (const activity of store.activities || []) {
    if (activity?.id) activityById.set(String(activity.id), activity);
  }
  for (const detail of (store.detailsById || new Map()).values()) {
    if (detail?.id) activityById.set(String(detail.id), { ...activityById.get(String(detail.id)), ...detail });
  }
  return activityById;
}

function rawStreamIdsFromStore(store) {
  return typeof store.rawStreamIds?.[Symbol.iterator] === "function"
    ? Array.from(store.rawStreamIds)
    : [];
}

function buildRecordKey(recordType, name, activityId, startOffset, endOffset) {
  const type = recordType || "record";
  const targetName = String(name || "");
  const id = String(activityId || "");
  const start = Math.round(Number(startOffset || 0));
  const end = Math.round(Number(endOffset || 0));
  return `${type}|${targetName}|${id}|${start}|${end}`;
}

function distanceBestEffortsForActivity(activity, streams) {
  const series = buildTimeDistanceSeries(streams);
  if (!series) return [];

  return PERSONAL_BEST_DISTANCE_TARGETS
    .map((target) => {
      const best = findBestTimeForDistance(series, target.distance);
      if (!best || best.duration <= 0) return null;
      const distanceKm = target.distance / 1000;
      return {
        effortId: null,
        activityId: activity.id,
        activityName: activity.name || "Untitled",
        startDate: addSecondsToDateString(activity.start_date, best.startOffset),
        startDateLocal: addSecondsToDateString(activity.start_date_local || activity.start_date, best.startOffset),
        name: target.name,
        distance: target.distance,
        distanceKm: round(distanceKm, 3),
        movingTime: best.duration,
        elapsedTime: best.duration,
        paceSecondsPerKm: distanceKm ? best.duration / distanceKm : null,
        startOffset: Math.round(best.startOffset),
        endOffset: Math.round(best.endOffset),
        startIndex: null,
        endIndex: null,
        prRank: null,
        recordKey: buildRecordKey("distance", target.name, activity.id, best.startOffset, best.endOffset),
        recordType: "distance"
      };
    })
    .filter(Boolean);
}

async function timeBestsFromStore(store) {
  const groups = new Map(TIME_BEST_TARGETS.map((target) => [target.name, []]));
  const activityById = activityMapFromStore(store);
  let activityCount = 0;
  let effortCount = 0;

  for (const rawId of rawStreamIdsFromStore(store)) {
    const id = String(rawId);
    const activity = activityById.get(id);
    if (!activity || !isRun(activity)) continue;

    const streams = await readJson(activityDataPath(RAW_STREAMS_DIR, id), null);
    const efforts = timeBestEffortsForActivity(activity, streams);
    if (!efforts.length) continue;

    activityCount += 1;
    for (const effort of efforts) {
      const group = groups.get(effort.name);
      if (!group) continue;
      effortCount += 1;
      group.push(effort);
    }
  }

  const durations = TIME_BEST_TARGETS
    .map((target) => {
      const sorted = (groups.get(target.name) || []).sort(compareTimeBestEfforts);
      const medianEffort = summarizeMedianTimeBestEffort(sorted);
      return {
        name: target.name,
        durationSeconds: target.durationSeconds,
        count: sorted.length,
        median: medianEffort,
        top: sorted
      };
    })
    .filter((duration) => duration.count > 0);

  return { activityCount, effortCount, durations };
}

function timeBestEffortsForActivity(activity, streams) {
  const series = buildTimeDistanceSeries(streams);
  if (!series) return [];

  return TIME_BEST_TARGETS
    .map((target) => {
      const best = findBestDistanceForDuration(series, target.durationSeconds);
      if (!best || best.distance <= 0) return null;
      const distanceKm = best.distance / 1000;
      return {
        activityId: activity.id,
        activityName: activity.name || "Untitled",
        startDate: addSecondsToDateString(activity.start_date, best.startOffset),
        startDateLocal: addSecondsToDateString(activity.start_date_local || activity.start_date, best.startOffset),
        name: target.name,
        durationSeconds: target.durationSeconds,
        distance: best.distance,
        distanceKm: round(distanceKm, 3),
        paceSecondsPerKm: distanceKm ? target.durationSeconds / distanceKm : null,
        startOffset: Math.round(best.startOffset),
        endOffset: Math.round(best.endOffset),
        recordKey: buildRecordKey("duration", target.name, activity.id, best.startOffset, best.endOffset),
        recordType: "duration"
      };
    })
    .filter(Boolean);
}

async function paceBestsFromStore(store) {
  const groups = new Map(PACE_BEST_TARGETS.map((target) => [target.name, []]));
  const activityById = activityMapFromStore(store);
  let activityCount = 0;
  let effortCount = 0;

  for (const rawId of rawStreamIdsFromStore(store)) {
    const id = String(rawId);
    const activity = activityById.get(id);
    if (!activity || !isRun(activity)) continue;

    const streams = await readJson(activityDataPath(RAW_STREAMS_DIR, id), null);
    const efforts = paceBestEffortsForActivity(activity, streams);
    if (!efforts.length) continue;

    activityCount += 1;
    for (const effort of efforts) {
      const group = groups.get(effort.name);
      if (!group) continue;
      effortCount += 1;
      group.push(effort);
    }
  }

  const paces = PACE_BEST_TARGETS
    .map((target) => {
      const sorted = (groups.get(target.name) || []).sort(comparePaceBestEfforts);
      const medianEffort = summarizeMedianPaceBestEffort(sorted);
      return {
        name: target.name,
        paceSecondsPerKm: target.paceSecondsPerKm,
        count: sorted.length,
        median: medianEffort,
        top: sorted
      };
    })
    .filter((pace) => pace.count > 0);

  return { activityCount, effortCount, paces };
}

function paceBestEffortsForActivity(activity, streams) {
  const series = buildTimeDistanceSeries(streams);
  if (!series) return [];

  return PACE_BEST_TARGETS
    .map((target) => {
      const best = findLongestDistanceForPace(series, target.paceSecondsPerKm);
      if (!best || best.duration <= 0 || best.distance <= 0) return null;
      const distanceKm = best.distance / 1000;
      return {
        activityId: activity.id,
        activityName: activity.name || "Untitled",
        startDate: addSecondsToDateString(activity.start_date, best.startOffset),
        startDateLocal: addSecondsToDateString(activity.start_date_local || activity.start_date, best.startOffset),
        name: target.name,
        targetPaceSecondsPerKm: target.paceSecondsPerKm,
        durationSeconds: best.duration,
        movingTime: best.duration,
        distance: best.distance,
        distanceKm: round(distanceKm, 3),
        paceSecondsPerKm: distanceKm ? best.duration / distanceKm : null,
        startOffset: Math.round(best.startOffset),
        endOffset: Math.round(best.endOffset),
        recordKey: buildRecordKey("pace", target.name, activity.id, best.startOffset, best.endOffset),
        recordType: "pace"
      };
    })
    .filter(Boolean);
}

function buildTimeDistanceSeries(streams) {
  const times = streams?.time?.data;
  const distances = streams?.distance?.data;
  if (!Array.isArray(times) || !Array.isArray(distances)) return null;

  const length = Math.min(times.length, distances.length);
  const series = [];
  for (let index = 0; index < length; index += 1) {
    const time = Number(times[index]);
    const distance = Number(distances[index]);
    if (!Number.isFinite(time) || !Number.isFinite(distance)) continue;
    if (time < 0 || distance < 0) continue;
    const previous = series.at(-1);
    if (previous && time <= previous.time) continue;
    series.push({ time, distance });
  }

  return series.length >= 2 ? series : null;
}

function findLongestDistanceForPace(series, paceSecondsPerKm) {
  const targetPace = Number(paceSecondsPerKm);
  if (!Number.isFinite(targetPace) || targetPace <= 0) return null;
  const speedMetersPerSecond = 1000 / targetPace;
  const scored = (series || [])
    .map((point) => ({
      time: Number(point.time),
      distance: Number(point.distance),
      score: Number(point.distance) - speedMetersPerSecond * Number(point.time)
    }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.distance) && Number.isFinite(point.score));
  if (scored.length < 2) return null;

  const sortedScores = Array.from(new Set(scored.map((point) => point.score))).sort((a, b) => a - b);
  const tree = createPaceStartFenwickTree(sortedScores.length, scored);
  let best = null;

  for (let index = 0; index < scored.length; index += 1) {
    const point = scored[index];
    const maxRank = upperBound(sortedScores, point.score);
    const startIndex = tree.query(maxRank);
    if (startIndex !== null && startIndex < index) {
      const start = scored[startIndex];
      const duration = point.time - start.time;
      const distance = point.distance - start.distance;
      if (duration > 0 && distance > 0 && distance >= speedMetersPerSecond * duration) {
        const pace = duration / (distance / 1000);
        const bestPace = best ? best.duration / (best.distance / 1000) : Infinity;
        if (!best ||
          distance > best.distance ||
          (distance === best.distance && pace < bestPace) ||
          (distance === best.distance && pace === bestPace && duration > best.duration) ||
          (distance === best.distance && pace === bestPace && duration === best.duration && start.time < best.startOffset)
        ) {
          best = {
            duration,
            distance,
            startOffset: start.time,
            endOffset: point.time
          };
        }
      }
    }

    const rank = lowerBound(sortedScores, point.score) + 1;
    tree.update(rank, index);
  }

  return best;
}

function createPaceStartFenwickTree(size, points) {
  const values = Array(size + 1).fill(null);
  const isBetterStart = (nextIndex, currentIndex) => {
    if (currentIndex === null) return true;
    const next = points[nextIndex];
    const current = points[currentIndex];
    return next.distance < current.distance ||
      (next.distance === current.distance && next.time < current.time) ||
      (next.distance === current.distance && next.time === current.time && nextIndex < currentIndex);
  };

  return {
    update(index, value) {
      for (let cursor = index; cursor <= size; cursor += cursor & -cursor) {
        if (isBetterStart(value, values[cursor])) values[cursor] = value;
      }
    },
    query(index) {
      let best = null;
      for (let cursor = Math.min(index, size); cursor > 0; cursor -= cursor & -cursor) {
        const value = values[cursor];
        if (value !== null && isBetterStart(value, best)) best = value;
      }
      return best;
    }
  };
}

function lowerBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function findBestDistanceForDuration(series, durationSeconds) {
  const targetDuration = Number(durationSeconds);
  if (!Number.isFinite(targetDuration) || targetDuration <= 0) return null;
  const firstTime = series[0].time;
  const lastTime = series.at(-1).time;
  if (lastTime - firstTime < targetDuration) return null;

  const seen = new Set();
  let best = null;
  const considerStart = (startTime) => {
    const roundedStart = Number(startTime.toFixed(3));
    if (seen.has(roundedStart)) return;
    seen.add(roundedStart);

    const endTime = startTime + targetDuration;
    if (startTime < firstTime || endTime > lastTime) return;
    const startDistance = interpolateDistanceAtTime(series, startTime);
    const endDistance = interpolateDistanceAtTime(series, endTime);
    if (!Number.isFinite(startDistance) || !Number.isFinite(endDistance)) return;
    const distance = endDistance - startDistance;
    if (distance <= 0) return;
    if (!best || distance > best.distance || (distance === best.distance && startTime < best.startOffset)) {
      best = {
        distance,
        startOffset: startTime,
        endOffset: endTime
      };
    }
  };

  for (const point of series) {
    considerStart(point.time);
    considerStart(point.time - targetDuration);
  }

  return best;
}

function findBestTimeForDistance(series, distanceMeters) {
  const targetDistance = Number(distanceMeters);
  if (!Number.isFinite(targetDistance) || targetDistance <= 0) return null;

  const distanceSeries = buildDistanceTimeSeries(series);
  if (!distanceSeries) return null;

  const firstDistance = distanceSeries[0].distance;
  const lastDistance = distanceSeries.at(-1).distance;
  if (lastDistance - firstDistance < targetDistance) return null;

  const seen = new Set();
  let best = null;
  const considerStartDistance = (startDistance) => {
    const roundedStart = Number(startDistance.toFixed(3));
    if (seen.has(roundedStart)) return;
    seen.add(roundedStart);

    const endDistance = startDistance + targetDistance;
    if (startDistance < firstDistance || endDistance > lastDistance) return;
    const startTime = interpolateTimeAtDistance(distanceSeries, startDistance);
    const endTime = interpolateTimeAtDistance(distanceSeries, endDistance);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return;
    const duration = endTime - startTime;
    if (duration <= 0) return;
    if (!best || duration < best.duration || (duration === best.duration && startTime < best.startOffset)) {
      best = {
        duration,
        startOffset: startTime,
        endOffset: endTime
      };
    }
  };

  for (const point of distanceSeries) {
    considerStartDistance(point.distance);
    considerStartDistance(point.distance - targetDistance);
  }

  return best;
}

function buildDistanceTimeSeries(series) {
  const distanceSeries = [];
  for (const point of series || []) {
    const time = Number(point?.time);
    const distance = Number(point?.distance);
    if (!Number.isFinite(time) || !Number.isFinite(distance)) continue;
    const previous = distanceSeries.at(-1);
    if (previous && distance <= previous.distance) continue;
    distanceSeries.push({ time, distance });
  }
  return distanceSeries.length >= 2 ? distanceSeries : null;
}

function interpolateDistanceAtTime(series, targetTime) {
  if (targetTime <= series[0].time) return series[0].distance;
  const last = series.at(-1);
  if (targetTime >= last.time) return last.distance;

  let low = 0;
  let high = series.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (series[middle].time < targetTime) low = middle + 1;
    else high = middle;
  }

  const upper = series[low];
  if (upper.time === targetTime) return upper.distance;
  const lower = series[low - 1];
  const span = upper.time - lower.time;
  if (span <= 0) return lower.distance;
  const ratio = (targetTime - lower.time) / span;
  return lower.distance + (upper.distance - lower.distance) * ratio;
}

function interpolateTimeAtDistance(series, targetDistance) {
  if (targetDistance <= series[0].distance) return series[0].time;
  const last = series.at(-1);
  if (targetDistance >= last.distance) return last.time;

  let low = 0;
  let high = series.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (series[middle].distance < targetDistance) low = middle + 1;
    else high = middle;
  }

  const upper = series[low];
  if (upper.distance === targetDistance) return upper.time;
  const lower = series[low - 1];
  const span = upper.distance - lower.distance;
  if (span <= 0) return lower.time;
  const ratio = (targetDistance - lower.distance) / span;
  return lower.time + (upper.time - lower.time) * ratio;
}

function compareTimeBestEfforts(a, b) {
  return b.distance - a.distance ||
    a.paceSecondsPerKm - b.paceSecondsPerKm ||
    new Date(a.startDate || 0) - new Date(b.startDate || 0);
}

function comparePaceBestEfforts(a, b) {
  return b.distance - a.distance ||
    a.paceSecondsPerKm - b.paceSecondsPerKm ||
    b.durationSeconds - a.durationSeconds ||
    new Date(a.startDate || 0) - new Date(b.startDate || 0);
}

function summarizeMedianTimeBestEffort(efforts) {
  if (!efforts.length) return null;
  const durationSeconds = Number(efforts[0]?.durationSeconds || 0);
  const distance = medianNumber(efforts.map((effort) => effort.distance));
  const distanceKm = Number.isFinite(distance) ? distance / 1000 : null;
  const paceSecondsPerKm = distanceKm && durationSeconds
    ? durationSeconds / distanceKm
    : medianNumber(efforts.map((effort) => effort.paceSecondsPerKm));
  if (!durationSeconds || !Number.isFinite(distance) || !Number.isFinite(paceSecondsPerKm)) return null;
  return {
    count: efforts.length,
    durationSeconds,
    distance,
    distanceKm: round(distanceKm, 3),
    paceSecondsPerKm
  };
}

function summarizeMedianPaceBestEffort(efforts) {
  if (!efforts.length) return null;
  const targetPaceSecondsPerKm = Number(efforts[0]?.targetPaceSecondsPerKm || efforts[0]?.paceSecondsPerKm || 0);
  const durationSeconds = medianNumber(efforts.map((effort) => effort.durationSeconds));
  const distance = medianNumber(efforts.map((effort) => effort.distance));
  const distanceKm = Number.isFinite(distance) ? distance / 1000 : null;
  const paceSecondsPerKm = distanceKm && Number.isFinite(durationSeconds)
    ? durationSeconds / distanceKm
    : medianNumber(efforts.map((effort) => effort.paceSecondsPerKm));
  if (!Number.isFinite(durationSeconds) || !Number.isFinite(distance) || !Number.isFinite(paceSecondsPerKm)) return null;
  return {
    count: efforts.length,
    targetPaceSecondsPerKm,
    durationSeconds,
    movingTime: durationSeconds,
    distance,
    distanceKm: round(distanceKm, 3),
    paceSecondsPerKm
  };
}

function addSecondsToDateString(value, seconds) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + Math.round(seconds) * 1000).toISOString();
}

function comparePersonalBestEfforts(a, b) {
  return a.movingTime - b.movingTime ||
    a.elapsedTime - b.elapsedTime ||
    new Date(a.startDate || 0) - new Date(b.startDate || 0);
}

function summarizeMedianPersonalBestEffort(efforts) {
  if (!efforts.length) return null;
  const distanceKm = Number(efforts[0]?.distanceKm || 0);
  const movingTime = medianNumber(efforts.map((effort) => effort.movingTime));
  const elapsedTime = medianNumber(efforts.map((effort) => effort.elapsedTime));
  const paceSecondsPerKm = distanceKm && Number.isFinite(movingTime)
    ? movingTime / distanceKm
    : medianNumber(efforts.map((effort) => effort.paceSecondsPerKm));

  if (!Number.isFinite(movingTime) || !Number.isFinite(paceSecondsPerKm)) return null;
  return {
    count: efforts.length,
    distance: efforts[0]?.distance || null,
    distanceKm: distanceKm || null,
    movingTime,
    elapsedTime: Number.isFinite(elapsedTime) ? elapsedTime : movingTime,
    paceSecondsPerKm
  };
}

function medianNumber(values) {
  const sorted = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function compareBestEffortGroups(a, b) {
  const aPreferred = PREFERRED_BEST_EFFORT_ORDER.indexOf(a.name);
  const bPreferred = PREFERRED_BEST_EFFORT_ORDER.indexOf(b.name);
  if (aPreferred !== -1 || bPreferred !== -1) {
    if (aPreferred === -1) return 1;
    if (bPreferred === -1) return -1;
    return aPreferred - bPreferred;
  }
  return Number(a.distance || 0) - Number(b.distance || 0) || a.name.localeCompare(b.name);
}

function isRun(activity) {
  const type = activity.sport_type || activity.type;
  return type === "Run" || type === "TrailRun" || type === "VirtualRun";
}

async function parseJsonBody(req) {
  assertJsonRequest(req);
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of req) {
    byteLength += chunk.length;
    if (byteLength > JSON_BODY_LIMIT_BYTES) {
      const error = new Error("JSON request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function assertJsonRequest(req) {
  const contentType = getHeader(req, "content-type");
  if (contentType && contentType.toLowerCase().includes("application/json")) return;

  const error = new Error("Expected application/json request body.");
  error.statusCode = 415;
  throw error;
}

function getHeader(req, name) {
  const headers = req.headers || {};
  const lowerName = name.toLowerCase();
  return headers[lowerName] || headers[name] || "";
}

function assertTrustedRequest(req) {
  if (!isAllowedHostHeader(getHeader(req, "host"))) {
    const error = new Error("Forbidden host.");
    error.statusCode = 403;
    throw error;
  }

  if (!isStateChangingMethod(req.method)) return;

  const origin = getHeader(req, "origin");
  if (origin && !isAllowedLocalOrigin(origin)) {
    const error = new Error("Forbidden origin.");
    error.statusCode = 403;
    throw error;
  }

  const referer = getHeader(req, "referer");
  if (!origin && referer && !isAllowedLocalOrigin(referer)) {
    const error = new Error("Forbidden referer.");
    error.statusCode = 403;
    throw error;
  }

  if (String(req.url || "").startsWith("/api/") && getHeader(req, "x-runasis-csrf") !== csrfToken) {
    const error = new Error("Missing CSRF token.");
    error.statusCode = 403;
    throw error;
  }
}

function isStateChangingMethod(method) {
  return !["GET", "HEAD", "OPTIONS"].includes(String(method || "GET").toUpperCase());
}

function isAllowedHostHeader(hostHeader) {
  const parsed = parseLocalUrlHost(hostHeader);
  if (!parsed || !isLoopbackHostname(parsed.hostname)) return false;
  return !parsed.port || Number(parsed.port) === activePort;
}

function isAllowedLocalOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" &&
      isLoopbackHostname(url.hostname) &&
      (!url.port || Number(url.port) === activePort);
  } catch {
    return false;
  }
}

function parseLocalUrlHost(hostHeader) {
  if (!hostHeader) return null;
  try {
    const url = new URL(`http://${hostHeader}`);
    return {
      hostname: normalizeHostname(url.hostname),
      port: url.port
    };
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname) {
  const normalized = normalizeHostname(hostname);
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function normalizeHostname(hostname) {
  return String(hostname || "").trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

function cleanupStates() {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [state, createdAt] of authStates) {
    if (createdAt < cutoff) authStates.delete(state);
  }
}

function buildStravaAuthorizeUrl(scope) {
  const config = getConfig();
  const state = crypto.randomBytes(16).toString("hex");
  cleanupStates();
  authStates.set(state, Date.now());

  const url = new URL("https://www.strava.com/oauth/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("scope", scope);
  url.searchParams.set("state", state);
  return url.toString();
}

async function stravaTokenRequest(params) {
  const config = getConfig();
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    ...params
  });

  const response = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.message || payload.error || `Strava token request failed with ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

async function ensureAccessToken(store) {
  if (!store.token?.refresh_token) {
    const error = new Error("Strava account is not connected.");
    error.statusCode = 401;
    throw error;
  }

  const now = Math.floor(Date.now() / 1000);
  if (store.token.access_token && store.token.expires_at && store.token.expires_at > now + 300) {
    return { store, accessToken: store.token.access_token };
  }

  const refreshed = await stravaTokenRequest({
    grant_type: "refresh_token",
    refresh_token: store.token.refresh_token
  });

  const nextStore = await writeStore({
    ...store,
    token: {
      token_type: refreshed.token_type || store.token.token_type || "Bearer",
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: refreshed.expires_at,
      expires_in: refreshed.expires_in
    }
  });

  return { store: nextStore, accessToken: refreshed.access_token };
}

async function fetchActivitiesPage(accessToken, { page, after, before }) {
  const url = new URL("https://www.strava.com/api/v3/athlete/activities");
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", "200");
  if (after) url.searchParams.set("after", String(after));
  if (before) url.searchParams.set("before", String(before));

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.message || payload.error || `Strava activities request failed with ${response.status}`;
    throw new Error(message);
  }
  if (!Array.isArray(payload)) {
    throw new Error("Strava returned an unexpected activities payload.");
  }
  return payload;
}

async function fetchDetailedActivity(accessToken, id) {
  const url = new URL(`https://www.strava.com/api/v3/activities/${id}`);
  url.searchParams.set("include_all_efforts", "true");

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.message || payload.error || `Strava activity detail request failed with ${response.status}`;
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Strava returned an unexpected activity detail payload.");
  }
  return payload;
}

async function fetchActivityStreams(accessToken, id) {
  const url = new URL(`https://www.strava.com/api/v3/activities/${id}/streams`);
  url.searchParams.set("keys", ACTIVITY_STREAM_KEYS.join(","));
  url.searchParams.set("key_by_type", "true");

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.message || payload.error || `Strava activity streams request failed with ${response.status}`;
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("Strava returned an unexpected activity streams payload.");
  }
  return payload;
}

function mergeActivities(existing, fetched) {
  const map = new Map();
  for (const activity of existing) map.set(String(activity.id), activity);
  let inserted = 0;
  let updated = 0;

  for (const activity of fetched.map(sanitizeActivity)) {
    const key = String(activity.id);
    if (map.has(key)) updated += 1;
    else inserted += 1;
    map.set(key, { ...map.get(key), ...activity });
  }

  const activities = Array.from(map.values()).sort((a, b) => {
    return new Date(b.start_date || 0) - new Date(a.start_date || 0);
  });

  return { activities, inserted, updated };
}

async function syncActivities(options = {}) {
  let store = await readStore();
  const tokenResult = await ensureAccessToken(store);
  store = tokenResult.store;

  const after = normalizeEpoch(options.after);
  const before = normalizeEpoch(options.before);
  const fetched = [];
  let page = 1;

  while (page <= MAX_SYNC_PAGES) {
    const activities = await fetchActivitiesPage(tokenResult.accessToken, { page, after, before });
    if (!activities.length) break;
    fetched.push(...activities);
    page += 1;
  }

  const merged = mergeActivities(store.activities, fetched);
  const summary = {
    fetched: fetched.length,
    inserted: merged.inserted,
    updated: merged.updated,
    total: merged.activities.length,
    pagesRead: page - 1,
    after: after || null,
    before: before || null,
    syncedAt: new Date().toISOString()
  };

  store = await writeStore({
    ...store,
    activities: merged.activities,
    lastSyncAt: summary.syncedAt,
    lastSyncSummary: summary
  });

  return { summary, status: statusFromStore(store) };
}

async function syncActivityDetails(options = {}) {
  let store = await readStore();
  const tokenResult = await ensureAccessToken(store);
  store = tokenResult.store;

  const requestedLimit = normalizePositiveInteger(options.limit);
  const limit = requestedLimit ? Math.min(requestedLimit, MAX_DETAIL_SYNC_ACTIVITIES) : MAX_DETAIL_SYNC_ACTIVITIES;
  const detailsById = new Map(store.detailsById || []);
  const rawDetailIds = new Set(store.rawDetailIds || []);
  const rawStreamIds = new Set(store.rawStreamIds || []);
  const pendingRuns = store.activities
    .filter((activity) => {
      const id = String(activity.id);
      return isRun(activity) && needsActivityDataSync(id, detailsById, rawDetailIds, rawStreamIds);
    })
    .sort((a, b) => new Date(b.start_date || 0) - new Date(a.start_date || 0));
  const selected = pendingRuns.slice(0, limit);
  const syncedAt = new Date().toISOString();
  const errors = [];
  const streamErrors = [];
  let fetched = 0;
  let rawBackfilled = 0;
  let rawStreamsFetched = 0;
  let attempted = 0;
  let stoppedReason = null;

  for (const activity of selected) {
    attempted += 1;
    const id = String(activity.id);
    const alreadyHadDetail = isSuccessfulActivityDetail(detailsById.get(id));
    const alreadyHadRawDetail = rawDetailIds.has(id);
    const needsDetail = !alreadyHadDetail || !alreadyHadRawDetail;
    const needsStream = !rawStreamIds.has(id);
    let detailReady = alreadyHadDetail;

    if (needsDetail) {
      try {
        const detail = await fetchDetailedActivity(tokenResult.accessToken, activity.id);
        await writeRawActivityDetail(activity.id, detail);
        rawDetailIds.add(id);
        const sanitized = sanitizeActivityDetails(detail, syncedAt);
        await writeActivityDetail(activity.id, sanitized);
        detailsById.set(id, sanitized);
        detailReady = true;
        if (alreadyHadDetail && !alreadyHadRawDetail) rawBackfilled += 1;
        else fetched += 1;
      } catch (error) {
        if (error.statusCode === 429) {
          stoppedReason = "rate_limited";
          break;
        }

        const failure = sanitizeActivityDetailError(activity, error, syncedAt);
        await writeActivityDetail(activity.id, failure);
        detailsById.set(id, failure);
        detailReady = false;

        errors.push({
          id: activity.id,
          statusCode: error.statusCode || null,
          message: error.message || "Activity detail fetch failed"
        });
      }
    }

    if (needsStream && detailReady) {
      try {
        const streams = await fetchActivityStreams(tokenResult.accessToken, activity.id);
        await writeRawActivityStream(activity.id, streams);
        rawStreamIds.add(id);
        rawStreamsFetched += 1;
      } catch (error) {
        if (error.statusCode === 429) {
          stoppedReason = "rate_limited";
          break;
        }

        streamErrors.push({
          id: activity.id,
          statusCode: error.statusCode || null,
          message: error.message || "Activity streams fetch failed"
        });
      }
    }
  }

  const remainingDetails = store.activities.filter((activity) => {
    const id = String(activity.id);
    return isRun(activity) && (!isSuccessfulActivityDetail(detailsById.get(id)) || !rawDetailIds.has(id));
  }).length;
  const remainingRawStreams = store.activities.filter((activity) => {
    const id = String(activity.id);
    return isRun(activity) && !rawStreamIds.has(id);
  }).length;
  const remaining = store.activities.filter((activity) => {
    const id = String(activity.id);
    return isRun(activity) && needsActivityDataSync(id, detailsById, rawDetailIds, rawStreamIds);
  }).length;
  const summary = {
    requested: selected.length,
    attempted,
    fetched,
    rawBackfilled,
    rawStreamsFetched,
    failed: errors.length,
    streamFailed: streamErrors.length,
    skippedAlreadyFetched: store.activities.filter((activity) => {
      const id = String(activity.id);
      return isRun(activity)
        && isSuccessfulActivityDetail((store.detailsById || new Map()).get(id))
        && rawDetailIds.has(id)
        && rawStreamIds.has(id);
    }).length,
    skippedFailed: store.activities.filter((activity) => isRun(activity) && isFailedActivityDetail((store.detailsById || new Map()).get(String(activity.id)))).length,
    remaining,
    remainingDetails,
    remainingRawStreams,
    limit,
    stoppedReason,
    errors: errors.slice(0, 10),
    streamErrors: streamErrors.slice(0, 10),
    syncedAt
  };

  store = await writeStore({
    ...store,
    detailsById,
    rawDetailIds,
    rawStreamIds,
    lastDetailSyncAt: syncedAt,
    lastDetailSyncSummary: summary
  });

  return { summary, status: statusFromStore(store) };
}

function needsActivityDataSync(id, detailsById, rawDetailIds, rawStreamIds) {
  return !isSuccessfulActivityDetail(detailsById.get(id)) || !rawDetailIds.has(id) || !rawStreamIds.has(id);
}

async function refreshActivityDetail(activityId) {
  const id = normalizeActivityId(activityId);
  let store = await readStore();
  const activity = (store.activities || []).find((item) => String(item.id) === id);
  if (!activity) {
    const error = new Error("Activity is not in the saved activity list.");
    error.statusCode = 404;
    throw error;
  }
  if (!isRun(activity)) {
    const error = new Error("Only saved runs can refresh best-effort details.");
    error.statusCode = 400;
    throw error;
  }

  const tokenResult = await ensureAccessToken(store);
  store = tokenResult.store;

  const syncedAt = new Date().toISOString();
  const detail = await fetchDetailedActivity(tokenResult.accessToken, id);
  await writeRawActivityDetail(id, detail);
  const sanitized = sanitizeActivityDetails(detail, syncedAt);
  await writeActivityDetail(id, sanitized);
  let rawStreamsFetched = 0;
  let streamError = null;
  try {
    const streams = await fetchActivityStreams(tokenResult.accessToken, id);
    await writeRawActivityStream(id, streams);
    rawStreamsFetched = 1;
  } catch (error) {
    streamError = {
      statusCode: error.statusCode || null,
      message: error.message || "Activity streams fetch failed"
    };
  }

  const detailsById = new Map(store.detailsById || []);
  const rawDetailIds = new Set(store.rawDetailIds || []);
  const rawStreamIds = new Set(store.rawStreamIds || []);
  detailsById.set(id, sanitized);
  rawDetailIds.add(id);
  if (rawStreamsFetched) rawStreamIds.add(id);
  const merged = mergeActivities(store.activities, [sanitized]);
  const summary = {
    activityId: id,
    refreshed: 1,
    rawStreamsFetched,
    streamFailed: streamError ? 1 : 0,
    streamErrors: streamError ? [streamError] : [],
    syncedAt
  };

  store = await writeStore({
    ...store,
    activities: merged.activities,
    detailsById,
    rawDetailIds,
    rawStreamIds,
    lastDetailSyncAt: syncedAt,
    lastDetailSyncSummary: summary
  });

  return { summary, status: statusFromStore(store) };
}

function normalizeEpoch(value) {
  if (!value) return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor(date.getTime() / 1000);
}

function normalizePositiveInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.floor(number);
}

async function handleAuthStart(req, res, url) {
  const config = getConfig();
  if (!config.configured) {
    return redirect(res, "/?auth=missing_config");
  }

  const requestedScope = url.searchParams.get("scope") || "activity:read_all";
  const allowedScopes = new Set(["activity:read", "activity:read_all"]);
  const scopes = requestedScope
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => allowedScopes.has(scope));
  const scope = scopes.length ? scopes.join(",") : "activity:read_all";
  redirect(res, buildStravaAuthorizeUrl(scope));
}

async function handleAuthCallback(req, res, url) {
  const error = url.searchParams.get("error");
  if (error) {
    return redirect(res, `/?auth=denied&reason=${encodeURIComponent(error)}`);
  }

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !authStates.has(state)) {
    return redirect(res, "/?auth=invalid_state");
  }
  authStates.delete(state);

  if (!code) {
    return redirect(res, "/?auth=missing_code");
  }

  try {
    const token = await stravaTokenRequest({
      grant_type: "authorization_code",
      code
    });
    const scope = url.searchParams.get("scope") || token.scope || "";
    const store = await readStore();
    await writeStore({
      ...store,
      athlete: token.athlete || store.athlete,
      scopes: scope.split(/[,\s]+/).filter(Boolean),
      token: {
        token_type: token.token_type || "Bearer",
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: token.expires_at,
        expires_in: token.expires_in
      }
    });
    return redirect(res, "/?auth=connected");
  } catch (err) {
    return redirect(res, `/?auth=token_error&reason=${encodeURIComponent(err.message)}`);
  }
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/status" && req.method === "GET") {
    const store = await readStore();
    return sendJson(res, 200, statusFromStore(store));
  }

  if (url.pathname === "/api/activities" && req.method === "GET") {
    const store = await readStore();
    const detailsById = store.detailsById || new Map();
    return sendJson(res, 200, {
      activities: store.activities.map((activity) => activityListItemFromStore(activity, detailsById)),
      status: statusFromStore(store)
    });
  }

  if (url.pathname === "/api/personal-bests" && req.method === "GET") {
    const store = await readStore();
    const includeExcluded = url.searchParams.get("includeExcluded") === "true" || url.searchParams.get("includeExcluded") === "1";
    return sendJson(res, 200, await personalBestsFromStore(store, { includeExcluded }));
  }

  if (url.pathname === "/api/excluded-records" && req.method === "POST") {
    const body = await parseJsonBody(req);
    return sendJson(res, 200, await setRecordExcluded(body.recordKey, body.excluded));
  }

  if (url.pathname === "/api/config/strava" && req.method === "POST") {
    await saveStravaConfig(await parseJsonBody(req));
    const store = await readStore();
    return sendJson(res, 200, {
      ok: true,
      status: statusFromStore(store)
    });
  }

  if (url.pathname === "/api/sync" && req.method === "POST") {
    const body = await parseJsonBody(req);
    const result = await syncActivities(body);
    return sendJson(res, 200, result);
  }

  if (url.pathname === "/api/activity-details/sync" && req.method === "POST") {
    const body = await parseJsonBody(req);
    const result = await syncActivityDetails(body);
    return sendJson(res, 200, result);
  }

  if (url.pathname === "/api/activity-details/refresh" && req.method === "POST") {
    const body = await parseJsonBody(req);
    const result = await refreshActivityDetail(body.activityId);
    return sendJson(res, 200, result);
  }

  if (url.pathname === "/api/data" && req.method === "DELETE") {
    await clearStore();
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: "Not found" });
}

function round(value, digits) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return Number(number.toFixed(digits));
}

async function serveStatic(req, res, url) {
  const filePath = resolveStaticFilePath(url.pathname);

  try {
    const body = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { "content-type": contentTypes[ext] || "application/octet-stream" });
    res.end(body);
  } catch (error) {
    if (error.code === "ENOENT") return sendText(res, 404, "Not found");
    throw error;
  }
}

function resolveStaticFilePath(urlPathname) {
  const pathname = decodeURIComponent(urlPathname === "/" ? "/index.html" : urlPathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  const relative = path.relative(PUBLIC_DIR, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    const error = new Error("Forbidden");
    error.statusCode = 403;
    throw error;
  }
  return filePath;
}

async function handleRequest(req, res) {
  req.headers = req.headers || {};
  let url;
  try {
    assertTrustedRequest(req);
    url = new URL(req.url, `http://${req.headers.host || `localhost:${activePort}`}`);
    if (url.pathname === "/auth/strava/start") return await handleAuthStart(req, res, url);
    if (url.pathname === "/auth/strava/callback") return await handleAuthCallback(req, res, url);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error(error);
    if ((url?.pathname || req.url || "").startsWith("/api/")) {
      return sendJson(res, statusCode, { error: error.message || "Internal server error" });
    }
    return sendText(res, statusCode, error.message || "Internal server error");
  }
}

function startServer(port, attemptsLeft = 20) {
  activePort = port;
  const server = http.createServer(handleRequest);
  server.listen(port, HOST);

  server.once("listening", () => {
    const config = getConfig();
    console.log(`Runasis is running at http://localhost:${port}`);
    console.log(`Strava redirect URI: ${config.redirectUri}`);
    if (port !== REQUESTED_PORT) {
      console.log(`Port ${REQUESTED_PORT} was unavailable, so Runasis used ${port}.`);
    }
    if (!config.configured) {
      console.log("Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in .env to connect Strava.");
    }
    if (config.redirectUri && !config.redirectUri.includes(`:${port}/`)) {
      console.log("STRAVA_REDIRECT_URI is set manually; make sure it matches the running port.");
    }
  });

  server.once("error", (error) => {
    const canRetry = !STRICT_PORT && attemptsLeft > 0 && (error.code === "EADDRINUSE" || error.code === "EACCES");
    if (!canRetry) {
      console.error(`Could not start Runasis on ${HOST}:${port}.`);
      console.error(error.message);
      process.exit(1);
    }
    startServer(port + 1, attemptsLeft - 1);
  });
}

startServer(REQUESTED_PORT);
