#!/bin/sh
set -eu

rm -rf dist
mkdir -p dist
cp -R index.html style.css script.js collection.json covers SAMPLES dist/
find dist -name '.DS_Store' -delete

app_version=$(tr -d '[:space:]' < VERSION)
build_commit=${COMMIT_REF:-local}
short_commit=$(printf '%.7s' "$build_commit")
printf '{"version":"%s","commit":"%s"}\n' "$app_version" "$short_commit" > dist/version.json
