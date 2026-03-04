#!/usr/bin/env bash
set -euo pipefail

WATCH_DIR="/Users/saiko/Desktop/bluesky"
# PlayOutdoor : Tennis, Bike & Run
PAGE_ID="677659355438097"
PAGE_ACCESS_TOKEN="${PAGE_ACCESS_TOKEN:-YOUR_PAGE_ACCESS_TOKEN}"

[[ "$PAGE_ACCESS_TOKEN" != "YOUR_PAGE_ACCESS_TOKEN" ]] || { echo "Set PAGE_ACCESS_TOKEN"; exit 1; }
command -v fswatch >/dev/null || { echo "Install fswatch: brew install fswatch"; exit 1; }
[[ -d "$WATCH_DIR" ]] || { echo "Missing folder: $WATCH_DIR"; exit 1; }

declare -A posted
is_image(){ case "${1,,}" in *.jpg|*.jpeg|*.png|*.gif|*.webp) return 0;; *) return 1;; esac; }

echo "Watching $WATCH_DIR"
echo "Posting to: PlayOutdoor : Tennis, Bike & Run (Page ID: $PAGE_ID)"

fswatch -0 "$WATCH_DIR" | while IFS= read -r -d '' file; do
  [[ -f "$file" ]] || continue
  is_image "$file" || continue
  [[ -z "${posted[$file]:-}" ]] || continue
  posted[$file]=1
  sleep 1

  echo "Posting $(basename "$file")"
  curl -sS -X POST "https://graph.facebook.com/v20.0/${PAGE_ID}/photos" \
    -F "source=@${file}" \
    -F "caption=$(basename "$file")" \
    -F "access_token=${PAGE_ACCESS_TOKEN}"
  echo
 done
