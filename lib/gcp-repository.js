"use strict";

const { promisify } = require("node:util");
const zlib = require("node:zlib");

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const FIRESTORE_BATCH_LIMIT = 400;

class GcpRepository {
  constructor(options = {}) {
    this.ownerId = normalizeIdentifier(options.ownerId || process.env.RUNASIS_OWNER_ID || "primary", "owner id");
    this.bucketName = String(options.bucketName || process.env.RUNASIS_STORAGE_BUCKET || "").trim();
    if (!this.bucketName) {
      throw new Error("RUNASIS_STORAGE_BUCKET is required when RUNASIS_STORAGE_BACKEND=gcp.");
    }

    const clients = options.clients || createGoogleCloudClients(options);
    this.firestore = clients.firestore;
    this.storage = clients.storage;
    this.bucket = this.storage.bucket(this.bucketName);
    this.ownerRef = this.firestore.collection("runasisUsers").doc(this.ownerId);
  }

  async readSnapshot(fallbacks) {
    const [authSnapshot, syncSnapshot, activitiesSnapshot] = await Promise.all([
      this.ownerRef.collection("state").doc("auth").get(),
      this.ownerRef.collection("state").doc("sync").get(),
      this.ownerRef.collection("activities").get()
    ]);

    const activities = [];
    const detailsById = new Map();
    const rawDetailIds = new Set();
    const rawStreamIds = new Set();

    for (const document of activitiesSnapshot.docs) {
      const data = document.data() || {};
      const id = String(data.activity?.id ?? document.id);
      if (data.activity) activities.push(data.activity);
      if (data.detail) detailsById.set(id, data.detail);
      if (data.hasRawDetail) rawDetailIds.add(id);
      if (data.hasRawStream) rawStreamIds.add(id);
    }

    activities.sort((a, b) => new Date(b.start_date || 0) - new Date(a.start_date || 0));

    return {
      auth: authSnapshot.exists ? authSnapshot.data() : fallbacks.auth,
      syncState: syncSnapshot.exists ? syncSnapshot.data() : fallbacks.syncState,
      activityIndex: {
        ...fallbacks.activityIndex,
        activities
      },
      detailsById,
      rawDetailIds,
      rawStreamIds
    };
  }

  async writeSnapshot({ auth, syncState, activityIndex }) {
    const now = new Date().toISOString();
    const operations = [
      {
        ref: this.ownerRef,
        data: {
          schemaVersion: 1,
          ownerId: this.ownerId,
          updatedAt: now
        },
        options: { merge: true }
      },
      {
        ref: this.ownerRef.collection("state").doc("auth"),
        data: toFirestoreData(auth)
      },
      {
        ref: this.ownerRef.collection("state").doc("sync"),
        data: toFirestoreData(syncState)
      }
    ];

    for (const activity of activityIndex.activities || []) {
      const id = normalizeIdentifier(activity?.id, "activity id");
      operations.push({
        ref: this.ownerRef.collection("activities").doc(id),
        data: { activity: toFirestoreData(activity) },
        options: { merge: true }
      });
    }

    await commitOperations(this.firestore, operations);
  }

  async readSyncJob() {
    const snapshot = await this.ownerRef.collection("state").doc("sync").get();
    return snapshot.exists ? snapshot.data()?.syncJob || null : null;
  }

  async writeActivityDetail(id, detail) {
    await this.activityRef(id).set({ detail: toFirestoreData(detail) }, { merge: true });
  }

  async writeRawActivityDetail(id, detail) {
    const normalizedId = normalizeIdentifier(id, "activity id");
    await this.writeGzipJson(this.objectName(`activities/${normalizedId}/detail.json.gz`), detail);
    await this.activityRef(normalizedId).set({ hasRawDetail: true }, { merge: true });
  }

