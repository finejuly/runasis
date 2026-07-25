"use strict";

const crypto = require("node:crypto");

const SESSION_COOKIE_NAME = "__Host-runasis_session";
const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_OAUTH_STATE_TTL_SECONDS = 10 * 60;

function assertSessionSecret(secret) {
  if (Buffer.byteLength(String(secret || ""), "utf8") < 32) {
    throw new Error("RUNASIS_SESSION_SECRET must be at least 32 bytes.");
  }
  return String(secret);
}

function createSignedToken(secret, purpose, payload, ttlSeconds) {
  const checkedSecret = assertSessionSecret(secret);
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({
    ...payload,
    purpose,
    issuedAt: now,
    expiresAt: now + ttlSeconds
  })).toString("base64url");
  const signature = sign(checkedSecret, body);
  return `${body}.${signature}`;
}

function verifySignedToken(secret, purpose, token) {
  const checkedSecret = assertSessionSecret(secret);
  const [body, signature, extra] = String(token || "").split(".");
  if (!body || !signature || extra || !safeEqual(signature, sign(checkedSecret, body))) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (payload.purpose !== purpose || !Number.isFinite(payload.expiresAt) || payload.expiresAt < now) return null;
    return payload;
  } catch {
    return null;
  }
}

function createOAuthState(secret) {
  return createSignedToken(secret, "strava-oauth", {
    nonce: crypto.randomBytes(16).toString("hex")
  }, DEFAULT_OAUTH_STATE_TTL_SECONDS);
}

function verifyOAuthState(secret, token) {
  return verifySignedToken(secret, "strava-oauth", token);
}

function createSession(secret, athleteId) {
  return createSignedToken(secret, "session", {
    athleteId: String(athleteId)
  }, DEFAULT_SESSION_TTL_SECONDS);
}

function verifySession(secret, token, allowedAthleteId) {
  const payload = verifySignedToken(secret, "session", token);
  if (!payload?.athleteId) return null;
  if (allowedAthleteId && String(payload.athleteId) !== String(allowedAthleteId)) return null;
  return payload;
}

function csrfTokenForSession(secret, sessionToken) {
  const checkedSecret = assertSessionSecret(secret);
  return crypto.createHmac("sha256", checkedSecret)
    .update(`csrf:${sessionToken}`)
    .digest("base64url");
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

function sessionTokenFromRequest(req) {
  return parseCookies(req?.headers?.cookie || req?.headers?.Cookie)[SESSION_COOKIE_NAME] || "";
}

function sessionCookie(token) {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${DEFAULT_SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function sign(secret, value) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

module.exports = {
  SESSION_COOKIE_NAME,
  assertSessionSecret,
  clearSessionCookie,
  createOAuthState,
  createSession,
  csrfTokenForSession,
  parseCookies,
  sessionCookie,
  sessionTokenFromRequest,
  verifyOAuthState,
  verifySession
};
