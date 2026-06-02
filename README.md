# PG Spotlight — World Championship PG 2026

A dependency-free web app for running the PG Spotlight weekly sales championship across EMEA:
program intro & rules, a Panini-style AE squad, NBM logging with the official scoring rubric, a
manager verification workflow, tournament-style leaderboards, weekly winners with jersey picks, and
the operational playbook. All data is stored locally in the browser (no backend).

## Run locally

Just open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 5173
# then open http://127.0.0.1:5173
```

## Publish (pick one)

**Netlify Drop (no account/CLI needed):** go to https://app.netlify.com/drop and drag this folder
(or `pg-spotlight.zip`) onto the page. You get a public URL instantly.

**GitHub Pages:** push this folder to a GitHub repo. The included
`.github/workflows/deploy.yml` publishes the site on every push to `main`
(enable Pages → Source: GitHub Actions in the repo settings once).

```bash
git push -u origin main
```

## Files

- `index.html` — app shell
- `styles.css` — championship theme
- `app.js` — all application logic (state, scoring, views)
- `trophy.svg` — favicon
