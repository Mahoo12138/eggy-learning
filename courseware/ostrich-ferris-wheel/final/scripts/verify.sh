#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

cleanup() {
    make clean >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

python3 scripts/verify_manifest.py

if grep -REn 'TO''DO|FIXME|TBD|伪代码|省略实现' Core tests; then
    echo "Implementation contains an unfinished marker." >&2
    exit 1
fi

make clean
make all
make test
demo_output=$(make --no-print-directory demo)
printf '%s\n' "$demo_output"
printf '%s\n' "$demo_output" | grep -q 'RUNNING'
printf '%s\n' "$demo_output" | grep -q 'PARKING'
printf '%s\n' "$demo_output" | grep -q 'FAULT'
printf '%s\n' "$demo_output" | grep -q 'DEMO PASS'

echo "VERIFY PASS: complete host build, twelve test executables, target application stub test, and integrated demo."
