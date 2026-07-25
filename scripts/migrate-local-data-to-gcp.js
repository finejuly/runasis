"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { createGcpRepository } = require("../lib/gcp-repository");

const root = path.resolve(__dirname, "..");
const stravaRoot = path.join(root, "data", "strava");
const apply = process.argv.includes("--apply");

main().catch((error) => {
  console.error(`Migration failed: ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const input = await inspectLocalData();
  printSummary(input);
  if (!apply) {
    console.log("Dry run only. Re-run with --apply after configuring Google application credentials.");
    return;
  }

  const repository = createGcpRepository();
  await repository.writeSnapshot({
    auth: input.auth,
    syncState: input.syncState,
    activityIndex: input.activityIndex
  });

  await mapWithConcurrency(input.details, 8, async (file) => {
    await repository.writeActivityDetail(file.id, await readJson(file.path, null));
  });
  await mapWithConcurrency(input.rawDetails, 4, async (file) => {
    await repository.writeRawActivityDetail(file.id, await readJson(file.path, null));
  });
  await mapWithConcurrency(input.rawStreams, 4, async (file) => {
    await repository.writeRawActivityStream(file.id, await readJson(file.path, null));
  });
  if (input.personalBests) {
    await repository.writePersonalBestsCache(input.personalBests);
  }
  if (input.excludedRecords) {
    await repository.writeExcludedRecords(input.excludedRecords);
  }

  const saved = await repository.readSnapshot({
    auth: {},
    syncState: {},
    activityIndex: { activities: [] }
  });
  const savedActivityIds = new Set(saved.activityIndex.activities.map((activity) => String(activity.id)));
  const checks = {
    activities: input.activityIndex.activities.every((activity) => savedActivityIds.has(String(activity.id))),
    details: input.details.every((file) => saved.detailsById.has(file.id)),
    rawDetails: input.rawDetails.every((file) => saved.rawDetailIds.has(file.id)),
    rawStreams: input.rawStreams.every((file) => saved.rawStreamIds.has(file.id))
  };
  if (Object.values(checks).some((value) => !value)) {
    throw new Error(`Verification count mismatch: ${JSON.stringify(checks)}`);
  }
  console.log(`Migration verified for owner ${repository.ownerId}. Local files were not changed.`);
}

async function inspectLocalData() {
  const [auth, syncState, activityIndex, details, rawDetails, rawStreams, personalBests, excludedRecords] = await Promise.all([
    readJson(path.join(stravaRoot, "auth.json"), {}),
    readJson(path.join(stravaRoot, "sync-state.json"), {}),
    readJson(path.join(stravaRoot, "activities", "index.json"), { activities: [] }),
    listJsonFiles(path.join(stravaRoot, "activities", "details")),
    listJsonFiles(path.join(stravaRoot, "activities", "raw-details")),
    listJsonFiles(path.join(stravaRoot, "activities", "raw-streams")),
    readJson(path.join(stravaRoot, "derived", "personal-bests.json"), null),
    readJson(path.join(stravaRoot, "derived", "excluded-records.json"), null)
  ]);
  return {
    auth,
    syncState,
    activityIndex,
    details,
    rawDetails,
    rawStreams,
    personalBests,
    excludedRecords
  };
}

async function listJsonFiles(directory) {
  try {
    const names = (await fs.readdir(directory)).filter((name) => name.endsWith(".json"));
    return Promise.all(names.map(async (name) => {
      const filePath = path.join(directory, name);
      return {
        id: path.basename(name, ".json"),
        path: filePath,
        bytes: (await fs.stat(filePath)).size
      };
    }));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await mapper(item);
    }
  });
  await Promise.all(workers);
}

function printSummary(input) {
  const rawBytes = [...input.rawDetails, ...input.rawStreams].reduce((total, file) => total + file.bytes, 0);
  console.log("Local Runasis data found:");
  console.log(`  activities: ${input.activityIndex.activities.length}`);
  console.log(`  sanitized details: ${input.details.length}`);
  console.log(`  raw details: ${input.rawDetails.length}`);
  console.log(`  raw streams: ${input.rawStreams.length}`);
  console.log(`  raw payload size: ${(rawBytes / 1024 / 1024).toFixed(1)} MiB`);
  console.log(`  personal-best cache: ${input.personalBests ? "yes" : "no"}`);
}
