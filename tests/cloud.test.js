"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SESSION_COOKIE_NAME,
  createOAuthState,
  createSession,
  csrfTokenForSession,
  parseCookies,
  sessionCookie,
  verifyOAuthState,
  verifySession
} = require("../lib/cloud-auth");
const {
  GcpRepository,
  normalizeIdentifier,
  toFirestoreData
} = require("../lib/gcp-repository");
const {
  CloudTaskQueue,
  normalizeDelaySeconds,
  normalizeServiceUrl,
  taskIdForPayload
} = require("../lib/task-queue");

const SECRET = "a sufficiently long test-only session secret";

test("cloud auth signs OAuth state and restricts sessions to one athlete", () => {
  const state = createOAuthState(SECRET);
  assert.ok(verifyOAuthState(SECRET, state));
  assert.equal(verifyOAuthState(`${SECRET}!`, state), null);

  const session = createSession(SECRET, 12345);
  assert.equal(verifySession(SECRET, session, "12345").athleteId, "12345");
  assert.equal(verifySession(SECRET, session, "99999"), null);
  assert.notEqual(csrfTokenForSession(SECRET, session), csrfTokenForSession(`${SECRET}!`, session));
});

test("cloud session cookie is host-only, secure, and HTTP-only", () => {
  const value = sessionCookie("signed.token");
  assert.match(value, new RegExp(`^${SESSION_COOKIE_NAME}=`));
  assert.match(value, /Path=\//);
  assert.match(value, /HttpOnly/);
  assert.match(value, /Secure/);
  assert.match(value, /SameSite=Lax/);
  assert.equal(parseCookies(`${SESSION_COOKIE_NAME}=signed.token; theme=dark`)[SESSION_COOKIE_NAME], "signed.token");
});

test("GCP repository identifiers and Firestore payloads are normalized", () => {
  assert.equal(normalizeIdentifier("activity_123", "activity id"), "activity_123");
  assert.throws(() => normalizeIdentifier("../activity", "activity id"), /Invalid activity id/);
  assert.deepEqual(toFirestoreData({ present: true, omitted: undefined }), { present: true });
});

test("Cloud Task names are deterministic and service URLs stay origin-only", () => {
  assert.equal(
    taskIdForPayload({ jobId: "abc-123", phase: "details", step: 4 }),
    "sync-abc-123-details-4"
  );
  assert.equal(normalizeServiceUrl("https://runasis-xyz.a.run.app/"), "https://runasis-xyz.a.run.app");
  assert.throws(() => normalizeServiceUrl("https://example.com/path"), /without a path/);
  assert.equal(normalizeDelaySeconds(901.8), 901);
  assert.equal(normalizeDelaySeconds(-1), 0);
});

test("GCP repository round-trips Firestore metadata and gzip objects", async () => {
  const firestore = new FakeFirestore();
  const storage = new FakeStorage();
  const repository = new GcpRepository({
    ownerId: "primary",
    bucketName: "runasis-test",
    clients: { firestore, storage }
  });

  await repository.writeSnapshot({
    auth: { athlete: { id: 123 }, token: { refresh_token: "secret" } },
    syncState: {
      lastSyncAt: "2026-07-24T00:00:00.000Z",
      syncJob: { id: "job-1", state: "queued" }
    },
    activityIndex: { activities: [{ id: 1, name: "One" }, { id: 2, name: "Two" }] }
  });
  await repository.writeActivityDetail(1, { id: 1, best_efforts: [] });
  await repository.writeRawActivityDetail(1, { id: 1, private: "raw" });
  await repository.writeRawActivityStream(1, { distance: { data: [0, 10] } });
  await repository.writePersonalBestsCache({ distances: [{ name: "1K" }] });
  await repository.writeExcludedRecords({ version: 1, records: { abc: { recordKey: "abc" } } });

  const snapshot = await repository.readSnapshot({
    auth: {},
    syncState: {},
    activityIndex: { activities: [] }
  });
  assert.equal(snapshot.auth.athlete.id, 123);
  assert.equal(snapshot.activityIndex.activities.length, 2);
  assert.equal(snapshot.detailsById.get("1").id, 1);
  assert.ok(snapshot.rawDetailIds.has("1"));
  assert.ok(snapshot.rawStreamIds.has("1"));
  assert.deepEqual(await repository.readSyncJob(), { id: "job-1", state: "queued" });
  assert.deepEqual(await repository.readRawActivityStream(1), { distance: { data: [0, 10] } });
  assert.equal((await repository.readPersonalBestsCache()).distances[0].name, "1K");
  assert.equal((await repository.readExcludedRecords({})).records.abc.recordKey, "abc");

  await repository.clear();
  assert.equal(firestore.data.size, 0);
  assert.equal(storage.bucket("runasis-test").objects.size, 0);
});

test("Cloud Task queue creates deterministic OIDC-authenticated tasks", async () => {
  const requests = [];
  const client = {
    queuePath: (...parts) => parts.join("/"),
    taskPath: (...parts) => parts.join("/"),
    createTask: async (request) => {
      requests.push(request);
      return [{ name: request.task.name }];
    }
  };
  const oauthClient = {
    verifyIdToken: async ({ idToken, audience }) => ({
      getPayload: () => ({
        email: idToken === "valid" && audience === "https://runasis.run.app"
          ? "tasks@example.iam.gserviceaccount.com"
          : "other@example.com",
        email_verified: true
      })
    })
  };
  const queue = new CloudTaskQueue({
    projectId: "project",
    location: "us-west1",
    queue: "runasis-sync",
    serviceUrl: "https://runasis.run.app",
    serviceAccountEmail: "tasks@example.iam.gserviceaccount.com",
    client,
    oauthClient
  });

  await queue.enqueue({ jobId: "job-1", phase: "details", step: 2 }, { delaySeconds: 60 });
  const task = requests[0].task;
  assert.equal(task.httpRequest.url, "https://runasis.run.app/internal/tasks/sync");
  assert.equal(task.httpRequest.oidcToken.audience, "https://runasis.run.app");
  assert.equal(task.scheduleTime.seconds > Math.floor(Date.now() / 1000), true);
  assert.deepEqual(
    JSON.parse(Buffer.from(task.httpRequest.body, "base64").toString("utf8")),
    { jobId: "job-1", phase: "details", step: 2 }
  );
  assert.equal(await queue.verifyRequest({ headers: { authorization: "Bearer valid" } }), true);
  assert.equal(await queue.verifyRequest({ headers: { authorization: "Bearer invalid" } }), false);
});

class FakeFirestore {
  constructor() {
    this.data = new Map();
  }

  collection(name) {
    return new FakeCollection(this, name);
  }

  batch() {
    const operations = [];
    return {
      set: (ref, value, options) => operations.push(["set", ref, value, options]),
      delete: (ref) => operations.push(["delete", ref]),
      commit: async () => {
        for (const [type, ref, value, options] of operations) {
          if (type === "delete") this.data.delete(ref.path);
          else ref.applySet(value, options);
        }
      }
    };
  }
}

class FakeCollection {
  constructor(firestore, collectionPath) {
    this.firestore = firestore;
    this.path = collectionPath;
  }

  doc(id) {
    return new FakeDocument(this.firestore, `${this.path}/${id}`);
  }

  async get() {
    const prefix = `${this.path}/`;
    const docs = [];
    for (const [documentPath, value] of this.firestore.data) {
      const suffix = documentPath.slice(prefix.length);
      if (!documentPath.startsWith(prefix) || suffix.includes("/")) continue;
      docs.push(new FakeDocumentSnapshot(new FakeDocument(this.firestore, documentPath), value));
    }
    return { docs };
  }
}

class FakeDocument {
  constructor(firestore, documentPath) {
    this.firestore = firestore;
    this.path = documentPath;
    this.id = documentPath.split("/").at(-1);
  }

  collection(name) {
    return new FakeCollection(this.firestore, `${this.path}/${name}`);
  }

  async get() {
    return new FakeDocumentSnapshot(this, this.firestore.data.get(this.path));
  }

  async set(value, options) {
    this.applySet(value, options);
  }

  applySet(value, options) {
    const saved = structuredClone(value);
    this.firestore.data.set(
      this.path,
      options?.merge ? { ...(this.firestore.data.get(this.path) || {}), ...saved } : saved
    );
  }
}

class FakeDocumentSnapshot {
  constructor(ref, value) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = value !== undefined;
    this.value = value;
  }

  data() {
    return structuredClone(this.value);
  }
}

class FakeStorage {
  constructor() {
    this.buckets = new Map();
  }

  bucket(name) {
    if (!this.buckets.has(name)) this.buckets.set(name, new FakeBucket());
    return this.buckets.get(name);
  }
}

class FakeBucket {
  constructor() {
    this.objects = new Map();
  }

  file(name) {
    return {
      save: async (body) => this.objects.set(name, Buffer.from(body)),
      download: async () => {
        if (!this.objects.has(name)) {
          const error = new Error("Not found");
          error.code = 404;
          throw error;
        }
        return [this.objects.get(name)];
      }
    };
  }

  async deleteFiles({ prefix }) {
    for (const name of this.objects.keys()) {
      if (name.startsWith(prefix)) this.objects.delete(name);
    }
  }
}
