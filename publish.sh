#!/usr/bin/env bash
# Publish EMEA AE Activity Tracker to GitHub Pages. Run from your own machine:
#   ./publish.sh [repo-name]
set -euo pipefail
cd "$(dirname "$0")"

REPO="${1:-pg-spotlight}"

git init -b main 2>/dev/null || true
git add -A
git commit -m "EMEA AE Activity Tracker" 2>/dev/null || echo "· nothing new to commit"

if ! gh auth status >/dev/null 2>&1; then
  echo "· GitHub CLI not authenticated — launching login…"
  gh auth login
fi

# Create the repo and push (falls back to push if it already exists).
gh repo create "$REPO" --public --source=. --push 2>/dev/null || git push -u origin main

# Turn on Pages with the GitHub Actions build type (workflow is already in repo).
gh api -X POST "repos/{owner}/${REPO}/pages" -f build_type=workflow >/dev/null 2>&1 \
  || echo "· If the site isn't live, enable Settings → Pages → Source: GitHub Actions"

OWNER="$(gh api user --jq .login 2>/dev/null || echo '<user>')"
echo ""
echo "✓ Pushed. Your site will be live at: https://${OWNER}.github.io/${REPO}/"
echo "  (first deploy takes ~1 minute — watch the Actions tab)"
