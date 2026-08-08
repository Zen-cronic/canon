#!/usr/bin/env bash
# Shoot one act (or several) against the REAL report.
#
#   ./film/capture.sh 0 1 2 3 4      # act numbers
#
# The report is a static file, so unlike a server-backed demo there is nothing
# to boot and no cooldown to respect — but it MUST be freshly rendered, or the
# take films yesterday's numbers. `npm run demo` regenerates it from the
# committed fixture catalog and needs no credentials.
#
# Keep your hands off the machine while this runs: the window is captured from
# the X server, so anything that raises another window lands in the frame.
set -euo pipefail
cd "$(dirname "$0")"

REPORT_FILE="$(cd .. && pwd)/out/index.html"

if [[ "${FRESH:-1}" == "1" ]]; then
  echo "rendering the report (npm run demo)…"
  (cd .. && npm run demo >/tmp/canon-film-demo.log 2>&1) || {
    echo "npm run demo FAILED — see /tmp/canon-film-demo.log" >&2
    tail -20 /tmp/canon-film-demo.log >&2
    exit 1
  }
fi

if [[ ! -f "$REPORT_FILE" ]]; then
  echo "no report at $REPORT_FILE — run 'npm run demo' in the repo root" >&2
  exit 1
fi

# Assert WHICH page we are about to film, not merely that a file exists. A
# stale or partial render would otherwise be filmed silently.
if ! grep -q "catalog adjudicator" "$REPORT_FILE"; then
  echo "WRONG PAGE: $REPORT_FILE does not look like the canon report." >&2
  exit 1
fi

export REPORT="file://$REPORT_FILE"
echo "filming $REPORT"

for act in "$@"; do
  case "$act" in
    0) node act0-hero.mjs ;;
    1) node act1-studio.mjs ;;
    2) node act2-evidence.mjs ;;
    3) node act3-apply.mjs ;;
    4) node act4-scale.mjs ;;
    5) node make-endcard.mjs && node act5-endcard.mjs ;;
    *) echo "unknown act: $act" >&2; exit 1 ;;
  esac
done

echo
echo "takes:"
for t in takes/act*/capture.mp4; do
  [[ -f "$t" ]] || continue
  printf '  %-22s %6.2fs\n' "$t" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$t")"
done
