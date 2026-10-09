"""Extract per-year California crop boundaries from the national CSB geodatabase.

Usage: extract_ca.py [YEAR ...]   (defaults to every year, 2018-2025)
"""

import sys
import time
from pathlib import Path

import pandas as pd
import pyogrio

ROOT = Path(__file__).resolve().parent.parent
GDB = ROOT / "NationalCSB_2018-2025_rev23" / "CSB1825.gdb"
LAYER = "national1825"
OUT_DIR = ROOT / "data"

STATE_FIPS = "06"
YEARS = range(2018, 2026)
COLUMNS = ["CSBID", "CSBACRES", "CNTY"]
# Every year's output uses the same attribute name so the web map can share
# one style across tilesets.
CDL_COL = "CDL"


def print_summary(label: str, acres: pd.Series, counts: pd.Series) -> None:
    print(f"\n{label}: {len(counts)} distinct codes (code: features, acres)")
    for code in acres.sort_values(ascending=False).index:
        print(f"  {code:>4}: {counts[code]:>9,}  {acres[code]:>13,.0f}")


def main(years: list[int]) -> None:
    cdl_cols = [f"CDL{y}" for y in years]

    t0 = time.time()
    gdf = pyogrio.read_dataframe(
        GDB,
        layer=LAYER,
        # GDAL returns no rows for "=", "LIKE '06'" or "LIKE '06%'" on this gdb's
        # STATEFIPS (even with OPENFILEGDB_USE_INDEX=NO); only a "%..%" pattern
        # matches, so filter loosely here and exactly below.
        where=f"STATEFIPS LIKE '%{STATE_FIPS}%'",
        columns=COLUMNS + cdl_cols + ["STATEFIPS"],
        use_arrow=True,
    )
    gdf = gdf[gdf["STATEFIPS"] == STATE_FIPS].drop(columns="STATEFIPS")
    print(f"read {len(gdf):,} features in {time.time() - t0:.1f}s")

    gdf = gdf.to_crs(4326)
    gdf["CSBACRES"] = gdf["CSBACRES"].round(2)

    all_acres = pd.Series(dtype=float)
    all_counts = pd.Series(dtype=int)
    for year, col in zip(years, cdl_cols):
        year_dir = OUT_DIR / str(year)
        year_dir.mkdir(parents=True, exist_ok=True)
        stem = year_dir / f"ca_{year}"

        ygdf = gdf[COLUMNS + [col, "geometry"]].rename(columns={col: CDL_COL})
        parquet_path = stem.with_suffix(".parquet")
        fgb_path = stem.with_suffix(".fgb")
        ygdf.to_parquet(parquet_path, compression="zstd")
        pyogrio.write_dataframe(ygdf, fgb_path, driver="FlatGeobuf")
        for p in (parquet_path, fgb_path):
            print(f"{p.relative_to(ROOT)}: {p.stat().st_size / 1e6:.1f} MB")

        acres = ygdf.groupby(CDL_COL)["CSBACRES"].sum()
        counts = ygdf[CDL_COL].value_counts()
        print_summary(str(year), acres, counts)
        all_acres = all_acres.add(acres, fill_value=0)
        all_counts = all_counts.add(counts, fill_value=0).astype(int)

    if len(years) > 1:
        print_summary(f"{years[0]}-{years[-1]} combined", all_acres, all_counts)


if __name__ == "__main__":
    main([int(a) for a in sys.argv[1:]] or list(YEARS))
