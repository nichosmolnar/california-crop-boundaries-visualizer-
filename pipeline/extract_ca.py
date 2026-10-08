"""Extract California 2025 crop boundaries from the national CSB geodatabase."""

import time
from pathlib import Path

import pyogrio

ROOT = Path(__file__).resolve().parent.parent
GDB = ROOT / "NationalCSB_2018-2025_rev23" / "CSB1825.gdb"
LAYER = "national1825"
OUT_DIR = ROOT / "data"

STATE_FIPS = "06"
YEAR = 2025
CDL_COL = f"CDL{YEAR}"
COLUMNS = ["CSBID", "CSBACRES", "CNTY", CDL_COL]


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    stem = OUT_DIR / f"ca_{YEAR}"

    t0 = time.time()
    gdf = pyogrio.read_dataframe(
        GDB,
        layer=LAYER,
        # GDAL returns no rows for "=", "LIKE '06'" or "LIKE '06%'" on this gdb's
        # STATEFIPS (even with OPENFILEGDB_USE_INDEX=NO); only a "%..%" pattern
        # matches, so filter loosely here and exactly below.
        where=f"STATEFIPS LIKE '%{STATE_FIPS}%'",
        columns=COLUMNS + ["STATEFIPS"],
        use_arrow=True,
    )
    gdf = gdf[gdf["STATEFIPS"] == STATE_FIPS].drop(columns="STATEFIPS")
    print(f"read {len(gdf):,} features in {time.time() - t0:.1f}s")

    gdf = gdf.to_crs(4326)
    gdf["CSBACRES"] = gdf["CSBACRES"].round(2)

    parquet_path = stem.with_suffix(".parquet")
    fgb_path = stem.with_suffix(".fgb")
    gdf.to_parquet(parquet_path, compression="zstd")
    pyogrio.write_dataframe(gdf, fgb_path, driver="FlatGeobuf")

    for p in (parquet_path, fgb_path):
        print(f"{p.name}: {p.stat().st_size / 1e6:.1f} MB")

    counts = gdf[CDL_COL].value_counts()
    print(f"\n{len(counts)} distinct {CDL_COL} codes (code: features, acres)")
    acres = gdf.groupby(CDL_COL)["CSBACRES"].sum()
    for code, n in counts.items():
        print(f"  {code:>4}: {n:>8,}  {acres[code]:>12,.0f}")


if __name__ == "__main__":
    main()