  async writeRawActivityStream(id, streams) {
    const normalizedId = normalizeIdentifier(id, "activity id");
    await this.writeGzipJson(this.objectName(`activities/${normalizedId}/streams.json.gz`), streams);
    await this.activityRef(normalizedId).set({ hasRawStream: true }, { merge: true });
  }

  async readRawActivityStream(id) {
    const normalizedId = normalizeIdentifier(id, "activity id");
    return this.readGzipJson(this.objectName(`activities/${normalizedId}/streams.json.gz`), null);
  }

  async readPersonalBestsCache() {
    return this.readGzipJson(this.objectName("derived/personal-bests.json.gz"), null);
  }

  async writePersonalBestsCache(payload) {
    await this.writeGzipJson(this.objectName("derived/personal-bests.json.gz"), payload);
  }

  async readExcludedRecords(fallback) {
    const snapshot = await this.ownerRef.collection("derived").doc("excluded-records").get();
    return snapshot.exists ? snapshot.data() : fallback;
  }

  async writeExcludedRecords(payload) {
    await this.ownerRef.collection("derived").doc("excluded-records").set(toFirestoreData(payload));
  }

  async clear() {
    const references = [];
    for (const collectionName of ["activities", "state", "derived"]) {
      const snapshot = await this.ownerRef.collection(collectionName).get();
      references.push(...snapshot.docs.map((document) => document.ref));
    }
    references.push(this.ownerRef);
    await deleteReferences(this.firestore, references);
    await this.bucket.deleteFiles({ prefix: this.objectName("") });
  }

  activityRef(id) {
    return this.ownerRef.collection("activities").doc(normalizeIdentifier(id, "activity id"));
  }

  objectName(suffix) {
    return `owners/${this.ownerId}/${suffix}`;
  }

  async writeGzipJson(name, value) {
    const body = await gzip(Buffer.from(JSON.stringify(value)));
    await this.bucket.file(name).save(body, {
      resumable: false,
      metadata: {
        contentType: "application/gzip",
        cacheControl: "private, no-store"
      }
    });
  }

  async readGzipJson(name, fallback) {
    try {
      const [body] = await this.bucket.file(name).download();
      return JSON.parse((await gunzip(body)).toString("utf8"));
    } catch (error) {
      if (Number(error.code) === 404) return fallback;
      throw error;
    }
  }
}

function createGoogleCloudClients(options = {}) {
  const { Firestore } = require("@google-cloud/firestore");
  const { Storage } = require("@google-cloud/storage");
  const projectId = options.projectId || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  const clientOptions = projectId ? { projectId } : {};
  return {
    firestore: new Firestore(clientOptions),
    storage: new Storage(clientOptions)
  };
}

async function commitOperations(firestore, operations) {
  for (let index = 0; index < operations.length; index += FIRESTORE_BATCH_LIMIT) {
    const batch = firestore.batch();
    for (const operation of operations.slice(index, index + FIRESTORE_BATCH_LIMIT)) {
      if (operation.options) {
        batch.set(operation.ref, operation.data, operation.options);
      } else {
        batch.set(operation.ref, operation.data);
      }
    }
    await batch.commit();
  }
}

async function deleteReferences(firestore, references) {
  for (let index = 0; index < references.length; index += FIRESTORE_BATCH_LIMIT) {
    const batch = firestore.batch();
    for (const reference of references.slice(index, index + FIRESTORE_BATCH_LIMIT)) {
      batch.delete(reference);
    }
    await batch.commit();
  }
}

function normalizeIdentifier(value, label) {
  const text = String(value ?? "").trim();
  if (!/^[0-9A-Za-z_-]{1,128}$/.test(text)) {
    throw new Error(`Invalid ${label}.`);
  }
  return text;
}

function toFirestoreData(value) {
  return JSON.parse(JSON.stringify(value));
}

function createGcpRepository(options) {
  return new GcpRepository(options);
}

module.exports = {
  FIRESTORE_BATCH_LIMIT,
  GcpRepository,
  createGcpRepository,
  normalizeIdentifier,
  toFirestoreData
};
