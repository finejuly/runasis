"use strict";

const TASK_PATH = "/internal/tasks/sync";

class CloudTaskQueue {
  constructor(options = {}) {
    this.projectId = required(options.projectId || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT, "GOOGLE_CLOUD_PROJECT");
    this.location = required(options.location || process.env.RUNASIS_TASK_LOCATION, "RUNASIS_TASK_LOCATION");
    this.queue = required(options.queue || process.env.RUNASIS_TASK_QUEUE, "RUNASIS_TASK_QUEUE");
    this.serviceUrl = normalizeServiceUrl(options.serviceUrl || process.env.RUNASIS_CLOUD_RUN_URL);
    this.serviceAccountEmail = required(
      options.serviceAccountEmail || process.env.RUNASIS_TASK_SERVICE_ACCOUNT,
      "RUNASIS_TASK_SERVICE_ACCOUNT"
    );
    this.audience = options.audience || process.env.RUNASIS_TASK_AUDIENCE || this.serviceUrl;
    this.client = options.client || createTasksClient();
    this.oauthClient = options.oauthClient || null;
  }

  async enqueue(payload, options = {}) {
    const parent = this.client.queuePath(this.projectId, this.location, this.queue);
    const task = {
      name: this.client.taskPath(
        this.projectId,
        this.location,
        this.queue,
        taskIdForPayload(payload)
      ),
      httpRequest: {
        httpMethod: "POST",
        url: `${this.serviceUrl}${TASK_PATH}`,
        headers: {
          "content-type": "application/json"
        },
        body: Buffer.from(JSON.stringify(payload)).toString("base64"),
        oidcToken: {
          serviceAccountEmail: this.serviceAccountEmail,
          audience: this.audience
        }
      },
      dispatchDeadline: {
        seconds: 30 * 60
      }
    };
    const delaySeconds = normalizeDelaySeconds(options.delaySeconds);
    if (delaySeconds) {
      task.scheduleTime = {
        seconds: Math.floor(Date.now() / 1000) + delaySeconds
      };
    }

    try {
      const [created] = await this.client.createTask({ parent, task });
      return created;
    } catch (error) {
      if (Number(error.code) === 6 || String(error.code) === "ALREADY_EXISTS") {
        return { name: task.name, alreadyExists: true };
      }
      throw error;
    }
  }

  async verifyRequest(req) {
    const authorization = String(req?.headers?.authorization || req?.headers?.Authorization || "");
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return false;

    const client = this.oauthClient || createOAuthClient();
    const ticket = await client.verifyIdToken({
      idToken: match[1],
      audience: this.audience
    });
    const payload = ticket.getPayload() || {};
    return payload.email_verified === true && payload.email === this.serviceAccountEmail;
  }
}

function createTasksClient() {
  const { CloudTasksClient } = require("@google-cloud/tasks");
  return new CloudTasksClient();
}

function createOAuthClient() {
  const { OAuth2Client } = require("google-auth-library");
  return new OAuth2Client();
}

function normalizeServiceUrl(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("RUNASIS_CLOUD_RUN_URL must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:" || url.pathname !== "/") {
    throw new Error("RUNASIS_CLOUD_RUN_URL must be an HTTPS origin without a path.");
  }
  return url.origin;
}

function taskIdForPayload(payload) {
  const jobId = String(payload?.jobId || "").replace(/[^0-9A-Za-z_-]/g, "");
  const phase = String(payload?.phase || "").replace(/[^0-9A-Za-z_-]/g, "");
  const step = Number.isFinite(Number(payload?.step)) ? Math.max(0, Math.floor(Number(payload.step))) : 0;
  if (!jobId || !phase) throw new Error("Cloud task payload needs a job id and phase.");
  return `sync-${jobId}-${phase}-${step}`.slice(0, 500);
}

function normalizeDelaySeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(Math.floor(number), 30 * 24 * 60 * 60);
}

function required(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${name} is required for Cloud Tasks.`);
  return text;
}

function createCloudTaskQueue(options) {
  return new CloudTaskQueue(options);
}

module.exports = {
  CloudTaskQueue,
  TASK_PATH,
  createCloudTaskQueue,
  normalizeDelaySeconds,
  normalizeServiceUrl,
  taskIdForPayload
};
