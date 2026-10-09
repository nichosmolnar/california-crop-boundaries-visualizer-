#!/usr/bin/env bash
# Usage: tile.sh [YEAR ...]   (defaults to every year, 2018-2025)
set -euo pipefail

cd "$(dirname "$0")/.."
YEARS=("$@")
[ ${#YEARS[@]} -eq 0 ] && YEARS=(2018 2019 2020 2021 2022 2023 2024 2025)
CDL="CDL"
TILES_DIR="web/public/tiles"
mkdir -p "$TILES_DIR"

for YEAR in "${YEARS[@]}"; do
  DIR="data/${YEAR}"
  IN="${DIR}/ca_${YEAR}.fgb"
  LOW="${DIR}/ca_${YEAR}_low.pmtiles"
  HIGH="${DIR}/ca_${YEAR}_high.pmtiles"
  OUT="${DIR}/ca_${YEAR}.pmtiles"

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

  cp "$OUT" "$TILES_DIR/"
  .venv/bin/python pipeline/tile_stats.py "$OUT"
done

# The web map offers whichever years have a tileset.
years=$(ls "$TILES_DIR" | sed -n 's/^ca_\([0-9]\{4\}\)\.pmtiles$/\1/p' | sort | paste -sd, -)
echo "[${years}]" > "$TILES_DIR/years.json"
echo "years.json: [${years}]"
