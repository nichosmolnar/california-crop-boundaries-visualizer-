import * as maplibregl from "maplibre-gl";
import type {
  FilterSpecification,
  ExpressionSpecification,
  LayerSpecification,
  SourceSpecification,
  StyleSpecification,
} from "maplibre-gl";
import { Protocol } from "pmtiles";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { CDL, LEGEND_CODES, cdlName, fillColorExpression } from "./cdl";

const SOURCE_ID = "crops";
const CDL_PROP = "CDL";
const tilesUrl = (path: string) =>
  new URL(`${import.meta.env.BASE_URL}tiles/${path}`, location.href).href;

let year: number;

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
const YEAR_STORAGE_KEY = "year";

// Data-driven paint changes and setFilter make MapLibre re-parse every loaded
// tile, so hover effects only touch constant paint values and feature-state.

const fillLayerId = (code: number | "other") => `${SOURCE_ID}-fill-${code}`;
const FILL_LAYER_IDS = [...LEGEND_CODES.map(fillLayerId), fillLayerId("other")];
const OUTLINE_LAYER_ID = `${SOURCE_ID}-outline`;
const CROP_LAYER_IDS = [...FILL_LAYER_IDS, OUTLINE_LAYER_ID];

const FILL_OPACITY = 0.85;
const DIMMED_OPACITY = 0.12;

let focusedLayer: string | null = null;

const fillOpacity = (id: string) =>
  focusedLayer === null || focusedLayer === id ? FILL_OPACITY : DIMMED_OPACITY;

function setFocusedCategory(id: string | null) {
  focusedLayer = id;
  for (const l of FILL_LAYER_IDS) {
    if (map.getLayer(l)) map.setPaintProperty(l, "fill-opacity", fillOpacity(l));
  }
}

let hovered: string | number | null = null;

function setHovered(id: string | number | null) {
  if (id === hovered) return;
  if (map.getSource(SOURCE_ID)) {
    if (hovered !== null) {
      map.setFeatureState({ source: SOURCE_ID, sourceLayer: "crops", id: hovered }, { hover: false });
    }
    if (id !== null) {
      map.setFeatureState({ source: SOURCE_ID, sourceLayer: "crops", id }, { hover: true });
    }
  }
  hovered = id;
}

const isHovered: ExpressionSpecification = ["boolean", ["feature-state", "hover"], false];

function cropLayers(dark: boolean): LayerSpecification[] {
  const fillColor = fillColorExpression(CDL_PROP) as ExpressionSpecification;
  const fill = (id: string, filter: FilterSpecification): LayerSpecification => ({
    id,
    type: "fill",
    source: SOURCE_ID,
    "source-layer": "crops",
    filter,
    paint: {
      "fill-color": fillColor,
      "fill-opacity": fillOpacity(id),
      "fill-opacity-transition": { duration: 150, delay: 0 },
    },
  });
  return [
    ...LEGEND_CODES.map((code) => fill(fillLayerId(code), ["==", ["get", CDL_PROP], code])),
    fill(fillLayerId("other"), ["!", ["in", ["get", CDL_PROP], ["literal", LEGEND_CODES]]]),
    // Field outlines double as the hover highlight; a separate highlight layer
    // would build a second line bucket for every field. Fields only carry
    // CSBID (the feature id) from z10.
    {
      id: OUTLINE_LAYER_ID,
      type: "line",
      source: SOURCE_ID,
      "source-layer": "crops",
      minzoom: 10,
      paint: {
        "line-color": ["case", isHovered, dark ? "#fff" : "#000", "#333"],
        "line-width": ["case", isHovered, 2, 0.3],
        "line-opacity": ["step", ["zoom"], ["case", isHovered, 1, 0], 11, ["case", isHovered, 1, 0.5]],
      },
    },
  ];
}

