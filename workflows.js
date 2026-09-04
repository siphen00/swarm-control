// GET /api/state
// Aggregates recent workflow runs across every watched repo into one compact payload.
import { gh, getWatchedRepos, guarded, send, getCache, setCache, lastRate } from "./_lib.js";

const RUNS_PER_REPO = 20;
const CACHE_MS = 8000; // don't hammer GitHub if several tabs / fast polls hit at once

async function handler(req, res) {
  const cached = getCache("state", CACHE_MS);
  if (cached) return send(res, 200, { ...cached, cached: true });

  const repos = await getWatchedRepos();

  const results = await Promise.allSettled(
    repos.map(async (full) => {
      const { data } = await gh(`/repos/${full}/actions/runs?per_page=${RUNS_PER_REPO}`);
      return { full, runs: (data && data.workflow_runs) || [] };
    })
  );

  const runs = [];
  const repoSummaries = [];

  for (let i = 0; i < results.length; i++) {
    const full = repos[i];
    const r = results[i];
    if (r.status !== "fulfilled") {
      repoSummaries.push({ full, error: r.reason?.message || "unreachable", counts: emptyCounts() });
      continue;
    }
    const counts = emptyCounts();
    for (const run of r.value.runs) {
      const shaped = shapeRun(full, run);
      runs.push(shaped);
      counts[shaped.state] = (counts[shaped.state] || 0) + 1;
    }
    repoSummaries.push({ full, counts });
  }

  // Newest activity first.
  runs.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  const totals = emptyCounts();
  for (const run of runs) totals[run.state] = (totals[run.state] || 0) + 1;

  const payload = {
    generated_at: new Date().toISOString(),
    repos: repoSummaries,
    runs,
    totals,
    rate: lastRate,
  };
  setCache("state", payload);
  return send(res, 200, payload);
}

function emptyCounts() {
  return { running: 0, queued: 0, success: 0, failure: 0, cancelled: 0, other: 0 };
}

// Collapse GitHub's status/conclusion pair into one clear state the UI can color.
function normalizeState(run) {
  if (run.status === "in_progress") return "running";
  if (run.status === "queued" || run.status === "pending" || run.status === "waiting" || run.status === "requested") return "queued";
  if (run.status === "completed") {
    switch (run.conclusion) {
      case "success": return "success";
      case "failure":
      case "timed_out":
      case "startup_failure": return "failure";
      case "cancelled": return "cancelled";
      case "skipped":
      case "neutral":
      case "action_required":
      case "stale":
      default: return "other";
    }
  }
  return "other";
}

function shapeRun(full, run) {
  return {
    id: run.id,
    repo: full,
    workflow_id: run.workflow_id,
    workflow: run.name || "workflow",
    title: run.display_title || run.head_commit?.message?.split("\n")[0] || "",
    number: run.run_number,
    attempt: run.run_attempt,
    state: normalizeState(run),
    status: run.status,
    conclusion: run.conclusion,
    event: run.event,
    branch: run.head_branch,
    actor: run.triggering_actor?.login || run.actor?.login || null,
    started_at: run.run_started_at || run.created_at,
    updated_at: run.updated_at,
    url: run.html_url,
  };
}

export default guarded(handler);
