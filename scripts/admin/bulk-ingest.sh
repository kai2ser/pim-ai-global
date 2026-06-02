#!/usr/bin/env bash
#
# Bulk-ingest catalogued documents from one collection by walking the queue
# at /api/admin/catalogued and POSTing each document_id to /api/admin/ingest,
# one at a time. Each /api/admin/ingest call is bounded by its 120 s
# maxDuration, so the loop runs client-side here and individual slow PDFs
# can't kill the whole batch.
#
# Usage:
#   scripts/bulk-ingest.sh <collection> [batch_size]
#
#   collection: pefa_reports | pima_reports | wbg_pers | pim_literature
#   batch_size: how many docs to fetch from the queue per HTTP round trip
#               (default 10; the script keeps fetching until the queue is
#               empty, so this is purely a paging knob, not a total cap)
#
# Env (read from .env.local):
#   ADMIN_TOKEN   bearer for /api/admin/*  (required)
#   BASE_URL      optional override of the deployed app's base URL
#                 (default: https://pim-ai-global.vercel.app)
#
# Safety:
#   Stops with exit code 2 if 4+ of the most recent 10 docs failed (i.e.,
#   > 30 % failure rate). The operator should look at the log file before
#   restarting — usually the failure mode is the same across many docs and
#   needs a code fix rather than another retry.
#
# Output:
#   Per-doc OK/FAIL line on stdout AND appended to
#   /tmp/ingest-<collection>-<timestamp>.log, so you can `tail -f` the file
#   from another terminal while it's running.
#
# Resumability:
#   The script always asks /api/admin/catalogued for a fresh page of
#   catalogued docs, so a stop-and-restart picks up where it left off without
#   re-ingesting docs that already promoted to 'embedded' in the previous
#   run.

set -euo pipefail

COLLECTION="${1:?collection required: pefa_reports | pima_reports | wbg_pers | pim_literature}"
BATCH_SIZE="${2:-10}"
BASE_URL="${BASE_URL:-https://pim-ai-global.vercel.app}"

# Load ADMIN_TOKEN from .env.local without printing it. set -a exports all
# new variables until set +a so the env file can use plain KEY=value lines.
# This script lives at scripts/admin/, so .env.local is two dirs up.
set -a
. "$(dirname "$0")/../../.env.local"
set +a
: "${ADMIN_TOKEN:?ADMIN_TOKEN must be set (in .env.local or the environment)}"

TS=$(date +%s)
LOG="/tmp/ingest-${COLLECTION}-${TS}.log"
# Track every doc_id we've attempted this run (success OR fail). A failed
# ingest stays in 'catalogued' on the server, so without this dedupe the
# next catalogued-list page would return the same failures and the loop
# would spin forever — or trip the early-stop on those repeats alone.
ATTEMPTED=$(mktemp -t bulk-ingest-attempted.XXXXXX)
trap 'rm -f "$ATTEMPTED"' EXIT
echo "Logging to $LOG"
echo "Attempted-ids tracker: $ATTEMPTED"
echo "ts=$(date -u +%FT%TZ) collection=$COLLECTION batch=$BATCH_SIZE base=$BASE_URL" > "$LOG"

ok=0
fail=0
processed=0
# Rolling 10-item window of outcomes: 1 = fail, 0 = ok. Used for early-stop.
declare -a recent

# Pull the entire catalogued queue per iteration (or up to the endpoint's
# 1000-doc cap, added in PR #14). Failed ingests stay in 'catalogued' by
# design, so a smaller window would just keep returning the same failures
# and the ATTEMPTED filter would never find anything new. With 1000 we
# cover all current collections (PEFA peaks at ~828) in one fetch; for
# any collection that ever exceeds 1000, switch to the endpoint's
# ?offset=N param.
FETCH_LIMIT=1000

