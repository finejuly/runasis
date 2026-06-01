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
const DERIVED_DIR = path.join(STRAVA_DATA_DIR, "derived");

loadEnvFile();

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const JSON_BODY_LIMIT_BYTES = 64 * 1024;
const REQUESTED_PORT = Number(process.env.PORT || 3000);
const HOST = resolveHost(process.env.HOST || "127.0.0.1");
const STRICT_PORT = process.env.STRICT_PORT === "1";
let activePort = REQUESTED_PORT;
const MAX_SYNC_PAGES = Number(process.env.STRAVA_MAX_SYNC_PAGES || 200);
const MAX_DETAIL_SYNC_ACTIVITIES = normalizePositiveInteger(process.env.STRAVA_MAX_DETAIL_SYNC_ACTIVITIES) || 80;
const PREFERRED_BEST_EFFORT_ORDER = [
  "400m",
  "1/2 mile",
  "1K",
  "1 mile",
  "2 mile",
  "5K",
  "10K",
  "15K",
  "10 mile",
  "20K",
  "Half-Marathon",
  "30K",
  "Marathon",
  "50K"
];

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

  const [auth, syncState, activityIndex, detailsById] = await Promise.all([
    readJson(AUTH_PATH, emptyAuthStore()),
    readJson(SYNC_STATE_PATH, emptySyncState()),
    readJson(ACTIVITIES_INDEX_PATH, emptyActivityIndex()),
    readActivityDataMap(DETAILS_DIR)
  ]);

  return buildStore({ auth, syncState, activityIndex, detailsById });
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
    detailsById: store.detailsById || new Map()
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

