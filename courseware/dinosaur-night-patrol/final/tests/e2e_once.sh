#!/bin/sh
set -eu

patrold=$1
worker=$2
runtime=$(mktemp -d /tmp/patrol-e2e-once.XXXXXX)
trap 'rm -rf "$runtime"' EXIT HUP INT TERM

"$patrold" --runtime "$runtime" --worker "$worker" --timeout-ms 300 --once \
  --spawn north:ok --spawn south:fail --spawn stuck:hang

test -f "$runtime/state.json"
test -f "$runtime/events.log"
grep -q '"workerCount":3' "$runtime/state.json"
grep -q '"runningCount":0' "$runtime/state.json"
grep -q '"name":"north"' "$runtime/state.json"
grep -q '"name":"south"' "$runtime/state.json"
grep -q '"name":"stuck"' "$runtime/state.json"
grep -q '"timedOut":true' "$runtime/state.json"
grep -q 'worker_spawn' "$runtime/events.log"
grep -q 'report' "$runtime/events.log"
grep -q 'timeout_term' "$runtime/events.log"
grep -q 'worker_exit' "$runtime/events.log"
