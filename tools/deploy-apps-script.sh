#!/usr/bin/env bash
# Deploy server/ to the live Apps Script project ("Log It - Router") and publish.
#
#   tools/deploy-apps-script.sh --check            # dry run: safety checks + diff, no push
#   tools/deploy-apps-script.sh "release note"     # push, verify, publish a new version
#   tools/deploy-apps-script.sh --push-only        # push HEAD, don't publish
#   add --force to skip the unpublished-edits check (only after reading its diff)
#
# Needs clasp >= 3 and `clasp login` (done once per machine, by the user).
#
# Why a script: done by hand this was ~10 steps and went wrong twice. The live
# file names differ from the repo's; a push REPLACES the whole project, so a
# missing file is deleted remotely; and the right safety check is live HEAD vs
# the version currently DEPLOYED — not vs git, which flagged a false alarm when
# HEAD had been pushed from uncommitted work.
set -euo pipefail

SCRIPT_ID=1Np9nv59S7Zuu4r-ABdXUPCEtZDRFAuYcAu5cfgcNfM8_GDVAIb1guZpV
DEPLOYMENT=AKfycbx4VyyLzfafaKkAsNP2LUbSaLOFxS-vX34c-3lHIQPLIHIoqBqOEXghIRzS4n8vQ-24

# live file name : repo path. Every live .js file must appear here.
MAP=(
  "Code:server/routerWebApp.gs"
  "tipRouter:server/tipRouting.js"
  "trackPay:server/trackPay.js"
  "dorsetPay:server/dorsetPay.js"
  "readApi:server/readApi.js"
  "sheetWrite:server/sheetWrite.js"
)

MODE=publish NOTE="" FORCE=0
for a in "$@"; do
  case "$a" in
    --check) MODE=check ;;
    --push-only) MODE=push ;;
    --force) FORCE=1 ;;
    *) NOTE="$a" ;;
  esac
done
if [ "$MODE" = publish ] && [ -z "$NOTE" ]; then
  echo 'usage: tools/deploy-apps-script.sh "release note"   (or --check / --push-only)' >&2; exit 2
fi

REPO=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
clasp_in () { local d=$1; shift; (cd "$d" && clasp "$@"); }
mkproj () { mkdir -p "$1"; printf '{"scriptId":"%s","rootDir":"."}\n' "$SCRIPT_ID" > "$1/.clasp.json"; }

# 1. What is live, and what is deployed.
mkproj "$WORK/live";     clasp_in "$WORK/live" pull >/dev/null
DEPLOYED=$(clasp_in "$WORK/live" list-deployments | grep "$DEPLOYMENT" | grep -o '@[0-9]*' | tr -d @)
[ -n "$DEPLOYED" ] || { echo "deployment $DEPLOYMENT not found" >&2; exit 1; }
mkproj "$WORK/deployed"; clasp_in "$WORK/deployed" pull --versionNumber "$DEPLOYED" >/dev/null
echo "deployed: @$DEPLOYED"

# 2. Every live file must be one we know, or a push would delete it.
for f in "$WORK"/live/*.js; do
  name=$(basename "$f" .js); known=0
  for m in "${MAP[@]}"; do [ "${m%%:*}" = "$name" ] && known=1; done
  [ $known = 1 ] || { echo "live file '$name' is not in MAP — a push would DELETE it. Add it first." >&2; exit 1; }
done

# 3. Has anyone changed live HEAD since the deployed version? (editor edits,
#    or a push that was never published). Overwriting those silently is the risk.
if ! diff -rq -x .clasp.json "$WORK/live" "$WORK/deployed" >/dev/null; then
  echo "live HEAD differs from deployed @$DEPLOYED:"
  diff -ru -x .clasp.json "$WORK/deployed" "$WORK/live" | head -60 || true
  if [ $FORCE = 0 ]; then
    echo "refusing to overwrite. Inspect the diff above; re-run with --force if it is yours." >&2; exit 1
  fi
  echo "(--force: continuing)"
fi

# 4. Stage the repo under the live names.
mkproj "$WORK/stage"
cp "$WORK/live/appsscript.json" "$WORK/stage/"
for m in "${MAP[@]}"; do cp "$REPO/${m#*:}" "$WORK/stage/${m%%:*}.js"; done
echo "changes vs deployed @$DEPLOYED:"
for m in "${MAP[@]}"; do
  n=${m%%:*}
  if [ ! -f "$WORK/deployed/$n.js" ]; then echo "  new      $n";
  elif ! diff -q "$WORK/deployed/$n.js" "$WORK/stage/$n.js" >/dev/null; then
    echo "  changed  $n  ($(diff "$WORK/deployed/$n.js" "$WORK/stage/$n.js" | grep -c '^[<>]') lines)"
  fi
done
[ "$MODE" = check ] && { echo "check only — nothing pushed."; exit 0; }

# 5. Push, then prove it landed by pulling it back.
clasp_in "$WORK/stage" push -f >/dev/null
mkproj "$WORK/back"; clasp_in "$WORK/back" pull >/dev/null
for m in "${MAP[@]}"; do
  diff -q "$WORK/back/${m%%:*}.js" "$REPO/${m#*:}" >/dev/null \
    || { echo "VERIFY FAILED: live ${m%%:*} != ${m#*:}" >&2; exit 1; }
done
echo "pushed and verified: ${#MAP[@]} files match the repo"
[ "$MODE" = push ] && { echo "push only — /exec still serves @$DEPLOYED."; exit 0; }

# 6. Publish: a new version of the EXISTING deployment, so the /exec URL baked
#    into CFG_DEFAULTS keeps working. Never `clasp create-deployment`.
V=$(clasp_in "$WORK/stage" create-version "$NOTE" | grep -o '[0-9]*' | tail -1)
clasp_in "$WORK/stage" update-deployment -V "$V" -d "$NOTE" "$DEPLOYMENT" >/dev/null
clasp_in "$WORK/stage" list-deployments | grep "$DEPLOYMENT"
echo "published @$V. First request after a publish can be slow while it warms up."
