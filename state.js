// GET /api/jobs?repo=owner/name&run_id=123
// Jobs + steps for a single run. Loaded on demand when a row is expanded.
import { gh, guarded, send } from "./_lib.js";

async function handler(req, res) {
  const { repo, run_id } = req.query;
  if (!repo || !run_id) return send(res, 400, { error: "repo and run_id are required." });

  const { data } = await gh(`/repos/${repo}/actions/runs/${run_id}/jobs?per_page=50`);
  const jobs = (data && data.jobs || []).map((j) => ({
    id: j.id,
    name: j.name,
    status: j.status,
    conclusion: j.conclusion,
    started_at: j.started_at,
    completed_at: j.completed_at,
    url: j.html_url,
    steps: (j.steps || []).map((s) => ({
      name: s.name,
      status: s.status,
      conclusion: s.conclusion,
      number: s.number,
    })),
  }));
  return send(res, 200, { jobs });
}

export default guarded(handler);
