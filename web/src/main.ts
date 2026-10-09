import * as maplibregl from "maplibre-gl";
import type {
  FilterSpecification,
  ExpressionSpecification,
  LayerSpecification,
  StyleSpecification,
} from "maplibre-gl";
import { Protocol } from "pmtiles";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { CDL, LEGEND_CODES, cdlName, fillColorExpression } from "./cdl";

const YEAR = 2025;
const SOURCE_ID = `ca${YEAR}`;
const CDL_PROP = `CDL${YEAR}`;
const TILES_URL = new URL(
  `${import.meta.env.BASE_URL}tiles/ca_${YEAR}.pmtiles`,
  location.href,
).href;

// MapLibre resolves its worker relative to its own module URL, which breaks
// once Vite pre-bundles or hashes it.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

interface Basemap {
  id: string;
  label: string;
  style: string | StyleSpecification;
  dark: boolean;
}

const MAPTILER_KEY: string | undefined = import.meta.env.VITE_MAPTILER_KEY;

// Self-hosted copy (e.g. "pmtiles://…/landcover.pmtiles") takes precedence
// over MapTiler Cloud.
const LANDCOVER_TILES: string | undefined =
  import.meta.env.VITE_LANDCOVER_TILES ??
  (MAPTILER_KEY && `https://api.maptiler.com/tiles/landcover/tiles.json?key=${MAPTILER_KEY}`);

const LANDCOVER_COLORS: Record<string, string> = {
  farmland: "#eef0d5",
  wood: "#add19e",
  grass: "#cdebb0",
  wetland: "#b5d6c3",
  sand: "#f5e9c6",
  rock: "#dedad6",
  ice: "#f3f8fb",
};

function landcoverStyle(tiles: string): StyleSpecification {
  return {
    version: 8,
    sources: { landcover: { type: "vector", url: tiles } },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#f8f4f0" } },
      {
        id: "landcover",
        type: "fill",
        source: "landcover",
        "source-layer": "landcover",
        paint: {
          "fill-color": [
            "match",
            ["get", "class"],
            ...Object.entries(LANDCOVER_COLORS).flat(),
            "#e8e4dc",
          ] as unknown as ExpressionSpecification,
        },
      },
    ],
  };
}

const BASEMAPS: Basemap[] = [
  {
    id: "positron",
    label: "Light (Positron)",
    style: "https://tiles.openfreemap.org/styles/positron",
    dark: false,
  },
  {
    id: "dark-matter",
    label: "Dark Matter",
    style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    dark: true,
  },
  ...(MAPTILER_KEY
    ? [
        {
          id: "maptiler-basic",
          label: "MapTiler Basic",
          style: `https://api.maptiler.com/maps/basic-v2/style.json?key=${MAPTILER_KEY}`,
          dark: false,
        },
      ]
    : []),
  ...(LANDCOVER_TILES
    ? [
        {
          id: "landcover",
          label: "Landcover",
          style: landcoverStyle(LANDCOVER_TILES),
          dark: false,
        },
      ]
    : []),
];

const BASEMAP_STORAGE_KEY = "basemap";

let highlightedId: string | number = "";

const highlightFilter = (): FilterSpecification => ["==", ["get", "CSBID"], highlightedId];

function setHighlight(id: string | number) {
  highlightedId = id;
  if (map.getLayer(`${SOURCE_ID}-highlight`)) {
    map.setFilter(`${SOURCE_ID}-highlight`, highlightFilter());
  }
}

function cropLayers(dark: boolean): LayerSpecification[] {
  return [
    {
      id: `${SOURCE_ID}-fill`,
      type: "fill",
      source: SOURCE_ID,
      "source-layer": "crops",
      paint: {
        "fill-color": fillColorExpression(CDL_PROP) as ExpressionSpecification,
        "fill-opacity": 0.85,
      },
    },
    {
      id: `${SOURCE_ID}-outline`,
      type: "line",
      source: SOURCE_ID,
      "source-layer": "crops",
      minzoom: 11,
      paint: { "line-color": "#333", "line-width": 0.3, "line-opacity": 0.5 },
    },
    {
      id: `${SOURCE_ID}-highlight`,
      type: "line",
      source: SOURCE_ID,
      "source-layer": "crops",
      filter: highlightFilter(),
      paint: { "line-color": dark ? "#fff" : "#000", "line-width": 2 },
    },
  ];
}