while true; do
  queue=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
    "$BASE_URL/api/admin/catalogued?collection=$COLLECTION&limit=$FETCH_LIMIT")
  total=$(echo "$queue" | python3 -c "import sys,json; print(json.load(sys.stdin)['total_catalogued'])")
  # Filter out doc_ids we've already attempted this run; emit at most BATCH_SIZE.
  attempted_csv=$(tr '\n' ',' < "$ATTEMPTED")
  ids=$(echo "$queue" | python3 -c "
import sys, json
already = set([s for s in sys.argv[1].split(',') if s])
batch = int(sys.argv[2])
fresh = [d for d in json.load(sys.stdin)['documents'] if d['id'] not in already][:batch]
for d in fresh:
    print(d['id'], '|', d['filename'])
" "$attempted_csv" "$BATCH_SIZE")

  if [ -z "$ids" ]; then
    echo "Queue empty (or all remaining already-attempted this run). Stopping." | tee -a "$LOG"
    break
  fi

  echo "" | tee -a "$LOG"
  echo "=== Batch start: queue=$total, processing up to $BATCH_SIZE ===" | tee -a "$LOG"

  while IFS='|' read -r doc_id filename; do
    doc_id=$(echo "$doc_id" | tr -d ' ')
    filename=$(echo "$filename" | sed 's/^ //')
    [ -z "$doc_id" ] && continue
    # Record BEFORE the curl so even a script crash mid-call doesn't loop.
    echo "$doc_id" >> "$ATTEMPTED"
    processed=$((processed + 1))

    t0=$(date +%s)
    # -m 130 covers the route's 120 s server-side cap + a little slack for
    # TLS + JSON parse on the way back.
    resp=$(curl -sS -m 130 -w "\n%{http_code}" -X POST \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"document_id\":\"$doc_id\"}" \
      "$BASE_URL/api/admin/ingest" || echo $'\n000')
    code=$(echo "$resp" | tail -1)
    body=$(echo "$resp" | sed '$d')
    dt=$(( $(date +%s) - t0 ))

    if [ "$code" = "200" ]; then
      ok=$((ok + 1))
      recent+=(0)
      chunks=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('chunk_count',0))" 2>/dev/null || echo "?")
      pages=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('page_count',0))" 2>/dev/null || echo "?")
      msg="OK   ${dt}s  chunks=$chunks pages=$pages  $filename"
    else
      fail=$((fail + 1))
      err=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error','(no error msg)'))" 2>/dev/null || echo "$body")
      # Classify upstream "PDF not available" failures as benign for early-stop
      # purposes. These mean the document is catalogued upstream but the PDF
      # itself isn't published / accessible — common for new PEFA 2026
      # assessments where the node exists but the report isn't out yet. They
      # need operator attention eventually, but they should NOT count toward
      # the rolling-failure circuit-breaker that's meant to catch real
      # systemic pipeline bugs (OpenAI down, schema drift, etc.).
      if echo "$err" | grep -qE 'No PDF link found|PDF download failed: 4[0-9]{2}|PDF too large|Parsed PDF text too short'; then
        recent+=(0)
        msg="SKIP ${dt}s  upstream PDF unavailable  $filename  -- $err"
      else
        recent+=(1)
        msg="FAIL ${dt}s  code=$code  $filename  -- $err"
      fi
    fi
    echo "[$processed] $msg" | tee -a "$LOG"

    # Keep window to last 10.
    if [ ${#recent[@]} -gt 10 ]; then
      recent=("${recent[@]:$((${#recent[@]} - 10))}")
    fi

    # Early-stop if >3 fails in last 10. The operator should inspect the log
    # before restarting; usually a code fix is needed.
    if [ ${#recent[@]} -ge 10 ]; then
      recent_fails=0
      for x in "${recent[@]}"; do recent_fails=$((recent_fails + x)); done
      if [ $recent_fails -gt 3 ]; then
        echo "" | tee -a "$LOG"
        echo "STOP: $recent_fails/10 recent failures. Manual review needed." | tee -a "$LOG"
        echo "Final: ok=$ok fail=$fail processed=$processed" | tee -a "$LOG"
        exit 2
      fi
    fi
  done <<< "$ids"
done

echo "" | tee -a "$LOG"
echo "DONE: ok=$ok fail=$fail processed=$processed" | tee -a "$LOG"