function buildStore({ auth, syncState, activityIndex, detailsById }) {
  return {
    schemaVersion: 2,
    athlete: auth.athlete || null,
    token: auth.token || null,
    scopes: auth.scopes || [],
    activities: Array.isArray(activityIndex.activities) ? activityIndex.activities : [],
    detailsById: detailsById || new Map(),
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
  const directories = [DATA_DIR, STRAVA_DATA_DIR, ACTIVITIES_DIR, DETAILS_DIR, DERIVED_DIR];
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
  const records = runs
    .map((activity) => detailsById.get(String(activity.id)))
    .filter(Boolean);
  const fetched = records.filter(isSuccessfulActivityDetail);
  const failed = records.filter(isFailedActivityDetail);
  const bestEffortActivities = fetched.filter((activity) => Array.isArray(activity.best_efforts) && activity.best_efforts.length > 0);
  const bestEffortCount = fetched.reduce((total, activity) => total + (Array.isArray(activity.best_efforts) ? activity.best_efforts.length : 0), 0);
  return {
    runCount: runs.length,
    fetchedRunCount: fetched.length,
    failedRunCount: failed.length,
    pendingRunCount: runs.length - fetched.length,
    bestEffortActivityCount: bestEffortActivities.length,
    bestEffortCount
  };
}

function isSuccessfulActivityDetail(detail) {
  return Boolean(detail && !isFailedActivityDetail(detail));
}

function isFailedActivityDetail(detail) {
  return Boolean(detail?.details_fetch_failed_at || detail?.details_fetch_error);
}

async function personalBestsFromStore(store) {
  const groups = new Map();
  let effortCount = 0;
  let detailActivityCount = 0;

  for (const detail of (store.detailsById || new Map()).values()) {
    if (!isRun(detail) || !Array.isArray(detail.best_efforts)) continue;
    detailActivityCount += 1;

    for (const effort of detail.best_efforts) {
      const distance = Number(effort.distance || 0);
      const movingTime = Number(effort.moving_time || 0);
      if (!distance || !movingTime) continue;

      const name = effort.name || `${round(distance / 1000, 3)}K`;
      if (!groups.has(name)) groups.set(name, []);
      effortCount += 1;
      groups.get(name).push({
        effortId: effort.id || null,
        activityId: detail.id,
        activityName: detail.name || "Untitled",
        startDate: effort.start_date || detail.start_date || null,
        startDateLocal: effort.start_date_local || detail.start_date_local || null,
        name,
        distance,
        distanceKm: round(distance / 1000, 3),
        movingTime,
        elapsedTime: Number(effort.elapsed_time || movingTime),
        paceSecondsPerKm: distance ? movingTime / (distance / 1000) : null,
        startIndex: effort.start_index ?? null,
        endIndex: effort.end_index ?? null,
        prRank: effort.pr_rank ?? null
      });
    }
  }

  const distances = Array.from(groups.entries())
    .map(([name, efforts]) => {
      const sorted = efforts.sort(comparePersonalBestEfforts);
      const medianEffort = summarizeMedianPersonalBestEffort(sorted);
      return {
        name,
        distance: sorted[0]?.distance || null,
        distanceKm: sorted[0]?.distanceKm || null,
        count: efforts.length,
        median: medianEffort,
        top: sorted.slice(0, 20)
      };
    })
    .sort(compareBestEffortGroups);

  const payload = {
    generatedAt: new Date().toISOString(),
    detailActivityCount,
    effortCount,
    distanceCount: distances.length,
    distances
  };

  await writeJsonAtomic(path.join(DERIVED_DIR, "personal-bests.json"), payload);
  return payload;
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
  const pendingRuns = store.activities
    .filter((activity) => isRun(activity) && !isSuccessfulActivityDetail(detailsById.get(String(activity.id))))
    .sort((a, b) => new Date(b.start_date || 0) - new Date(a.start_date || 0));
  const selected = pendingRuns.slice(0, limit);
  const syncedAt = new Date().toISOString();
  const errors = [];
  let fetched = 0;
  let attempted = 0;
  let stoppedReason = null;

  for (const activity of selected) {
    attempted += 1;
    try {
      const detail = await fetchDetailedActivity(tokenResult.accessToken, activity.id);
      const sanitized = sanitizeActivityDetails(detail, syncedAt);
      await writeActivityDetail(activity.id, sanitized);
      detailsById.set(String(activity.id), sanitized);
      fetched += 1;
    } catch (error) {
      if (error.statusCode === 429) {
        stoppedReason = "rate_limited";
        break;
      }

      const failure = sanitizeActivityDetailError(activity, error, syncedAt);
      await writeActivityDetail(activity.id, failure);
      detailsById.set(String(activity.id), failure);

      errors.push({
        id: activity.id,
        statusCode: error.statusCode || null,
        message: error.message || "Activity detail fetch failed"
      });
    }
  }

  const remaining = store.activities.filter((activity) => isRun(activity) && !isSuccessfulActivityDetail(detailsById.get(String(activity.id)))).length;
  const summary = {
    requested: selected.length,
    attempted,
    fetched,
    failed: errors.length,
    skippedAlreadyFetched: store.activities.filter((activity) => isRun(activity) && isSuccessfulActivityDetail((store.detailsById || new Map()).get(String(activity.id)))).length,
    skippedFailed: store.activities.filter((activity) => isRun(activity) && isFailedActivityDetail((store.detailsById || new Map()).get(String(activity.id)))).length,
    remaining,
    limit,
    stoppedReason,
    errors: errors.slice(0, 10),
    syncedAt
  };

  store = await writeStore({
    ...store,
    detailsById,
    lastDetailSyncAt: syncedAt,
    lastDetailSyncSummary: summary
  });

  return { summary, status: statusFromStore(store) };
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
  const sanitized = sanitizeActivityDetails(detail, syncedAt);
  await writeActivityDetail(id, sanitized);

  const detailsById = new Map(store.detailsById || []);
  detailsById.set(id, sanitized);
  const merged = mergeActivities(store.activities, [sanitized]);
  const summary = {
    activityId: id,
    refreshed: 1,
    syncedAt
  };

  store = await writeStore({
    ...store,
    activities: merged.activities,
    detailsById,
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
    return sendJson(res, 200, {
      activities: store.activities,
      status: statusFromStore(store)
    });
  }

  if (url.pathname === "/api/personal-bests" && req.method === "GET") {
    const store = await readStore();
    return sendJson(res, 200, await personalBestsFromStore(store));
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
