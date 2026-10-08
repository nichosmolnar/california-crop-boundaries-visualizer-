#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
YEAR="${1:-2025}"
CDL="CDL${YEAR}"
IN="data/ca_${YEAR}.fgb"
LOW="data/ca_${YEAR}_low.pmtiles"
HIGH="data/ca_${YEAR}_high.pmtiles"
OUT="data/ca_${YEAR}.pmtiles"

# Low zooms: crop code only, so coalescing merges same-crop neighbors and never
# recolors a field. Detail 10 (~60 m at z9, still sub-pixel) keeps tiles under
# 500 KB without dropping; --drop-densest-as-needed is only a safety net.
tippecanoe -o "$LOW" -l crops -Z0 -z9 \
  -y "$CDL" -T "$CDL:int" \
  -d 10 -D 10 \
  --coalesce --reorder \
  --drop-densest-as-needed \
  --force "$IN"

# High zooms: every field with full attributes, never merged or dropped.
# Capped at z12 (~2 m precision): z13 adds ~33 MB and pushes the archive past
# GitHub's 100 MB file limit.
tippecanoe -o "$HIGH" -l crops -Z10 -z12 \
  -T "$CDL:int" \
  --no-simplification-of-shared-nodes \
  --no-feature-limit --no-tile-size-limit \
  --force "$IN"

# -pk: tile-join otherwise silently skips tiles over 500 KB.
tile-join -pk -o "$OUT" --force "$LOW" "$HIGH"

mkdir -p web/public/tiles
cp "$OUT" web/public/tiles/
.venv/bin/python pipeline/tile_stats.py "$OUT"
