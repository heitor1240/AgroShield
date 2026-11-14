import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Polygon,
  Polyline,
  CircleMarker,
  Marker,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { divIcon, type Polygon as LeafletPolygon } from "leaflet";
import { Search, LocateFixed, Plus, Minus, Layers, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { INITIAL_CENTER, formatNumber, type Coordinate } from "@/lib/field";
import { getFieldLayerView, type FieldMapLayer } from "@/lib/field-layers";
import type { FieldAnalysis, FieldRequest } from "@/services/agroShieldApi";

interface Props {
  points: Coordinate[];
  onPointsChange: (points: Coordinate[]) => void;
  drawing: boolean;
  center: Coordinate;
  onCenterChange: (center: Coordinate) => void;
  layoutVersion: number;
  focusBounds: boolean;
  field: FieldRequest | null;
  analysis: FieldAnalysis | null;
  activeLayer: FieldMapLayer;
  showSearch: boolean;
}

const gradients: [string, string, string][] = [
  ["agroshield-ndvi-healthy", "#15803D", "#86EFAC"],
  ["agroshield-ndvi-stress", "#B45309", "#FDE68A"],
  ["agroshield-soil-moisture", "#1D4ED8", "#38BDF8"],
  ["agroshield-heat", "#EA580C", "#FCD34D"],
  ["agroshield-cover-low", "#B45309", "#FBBF24"],
  ["agroshield-cover-high", "#4D7C0F", "#BEF264"],
];

function MapBehavior({
  points,
  onPointsChange,
  drawing,
  center,
  layoutVersion,
  focusBounds,
}: Props) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, 14, { animate: false });
  }, [map, center]);
  useEffect(() => {
    if (drawing || points.length < 3) return;
    if (focusBounds) map.flyToBounds(points, { padding: [60, 60], maxZoom: 16, duration: 1.25 });
    else map.fitBounds(points, { padding: [60, 60], maxZoom: 16, animate: false });
  }, [map, points, drawing, focusBounds]);
  useEffect(() => {
    const container = map.getContainer();
    const resizeObserver = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [map]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    return () => window.cancelAnimationFrame(frame);
  }, [map, layoutVersion]);
  useEffect(() => {
    const svg = map.getPanes().overlayPane.querySelector("svg");
    if (!svg) return;

    let defs = svg.querySelector("defs[data-agroshield-gradients]");
    if (!defs) {
      defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      defs.setAttribute("data-agroshield-gradients", "true");
      svg.insertBefore(defs, svg.firstChild);
    }

    for (const [id, start, end] of gradients) {
      if (defs.querySelector(`#${id}`)) continue;
      const gradient = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
      gradient.setAttribute("id", id);
      gradient.setAttribute("x1", "0%");
      gradient.setAttribute("y1", "0%");
      gradient.setAttribute("x2", "100%");
      gradient.setAttribute("y2", "100%");
      const stops: [string, string][] = [
        ["0%", start],
        ["100%", end],
      ];
      for (const [offset, color] of stops) {
        const stop = document.createElementNS("http://www.w3.org/2000/svg", "stop");
        stop.setAttribute("offset", offset);
        stop.setAttribute("stop-color", color);
        gradient.appendChild(stop);
      }
      defs.appendChild(gradient);
    }
  }, [map, points.length]);
  useMapEvents({
    click: (e) => {
      if (drawing) onPointsChange([...points, [e.latlng.lat, e.latlng.lng]]);
    },
  });
  return (
    <div className="map-zoom">
      <Button
        variant="map"
        size="icon"
        aria-label="Aproximar mapa"
        title="Aproximar"
        onClick={() => map.zoomIn()}
      >
        <Plus />
      </Button>
      <Button
        variant="map"
        size="icon"
        aria-label="Afastar mapa"
        title="Afastar"
        onClick={() => map.zoomOut()}
      >
        <Minus />
      </Button>
      <Button
        variant="map"
        size="icon"
        aria-label="Centralizar em Campo Mourão"
        title="Campo Mourão"
        onClick={() => map.setView(INITIAL_CENTER, 14, { animate: false })}
      >
        <LocateFixed />
      </Button>
    </div>
  );
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

