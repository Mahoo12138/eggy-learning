#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
build_dir=${1:-"$project_dir/build"}

cmake -S "$project_dir" -B "$build_dir" -DCMAKE_BUILD_TYPE=Debug -DBUILD_TESTING=ON
cmake --build "$build_dir" --parallel
ctest --test-dir "$build_dir" --output-on-failure

runtime=$(mktemp -d /tmp/patrol-manual-smoke.XXXXXX)
trap 'rm -rf "$runtime"' EXIT HUP INT TERM
"$build_dir/patrold" --runtime "$runtime" --worker "$build_dir/patrol-worker" \
  --timeout-ms 500 --once --spawn demo:ok
grep -q '"reportReceived":true' "$runtime/state.json"
printf 'verification passed: build, CTest and smoke run\n'