// setStyle replaces every source and layer, so the crop overlay is spliced
// into each basemap style below its first label layer.
function withCropLayers(style: StyleSpecification, dark: boolean): StyleSpecification {
  const layers = [...style.layers];
  const firstSymbol = layers.findIndex((l) => l.type === "symbol");
  layers.splice(firstSymbol < 0 ? layers.length : firstSymbol, 0, ...cropLayers(dark));
  return {
    ...style,
    sources: {
      ...style.sources,
      [SOURCE_ID]: {
        type: "vector",
        url: `pmtiles://${TILES_URL}`,
        attribution:
          '<a href="https://www.nass.usda.gov/Research_and_Science/Crop-Sequence-Boundaries/">USDA NASS Crop Sequence Boundaries</a>',
      },
    },
    layers,
  };
}

function setBasemap(basemap: Basemap) {
  localStorage.setItem(BASEMAP_STORAGE_KEY, basemap.id);
  map.setStyle(basemap.style, {
    diff: false,
    transformStyle: (_prev, next) => withCropLayers(next, basemap.dark),
  });
}

const initialBasemap =
  BASEMAPS.find((b) => b.id === localStorage.getItem(BASEMAP_STORAGE_KEY)) ?? BASEMAPS[0];

const map = new maplibregl.Map({
  container: "map",
  center: [-119.5, 37.2],
  zoom: 5.5,
  hash: true,
});
map.addControl(new maplibregl.NavigationControl(), "top-right");
setBasemap(initialBasemap);

const basemapSelect = document.getElementById("basemap-select") as HTMLSelectElement;
for (const b of BASEMAPS) {
  basemapSelect.add(new Option(b.label, b.id, false, b.id === initialBasemap.id));
}
basemapSelect.addEventListener("change", () => {
  setBasemap(BASEMAPS.find((b) => b.id === basemapSelect.value)!);
});

const popup = new maplibregl.Popup({ closeButton: true, maxWidth: "260px" });

// Zoomed out, fields are only a few pixels wide, so hit-test a small box
// rather than the exact click point.
const CLICK_TOLERANCE_PX = 3;

map.on("click", (e) => {
  const { x, y } = e.point;
  const r = CLICK_TOLERANCE_PX;
  const f = map.queryRenderedFeatures(
    [
      [x - r, y - r],
      [x + r, y + r],
    ],
    { layers: [`${SOURCE_ID}-fill`] },
  )[0];
  if (!f) return;
  const p = f.properties as Record<string, string | number>;
  const code = Number(p[CDL_PROP]);
  const title = `<strong>${cdlName(code)}</strong> <span class="muted">(CDL ${code})</span><br>`;

  // Low-zoom tiles carry only the crop code; field attributes start at z10.
  if (p.CSBID === undefined) {
    setHighlight("");
    popup
      .setLngLat(e.lngLat)
      .setHTML(`${title}<span class="muted">Zoom in for field details</span>`)
      .addTo(map);
    return;
  }

  setHighlight(p.CSBID);
  popup
    .setLngLat(e.lngLat)
    .setHTML(
      title +
        `${Number(p.CSBACRES).toLocaleString(undefined, { maximumFractionDigits: 1 })} acres<br>` +
        `${p.CNTY} County<br>` +
        `<span class="muted">CSBID ${p.CSBID}</span>`,
    )
    .addTo(map);
});

popup.on("close", () => setHighlight(""));

map.on("mouseenter", `${SOURCE_ID}-fill`, () => {
  map.getCanvas().style.cursor = "pointer";
});
map.on("mouseleave", `${SOURCE_ID}-fill`, () => {
  map.getCanvas().style.cursor = "";
});

const legend = document.getElementById("legend")!;
legend.innerHTML =
  `<h2>California crops, ${YEAR}</h2>` +
  `<p class="muted">Top classes by acreage</p>` +
  LEGEND_CODES.map(
    (code) =>
      `<div class="row"><span class="swatch" style="background:${CDL[code].color}"></span>${CDL[code].name}</div>`,
  ).join("") +
  `<div class="row"><span class="swatch other"></span>Other / unlisted</div>`;
