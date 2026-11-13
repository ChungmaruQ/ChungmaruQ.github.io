#!/usr/bin/env bash
set -euo pipefail
file=$1
repo=${GITHUB_REPOSITORY:-ChungmaruQ/ChungmaruQ.github.io}
branch=e1002-images
if ! gh api "repos/$repo/git/ref/heads/$branch" >/dev/null 2>&1; then
  seed=$(gh api "repos/$repo/git/ref/heads/main" --jq .object.sha)
  gh api -X POST "repos/$repo/git/refs" -f "ref=refs/heads/$branch" -f "sha=$seed" >/dev/null
fi
path="repos/$repo/contents/$(basename "$file")"
sha=$(gh api "$path?ref=$branch" --jq .sha 2>/dev/null || true)
args=()
if [[ -n "$sha" ]]; then args+=(-f "sha=$sha"); fi
gh api -X PUT "$path" -f "branch=$branch" -f "message=Publish E1002 image" \
  -f "content=$(base64 < "$file" | tr -d '\n')" "${args[@]}" >/dev/null