function FieldCentroidMarker({
  field,
  analysis,
  activeLayer,
}: {
  field: FieldRequest;
  analysis: FieldAnalysis;
  activeLayer: FieldMapLayer;
}) {
  const layerView = getFieldLayerView(analysis, activeLayer);
  const icon = useMemo(
    () =>
      divIcon({
        className: "field-center-icon",
        html: `<div class="field-center-card"><strong>Talhão selecionado</strong><span>${formatNumber(field.areaHectares)} ha · ${escapeHtml(field.crop)}</span><b>${escapeHtml(layerView.markerValue)}</b></div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }),
    [field.areaHectares, field.crop, layerView.markerValue],
  );

  return (
    <Marker
      position={[field.centroid.lat, field.centroid.lng]}
      icon={icon}
      interactive={false}
      keyboard={false}
    />
  );
}

export default function FieldMap(props: Props) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const layerView = props.analysis ? getFieldLayerView(props.analysis, props.activeLayer) : null;
  const polygonRef = useRef<LeafletPolygon | null>(null);

  useEffect(() => {
    polygonRef.current
      ?.getElement()
      ?.classList.toggle("field-boundary-critical", Boolean(layerView?.critical));
  }, [layerView?.critical, props.points]);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError("");
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&countrycodes=br&limit=1&q=${encodeURIComponent(query)}`,
      );
      if (!res.ok) throw new Error();
      const results = (await res.json()) as { lat: string; lon: string }[];
      const result = results[0];
      if (!result) {
        setError("Local não encontrado. Tente cidade e estado.");
        return;
      }
      props.onCenterChange([Number(result.lat), Number(result.lon)]);
    } catch {
      setError("Busca indisponível. Você pode navegar pelo mapa.");
    } finally {
      setSearching(false);
    }
  }

  const boundaryOptions = layerView
    ? {
        className: "field-boundary",
        color: layerView.borderColor,
        fillColor: layerView.gradientId ? `url(#${layerView.gradientId})` : layerView.color,
        fillOpacity: 0.58,
        opacity: 1,
        weight: 3,
      }
    : { className: "field-boundary", color: "#A3E635", fillColor: "#84CC16", fillOpacity: 0.2 };

  return (
    <div className={`field-map ${props.drawing ? "is-drawing" : ""}`}>
      <MapContainer
        center={INITIAL_CENTER}
        zoom={14}
        zoomControl={false}
        className="leaflet-surface"
        doubleClickZoom={!props.drawing}
      >
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          attribution="Tiles © Esri, Maxar, Earthstar Geographics"
        />
        <TileLayer url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" />
        {props.points.length >= 3 ? (
          <Polygon ref={polygonRef} positions={props.points} pathOptions={boundaryOptions} />
        ) : (
          <Polyline positions={props.points} pathOptions={{ className: "field-boundary" }} />
        )}
        {props.points.map((point, index) => (
          <CircleMarker
            key={`${point.join(",")}-${index}`}
            center={point}
            radius={5}
            pathOptions={{ className: "field-vertex" }}
          />
        ))}
        {props.field && props.analysis && props.points.length >= 3 && (
          <FieldCentroidMarker
            field={props.field}
            analysis={props.analysis}
            activeLayer={props.activeLayer}
          />
        )}
        <MapBehavior {...props} />
      </MapContainer>
      {props.showSearch && (
        <form className="map-search" onSubmit={search}>
          <Search size={18} />
          <input
            aria-label="Buscar cidade ou fazenda"
            placeholder="Buscar cidade ou fazenda"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button
            variant="ghost"
            size="icon"
            type="submit"
            aria-label="Buscar local"
            disabled={searching}
          >
            {searching ? <LoaderCircle className="animate-spin" /> : <Search />}
          </Button>
        </form>
      )}
      {error && (
        <div className="map-message" role="status">
          {error}
        </div>
      )}
      {props.drawing && (
        <div className="map-draw-message">Marque os vértices do talhão no mapa</div>
      )}
      <div className="map-layer">
        <Layers size={15} /> Satélite Esri
      </div>
      <div className="map-location">
        <span className="live-dot" /> Campo Mourão, PR <span>24°02′ S · 52°23′ O</span>
      </div>
    </div>
  );
}