const cropSource = (): SourceSpecification => ({
  type: "vector",
  url: `pmtiles://${tilesUrl(`ca_${year}.pmtiles`)}`,
  promoteId: { crops: "CSBID" },
  attribution:
    '<a href="https://www.nass.usda.gov/Research_and_Science/Crop-Sequence-Boundaries/">USDA NASS Crop Sequence Boundaries</a>',
});

// The crop overlay sits below the basemap's first label layer.
const firstLabelLayer = (layers: LayerSpecification[]) =>
  layers.find((l) => l.type === "symbol" && !CROP_LAYER_IDS.includes(l.id))?.id;

// setStyle replaces every source and layer, so the crop overlay is spliced
// into each basemap style.
function withCropLayers(style: StyleSpecification, dark: boolean): StyleSpecification {
  const layers = [...style.layers];
  const before = layers.findIndex((l) => l.id === firstLabelLayer(style.layers));
  layers.splice(before < 0 ? layers.length : before, 0, ...cropLayers(dark));
  return { ...style, sources: { ...style.sources, [SOURCE_ID]: cropSource() }, layers };
}

let basemap: Basemap;

function setBasemap(b: Basemap) {
  basemap = b;
  localStorage.setItem(BASEMAP_STORAGE_KEY, b.id);
  map.setStyle(b.style, {
    diff: false,
    transformStyle: (_prev, next) => withCropLayers(next, b.dark),
  });
}

