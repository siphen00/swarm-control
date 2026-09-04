// POST /api/action
// The control side. Body: { type, repo, run_id?, workflow_id?, ref?, inputs? }
//   type = "dispatch" | "cancel" | "rerun" | "rerun_failed"
import { gh, guarded, send, readBody } from "./_lib.js";

async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  const body = await readBody(req);
  const { type, repo, run_id, workflow_id, ref, inputs } = body;

  if (!repo) return send(res, 400, { error: "repo is required." });

  switch (type) {
    case "dispatch": {
      if (!workflow_id) return send(res, 400, { error: "workflow_id is required to launch." });
      try {
        await gh(`/repos/${repo}/actions/workflows/${workflow_id}/dispatches`, {
          method: "POST",
          body: JSON.stringify({ ref: ref || "main", inputs: inputs || {} }),
        });
      } catch (err) {
        if (err.status === 422) {
          return send(res, 422, {
            error: "This workflow has no manual trigger. Add `on: workflow_dispatch:` to its YAML to launch it from here.",
          });
        }
        throw err;
      }
      // dispatch returns 204 with no run id; the new run shows up on the next refresh
      return send(res, 200, { ok: true, message: "Launch requested." });
    }

    case "cancel": {
      if (!run_id) return send(res, 400, { error: "run_id is required to cancel." });
      await gh(`/repos/${repo}/actions/runs/${run_id}/cancel`, { method: "POST" });
      return send(res, 200, { ok: true, message: "Cancel requested." });
    }

    case "rerun": {
      if (!run_id) return send(res, 400, { error: "run_id is required to re-run." });
      await gh(`/repos/${repo}/actions/runs/${run_id}/rerun`, { method: "POST" });
      return send(res, 200, { ok: true, message: "Re-run requested." });
    }

    case "rerun_failed": {
      if (!run_id) return send(res, 400, { error: "run_id is required." });
      await gh(`/repos/${repo}/actions/runs/${run_id}/rerun-failed-jobs`, { method: "POST" });
      return send(res, 200, { ok: true, message: "Re-run of failed jobs requested." });
    }

    default:
      return send(res, 400, { error: `Unknown action "${type}".` });
  }
}

export default guarded(handler);
