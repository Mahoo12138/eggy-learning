#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
docker run --rm \
  -v "$project_dir:/courseware:ro" \
  alpine:3.20 \
  sh -lc 'apk add --no-cache build-base cmake >/dev/null && cp -R /courseware /tmp/patrol && cd /tmp/patrol && ./verify.sh /tmp/patrol-build'