// Swaps only the crop source and layers, leaving the basemap in place.
function setYear(y: number) {
  year = y;
  localStorage.setItem(YEAR_STORAGE_KEY, String(y));
  legendTitle.textContent = `California crops, ${y}`;
  if (!map.getSource(SOURCE_ID)) return;

  hideTooltip();
  const before = firstLabelLayer(map.getStyle().layers);
  for (const id of CROP_LAYER_IDS) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  map.removeSource(SOURCE_ID);
  hovered = null;
  map.addSource(SOURCE_ID, cropSource());
  for (const layer of cropLayers(basemap.dark)) map.addLayer(layer, before);
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

const yearControl = document.getElementById("year")!;
const yearSlider = document.getElementById("year-slider") as HTMLInputElement;
const yearValue = document.getElementById("year-value")!;

async function init() {
  const res = await fetch(tilesUrl("years.json"));
  const years: number[] = await res.json();
  const saved = Number(localStorage.getItem(YEAR_STORAGE_KEY));
  const initialYear = years.includes(saved) ? saved : years[years.length - 1];

  // The slider steps through indices so gaps in the available years are skipped.
  yearSlider.min = "0";
  yearSlider.max = String(years.length - 1);
  yearSlider.value = String(years.indexOf(initialYear));
  document.getElementById("year-min")!.textContent = String(years[0]);
  document.getElementById("year-max")!.textContent = String(years[years.length - 1]);
  const showYear = (y: number) => {
    yearValue.textContent = String(y);
    yearSlider.setAttribute("aria-valuetext", String(y));
  };
  showYear(initialYear);
  yearSlider.addEventListener("input", () => {
    const y = years[Number(yearSlider.value)];
    showYear(y);
    if (y !== year) setYear(y);
  });
  yearControl.hidden = years.length < 2;

  setYear(initialYear);
  setBasemap(initialBasemap);
}

const basemapSelect = document.getElementById("basemap-select") as HTMLSelectElement;
for (const b of BASEMAPS) {
  basemapSelect.add(new Option(b.label, b.id, false, b.id === initialBasemap.id));
}
basemapSelect.addEventListener("change", () => {
  setBasemap(BASEMAPS.find((b) => b.id === basemapSelect.value)!);
});

const tooltip = document.getElementById("tooltip")!;
const TOOLTIP_OFFSET_PX = 12;

// Zoomed out, fields are only a few pixels wide, so hit-test a small box
// rather than the exact cursor point.
const HOVER_TOLERANCE_PX = 3;

let tooltipKey: string | null = null;
let pendingPoint: maplibregl.Point | null = null;
let frame = 0;

function hideTooltip() {
  pendingPoint = null;
  tooltipKey = null;
  tooltip.hidden = true;
  setHovered(null);
}

function tooltipHTML(p: Record<string, string | number>, code: number): string {
  const title = `<strong>${cdlName(code)}</strong> <span class="muted">(CDL ${code})</span><br>`;
  // Low-zoom tiles carry only the crop code; field attributes start at z10.
  if (p.CSBID === undefined) return `${title}<span class="muted">Zoom in for field details</span>`;
  return (
    title +
    `${Number(p.CSBACRES).toLocaleString(undefined, { maximumFractionDigits: 1 })} acres<br>` +
    `${p.CNTY} County<br>` +
    `<span class="muted">CSBID ${p.CSBID}</span>`
  );
}

function updateHover() {
  frame = 0;
  const point = pendingPoint;
  if (!point || map.isMoving() || !map.getLayer(FILL_LAYER_IDS[0])) return;
  const { x, y } = point;
  const r = HOVER_TOLERANCE_PX;
  const f = map.queryRenderedFeatures(
    [
      [x - r, y - r],
      [x + r, y + r],
    ],
    { layers: FILL_LAYER_IDS },
  )[0];
  if (!f) {
    hideTooltip();
    return;
  }

  const p = f.properties as Record<string, string | number>;
  const code = Number(p[CDL_PROP]);
  const key = f.id !== undefined ? `id:${f.id}` : `code:${code}`;
  if (key !== tooltipKey) {
    tooltipKey = key;
    tooltip.innerHTML = tooltipHTML(p, code);
    setHovered(f.id ?? null);
  }
  tooltip.hidden = false;

  const container = map.getContainer();
  const left =
    x + TOOLTIP_OFFSET_PX + tooltip.offsetWidth > container.clientWidth
      ? x - TOOLTIP_OFFSET_PX - tooltip.offsetWidth
      : x + TOOLTIP_OFFSET_PX;
  const top =
    y + TOOLTIP_OFFSET_PX + tooltip.offsetHeight > container.clientHeight
      ? y - TOOLTIP_OFFSET_PX - tooltip.offsetHeight
      : y + TOOLTIP_OFFSET_PX;
  tooltip.style.transform = `translate(${left}px, ${top}px)`;
}

map.on("mousemove", (e) => {
  pendingPoint = e.point;
  if (!frame) frame = requestAnimationFrame(updateHover);
});
map.on("mouseout", hideTooltip);
map.on("movestart", hideTooltip);

// setStyle drops feature-state along with the old source.
map.on("style.load", () => {
  hovered = null;
  hideTooltip();
});

const legend = document.getElementById("legend")!;
const legendRow = (layer: string, swatch: string, label: string) =>
  `<div class="row" data-layer="${layer}">${swatch}${label}</div>`;
legend.innerHTML =
  `<h2></h2>` +
  `<p class="muted">Top classes by acreage, 2018–2025</p>` +
  LEGEND_CODES.map((code) =>
    legendRow(
      fillLayerId(code),
      `<span class="swatch" style="background:${CDL[code].color}"></span>`,
      CDL[code].name,
    ),
  ).join("") +
  legendRow(fillLayerId("other"), `<span class="swatch other"></span>`, "Other / unlisted");
const legendTitle = legend.querySelector("h2")!;

let activeRow: HTMLElement | null = null;

legend.addEventListener("mouseover", (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>(".row[data-layer]");
  if (row === activeRow) return;
  activeRow?.classList.remove("active");
  activeRow = row;
  row?.classList.add("active");
  setFocusedCategory(row?.dataset.layer ?? null);
});
legend.addEventListener("mouseleave", () => {
  activeRow?.classList.remove("active");
  activeRow = null;
  setFocusedCategory(null);
});

init();
