# PG Spotlight — World Championship PG 2026

A dependency-free web app for running the PG Spotlight weekly sales championship across EMEA:
program intro & rules, a Panini-style AE squad, NBM logging with the official scoring rubric, a
manager verification workflow, tournament-style leaderboards, weekly winners with jersey picks, and
the operational playbook.

By default the app works locally in each browser. For shared AE submissions and manager verification
across the team, configure Supabase in `config.js`.

## Run locally

Just open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 5173
# then open http://127.0.0.1:5173
```

## Publish (pick one)

**Netlify Drop (no account/CLI needed):** go to https://app.netlify.com/drop and drag this folder
(or `pg-spotlight.zip`) onto the page. You get a public URL instantly.

**GitHub Pages:** push this folder to a GitHub repo and configure Pages to serve
from `main` / `/ (root)`.

```bash
git push -u origin main
```

## Enable Shared Team Data

1. Create a Supabase project.
2. Open the Supabase SQL editor and run `supabase-schema.sql`.
3. Go to Supabase Project Settings → API.
4. Copy the Project URL and public anon key into `config.js`.
5. Redeploy the site.

Once configured, AE submissions appear in the shared manager **Verify** tab and verified NBMs power
the shared leaderboard.

## Files

- `index.html` — app shell
- `styles.css` — championship theme
- `app.js` — all application logic (state, scoring, views)
- `trophy.svg` — favicon
