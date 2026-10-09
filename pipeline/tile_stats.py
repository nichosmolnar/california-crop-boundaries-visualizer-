"""Print per-zoom tile counts and sizes for a PMTiles archive."""

import sys
from collections import defaultdict
from pathlib import Path

from pmtiles.reader import MmapSource, Reader, all_tiles


def main(path: str) -> None:
    stats = defaultdict(lambda: [0, 0, 0, None])  # count, total, max, max_xyz
    with open(path, "rb") as f:
        get_bytes = MmapSource(f)
        for (z, x, y), data in all_tiles(get_bytes):
            s = stats[z]
            s[0] += 1
            s[1] += len(data)
            if len(data) > s[2]:
                s[2], s[3] = len(data), (z, x, y)
        header = Reader(get_bytes).header()

    print(f"{Path(path).name}: {Path(path).stat().st_size / 1e6:.1f} MB, "
          f"zooms {header['min_zoom']}-{header['max_zoom']}")
    print(" z   tiles    total MB   max KB   largest tile")
    for z in sorted(stats):
        count, total, biggest, xyz = stats[z]
        print(f"{z:>2} {count:>7} {total / 1e6:>11.1f} {biggest / 1e3:>8.0f}   "
              f"{'/'.join(map(str, xyz))}")


if __name__ == "__main__":
    main(sys.argv[1])
