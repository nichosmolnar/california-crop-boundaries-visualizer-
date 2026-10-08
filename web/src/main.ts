import * as maplibregl from "maplibre-gl";
import type { FilterSpecification, ExpressionSpecification } from "maplibre-gl";
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

const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/positron",
  center: [-119.5, 37.2],
  zoom: 5.5,
  hash: true,
});
map.addControl(new maplibregl.NavigationControl(), "top-right");

map.on("load", () => {
  const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;

  map.addSource(SOURCE_ID, {
    type: "vector",
    url: `pmtiles://${TILES_URL}`,
    attribution:
      '<a href="https://www.nass.usda.gov/Research_and_Science/Crop-Sequence-Boundaries/">USDA NASS Crop Sequence Boundaries</a>',
  });

  map.addLayer(
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
    firstSymbol,
  );

  map.addLayer(
    {
      id: `${SOURCE_ID}-outline`,
      type: "line",
      source: SOURCE_ID,
      "source-layer": "crops",
      minzoom: 11,
      paint: { "line-color": "#333", "line-width": 0.3, "line-opacity": 0.5 },
    },
    firstSymbol,
  );

  map.addLayer(
    {
      id: `${SOURCE_ID}-highlight`,
      type: "line",
      source: SOURCE_ID,
      "source-layer": "crops",
      filter: ["==", ["get", "CSBID"], ""] as FilterSpecification,
      paint: { "line-color": "#000", "line-width": 2 },
    },
    firstSymbol,
  );
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
    map.setFilter(`${SOURCE_ID}-highlight`, ["==", ["get", "CSBID"], ""]);
    popup
      .setLngLat(e.lngLat)
      .setHTML(`${title}<span class="muted">Zoom in for field details</span>`)
      .addTo(map);
    return;
  }

  map.setFilter(`${SOURCE_ID}-highlight`, ["==", ["get", "CSBID"], p.CSBID]);
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

popup.on("close", () => {
  if (map.getLayer(`${SOURCE_ID}-highlight`)) {
    map.setFilter(`${SOURCE_ID}-highlight`, ["==", ["get", "CSBID"], ""]);
  }
});

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
