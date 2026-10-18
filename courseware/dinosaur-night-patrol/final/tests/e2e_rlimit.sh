#!/bin/sh
set -eu

patrold=$1
worker=$2
runtime=$(mktemp -d /tmp/patrol-e2e-rlimit.XXXXXX)
trap 'rm -rf "$runtime"' EXIT HUP INT TERM

"$patrold" --runtime "$runtime" --worker "$worker" --timeout-ms 5000 --once --spawn burner:cpu

grep -q '"name":"burner"' "$runtime/state.json"
grep -Eq '"termSignal":(9|24)' "$runtime/state.json"
grep -q '"timedOut":false' "$runtime/state.json"
grep -q 'worker_exit' "$runtime/events.log"
