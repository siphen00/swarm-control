# SWARM CONTROL

One dashboard to **see and control** your GitHub Actions agents across every repo.
Static frontend + tiny serverless proxy. Your GitHub token lives as a server-side
secret — it never touches the browser. Free tier, no local anything.

- **See:** every recent workflow run across your repos, grouped by repo ("swarm"),
  with live status, durations, jobs, and steps.
- **Control:** launch a workflow (`workflow_dispatch`), cancel a running run, re-run,
  or re-run just the failed jobs.

---

## What you need

1. A GitHub **fine-grained personal access token** with, for the repos you want to watch:
   - **Actions** → Read and write  (needed to trigger/cancel/re-run)
   - **Contents** → Read-only  (to read default branch / repo metadata)
   - **Metadata** → Read-only  (auto-selected)
   Create it at: GitHub → Settings → Developer settings → Fine-grained tokens.
2. A free Vercel account (you already have the CLI set up).

---

## Deploy (Vercel — ~3 minutes)

```bash
cd swarm-control
git init && git add . && git commit -m "swarm control"
gh repo create swarm-control --private --source=. --push
```

Then either the dashboard or CLI:

**Dashboard:** go to vercel.com/new → import the repo → Deploy (no build settings needed).

**CLI:**
```bash
vercel            # link + preview
vercel --prod     # production
```

### Set the environment variables

In Vercel → Project → Settings → Environment Variables (or via CLI), add:

| Variable             | Required | What it does                                                                 |
|----------------------|----------|------------------------------------------------------------------------------|
| `GH_TOKEN`           | yes      | Your fine-grained token. Never exposed to the browser.                       |
| `REPOS`              | no       | Comma-separated `owner/repo` list to watch. If unset, falls back to your 15 most recently pushed repos. |
| `DASHBOARD_PASSWORD` | strongly recommended | A key you must enter to load the dashboard. Since the API can trigger/cancel runs, don't skip this. |

```bash
vercel env add GH_TOKEN production
vercel env add REPOS production            # e.g. siphen00/mt5-trading-agent,siphen00/melago
vercel env add DASHBOARD_PASSWORD production
vercel --prod                              # redeploy so the vars take effect
```

Open the URL. Before it's connected it shows **demo data** so you can see the design;
once `GH_TOKEN` is set it goes live. If you set `DASHBOARD_PASSWORD`, you'll be prompted
for it once per session.

---

## How it works

```
index.html            the whole dashboard (no build step, vanilla JS)
api/state.js          GET  → recent runs across all watched repos, one compact payload
api/jobs.js           GET  → jobs + steps for a run (loaded when you expand a row)
api/workflows.js      GET  → a repo's workflows (for the Launch panel)
api/action.js         POST → dispatch | cancel | rerun | rerun_failed
api/_lib.js           shared auth gate + GitHub fetch + repo resolution + cache
```

The frontend polls `/api/state` every 20s (pauses when the tab is hidden). The proxy
caches for 8s and shows your remaining GitHub API budget in the header, so you won't
burn through the 5,000/hr limit even with the tab open all day.

**To launch a workflow from the dashboard, that workflow's YAML must include:**
```yaml
on:
  workflow_dispatch:
```
If it doesn't, the Launch panel tells you exactly that instead of failing silently.

---

## Alternative host: Cloudflare Pages

Prefer Cloudflare? The port is small:
- Move `api/*.js` to `functions/api/*.js`.
- Change each handler from `export default (req,res)=>{}` (Vercel) to
  `export async function onRequest(context){}` — read query via `new URL(context.request.url)`,
  env via `context.env.GH_TOKEN`, and return `new Response(JSON.stringify(...))`.
- Set the same env vars in the Pages project. Static output dir = repo root.

Say the word and I'll generate the Cloudflare version outright.

---

## Notes

- Fine-grained tokens are scoped to the repos you pick — good blast-radius control.
- `REPOS` is cheaper on rate limit than the auto-discover fallback; set it once you know your list.
- Everything is read-through to GitHub in real time; nothing about your runs is stored anywhere.
