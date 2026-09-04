// GET /api/workflows?repo=owner/name
// Lists a repo's active workflows to populate the Launch panel.
// Note: GitHub doesn't flag which workflows accept workflow_dispatch without reading
// each file, so we return all active ones and surface a clear error at dispatch time
// if a workflow has no manual trigger.
import { gh, guarded, send } from "./_lib.js";

async function handler(req, res) {
  const { repo } = req.query;
  if (!repo) return send(res, 400, { error: "repo is required." });

  const { data } = await gh(`/repos/${repo}/actions/workflows?per_page=100`);
  const workflows = (data && data.workflows || [])
    .filter((w) => w.state === "active")
    .map((w) => ({ id: w.id, name: w.name, path: w.path }));

  // Default branch, so the Launch panel can prefill a sensible ref.
  let default_branch = "main";
  try {
    const { data: r } = await gh(`/repos/${repo}`);
    if (r && r.default_branch) default_branch = r.default_branch;
  } catch { /* fall back to main */ }

  return send(res, 200, { workflows, default_branch });
}

export default guarded(handler);
