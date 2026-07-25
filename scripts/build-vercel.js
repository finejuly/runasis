"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outputRoot = path.join(root, ".vercel", "output");
const staticRoot = path.join(outputRoot, "static");
const apiOrigin = normalizeApiOrigin(process.env.RUNASIS_API_ORIGIN);

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(staticRoot, { recursive: true });
fs.cpSync(path.join(root, "public"), staticRoot, { recursive: true });

const config = {
  version: 3,
  routes: [
    {
      src: "^/(?!api(?:/|$)|auth(?:/|$)).*$",
      headers: {
        "Content-Security-Policy": "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "Referrer-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY"
      },
      continue: true
    },
    {
      src: "^/api/(.*)$",
      dest: `${apiOrigin}/api/$1`
    },
    {
      src: "^/auth/(.*)$",
      dest: `${apiOrigin}/auth/$1`
    },
    {
      handle: "filesystem"
    },
    {
      src: "^/.*$",
      dest: "/index.html"
    }
  ]
};

fs.writeFileSync(
  path.join(outputRoot, "config.json"),
  `${JSON.stringify(config, null, 2)}\n`
);

console.log(`Prepared Vercel static output with API proxy to ${apiOrigin}.`);

function normalizeApiOrigin(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("RUNASIS_API_ORIGIN must be set to the Cloud Run HTTPS origin.");
  }
  if (url.protocol !== "https:" || url.pathname !== "/") {
    throw new Error("RUNASIS_API_ORIGIN must be an HTTPS origin without a path.");
  }
  return url.origin;
}
