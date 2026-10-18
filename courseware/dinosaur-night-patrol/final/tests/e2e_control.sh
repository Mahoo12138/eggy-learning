#!/bin/sh
set -eu

patrold=$1
worker=$2
patrolctl=$3
runtime=$(mktemp -d /tmp/patrol-e2e-control.XXXXXX)
daemon_pid=''
cleanup() {
  if test -n "$daemon_pid" && kill -0 "$daemon_pid" 2>/dev/null; then
    kill "$daemon_pid" 2>/dev/null || true
    wait "$daemon_pid" 2>/dev/null || true
  fi
  rm -rf "$runtime"
}
trap cleanup EXIT HUP INT TERM

"$patrold" --runtime "$runtime" --worker "$worker" --timeout-ms 3000 >"$runtime/stdout" 2>"$runtime/stderr" &
daemon_pid=$!

tries=0
while ! test -p "$runtime/control.fifo" || ! test -f "$runtime/state.json"; do
  tries=$((tries + 1))
  test "$tries" -lt 100
  sleep 0.02
done

"$patrolctl" --runtime "$runtime" run live hang
tries=0
while ! grep -q '"name":"live"' "$runtime/state.json" || ! grep -q '"runningCount":1' "$runtime/state.json"; do
  tries=$((tries + 1))
  test "$tries" -lt 100
  sleep 0.02
done

"$patrolctl" --runtime "$runtime" status >"$runtime/status.out"
grep -q '"name":"live"' "$runtime/status.out"
"$patrolctl" --runtime "$runtime" stop
wait "$daemon_pid"
daemon_pid=''
grep -q 'control_status' "$runtime/events.log"
grep -q 'control_stop' "$runtime/events.log"
grep -q 'shutdown_term' "$runtime/events.log"
grep -q '"runningCount":0' "$runtime/state.json"
