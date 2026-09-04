// Shared helpers for the SWARM CONTROL API (Vercel serverless, Node 18+ / ESM).
// Files prefixed with "_" are not exposed as routes by Vercel.

const GH_API = "https://api.github.com";

// Best-effort in-memory cache. Lives only as long as a warm serverless instance,
// which is exactly what we want: it smooths bursts without ever going stale for long.
const cache = new Map();

export function getCache(key, ttlMs) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  return null;
}
export function setCache(key, value) {
  cache.set(key, { t: Date.now(), v: value });
  return value;
}

// Password gate. If DASHBOARD_PASSWORD is set, every request must send a matching
// x-dashboard-key header. This matters because the API can trigger and cancel runs.
export function checkAuth(req) {
  const required = process.env.DASHBOARD_PASSWORD;
  if (!required) return { ok: true };
  const given = req.headers["x-dashboard-key"];
  if (given && given === required) return { ok: true };
  return { ok: false, status: 401, error: "Locked. Enter your dashboard key to continue." };
}

// Is a GitHub token configured at all?
export function requireToken() {
  const token = process.env.GH_TOKEN;
  if (!token) {
    const err = new Error("No GH_TOKEN set. Add a GitHub token in your Vercel env vars.");
    err.status = 500;
    throw err;
  }
  return token;
}

// Single choke point for talking to GitHub. Returns { data, res } and also stashes
// the latest rate-limit headers so the dashboard can show remaining budget.
export let lastRate = { remaining: null, limit: null, reset: null };

export async function gh(path, opts = {}) {
  const token = requireToken();
  const res = await fetch(GH_API + path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "swarm-control",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(opts.headers || {}),
    },
  });

  lastRate = {
    remaining: numOrNull(res.headers.get("x-ratelimit-remaining")),
    limit: numOrNull(res.headers.get("x-ratelimit-limit")),
    reset: numOrNull(res.headers.get("x-ratelimit-reset")),
  };

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!res.ok) {
    const msg = (data && data.message) || `GitHub API ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return { data, res };
}

// Which repos count as "swarms". Explicit REPOS list wins; otherwise fall back to
// the token owner's most recently pushed repos (capped, to stay cheap on rate limit).
export async function getWatchedRepos() {
  const configured = (process.env.REPOS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (configured.length) return configured;

  const cached = getCache("fallback-repos", 5 * 60 * 1000);
  if (cached) return cached;

  const { data } = await gh("/user/repos?sort=pushed&per_page=15&affiliation=owner,collaborator,organization_member");
  const repos = (data || []).map((r) => r.full_name);
  return setCache("fallback-repos", repos);
}

export function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Uniform JSON responder.
export function send(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(status).send(JSON.stringify(payload));
}

// Wrap a handler with auth + error handling so each endpoint stays tiny.
export function guarded(handler) {
  return async (req, res) => {
    try {
      const auth = checkAuth(req);
      if (!auth.ok) return send(res, auth.status, { error: auth.error });
      await handler(req, res);
    } catch (err) {
      const status = err.status || 500;
      send(res, status, { error: err.message || "Something went wrong.", detail: err.body || null });
    }
  };
}

// Read a JSON body (Vercel usually parses it, but be defensive).
export async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
  });
}
