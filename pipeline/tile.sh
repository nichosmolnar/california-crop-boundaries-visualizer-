#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
YEAR="${1:-2025}"
IN="data/ca_${YEAR}.fgb"
OUT="data/ca_${YEAR}.pmtiles"

tippecanoe -o "$OUT" -l crops -zg \
  -T "CDL${YEAR}:int" \
  --coalesce-densest-as-needed --extend-zooms-if-still-dropping \
  --force "$IN"

mkdir -p web/public/tiles
cp "$OUT" web/public/tiles/
ls -lh "$OUT"
