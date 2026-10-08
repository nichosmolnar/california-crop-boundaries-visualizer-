#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
YEAR="${1:-2025}"
CDL="CDL${YEAR}"
IN="data/ca_${YEAR}.fgb"
OVERVIEW_FULL="data/ca_${YEAR}_overview_full.pmtiles"
OVERVIEW="data/ca_${YEAR}_overview.pmtiles"
LOW="data/ca_${YEAR}_low.pmtiles"
HIGH="data/ca_${YEAR}_high.pmtiles"
OUT="data/ca_${YEAR}.pmtiles"

# Overview (z0-6): fields are far below pixel size here, so merge densely
# regardless of crop to keep coverage solid. Recoloring is imperceptible at
# these zooms. Built with -zg so merging matches the original single tileset,
# then clipped to z0-6 below.
tippecanoe -o "$OVERVIEW_FULL" -l crops -zg \
  -y "$CDL" -T "$CDL:int" \
  --coalesce-densest-as-needed --extend-zooms-if-still-dropping \
  --force "$IN" &

# Low zooms (z7-9): crop code only, so coalescing merges same-crop neighbors and
# never recolors a field. Detail 10 (~60 m at z9, still sub-pixel) keeps tiles
# under 500 KB without dropping; --drop-densest-as-needed is only a safety net.
tippecanoe -o "$LOW" -l crops -Z7 -z9 \
  -y "$CDL" -T "$CDL:int" \
  -d 10 -D 10 \
  --coalesce --reorder \
  --drop-densest-as-needed \
  --force "$IN" &

# High zooms (z10-12): every field with full attributes, never merged or dropped.
# Capped at z12 (~2 m precision): z13 adds ~33 MB and pushes the archive past
# GitHub's 100 MB file limit.
tippecanoe -o "$HIGH" -l crops -Z10 -z12 \
  -T "$CDL:int" \
  --no-simplification-of-shared-nodes \
  --no-feature-limit --no-tile-size-limit \
  --force "$IN" &

wait

# -pk: tile-join otherwise silently skips tiles over 500 KB.
tile-join -pk -z6 -o "$OVERVIEW" --force "$OVERVIEW_FULL"
tile-join -pk -o "$OUT" --force "$OVERVIEW" "$LOW" "$HIGH"

mkdir -p web/public/tiles
cp "$OUT" web/public/tiles/
.venv/bin/python pipeline/tile_stats.py "$OUT"
