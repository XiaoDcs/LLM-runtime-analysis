# LLM Time Analysis

A small tool to compute LLM-only runtimes from a `time.json` log, excluding retry waits and waiting for user replies.

This repo includes:
- A Python CLI (`compute_llm_time.py`) for local analysis
- A static web app in `docs/` that runs fully client-side (no backend) and can be deployed to GitHub Pages

## What it computes
- Run-sum (assistant → own tools): Sums durations from each assistant message to its associated tool results, stopping when another assistant or any user message appears.
- Cycle-sum (user-triggered): For each user message, sums the interval from that user message to the last non-user message before the next user message. Treats "Retry" as a user message. This approximates full LLM work between user prompts while excluding idle waits for the next user.

## Local CLI Usage

```bash
python3 /absolute/path/to/compute_llm_time.py /absolute/path/to/time.json
```
If the path is omitted, it defaults to `time-analysis/time.json` as checked into this repo.

The CLI prints:
- Per-run windows (assistant → tools)
- Per-cycle windows (user-triggered)
- Totals for both

## Static Web App (No Backend)
The `docs/` folder contains a static app that parses `time.json` entirely in the browser:
- `docs/index.html`
- `docs/app.js`
- `docs/styles.css`

Features:
- Upload or drag-and-drop a `time.json`
- Paste JSON directly into the page
- Timezone selection for display (default UTC+8)
- CSV export for runs and cycles
- All parsing is done locally; no data leaves your device

### Open locally
From this repo root:
```
open docs/index.html
```
Or serve with any static server, e.g.:
```
python3 -m http.server -d docs 8080
# then open http://localhost:8080
```

### Deploy to GitHub Pages
1. Commit and push the repository to GitHub.
2. In your GitHub repo settings → Pages:
   - Source: Deploy from branch
   - Branch: `main` (or your default), folder: `/docs`
3. Save. GitHub Pages will publish the site at `https://<your-username>.github.io/<repo-name>/`.

Once live, open the page and upload or paste `time.json` to compute results in-browser.

## Data privacy
- The web app is fully client-side. Files are read in the browser only and are never uploaded.
- When hosted on GitHub Pages, there is no server-side component.

## Adjusting the computation
- If you need to refine the definition of LLM-active time (e.g., include/exclude certain tool types), mirror the logic in both `compute_llm_time.py` and `docs/app.js`:
  - Runs: assistant → tool results that reference the assistant message via `assistant_message_id`
  - Cycles: user message → last non-user before next user (treat "Retry" as a user message)

## Troubleshooting
- Timestamp parsing: The code normalizes fractional seconds to microseconds and handles `Z` or `±HH:MM` offsets.
- If the page appears empty after loading a file, open DevTools Console for errors (invalid JSON shape, etc.). 