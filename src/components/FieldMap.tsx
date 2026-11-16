import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Polygon,
  Polyline,
  Circle,
  CircleMarker,
  Marker,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { divIcon, type Polygon as LeafletPolygon } from "leaflet";
import {
  Search,
  LocateFixed,
  Plus,
  Minus,
  Layers,
  LoaderCircle,
  Thermometer,
  CloudRain,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { INITIAL_CENTER, formatNumber, type Coordinate } from "@/lib/field";
import { getFieldLayerView, type FieldMapLayer } from "@/lib/field-layers";
import type { FieldAnalysis, FieldRequest } from "@/services/agroShieldApi";
import { getCampoMouraoWeather, type CurrentWeather } from "@/services/fieldWeather";
import { searchLocation } from "@/services/locationSearch";

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
  currentWeather: CurrentWeather | null;
  onWeatherChange: (weather: CurrentWeather | null) => void;
}

const gradients: [string, string, string][] = [
  ["agroshield-ndvi", "#047857", "#34D399"],
  ["agroshield-rain-heat-high", "#1E3A8A", "#EF4444"],
  ["agroshield-rain-heat-mid", "#0284C7", "#38BDF8"],
  ["agroshield-rain-heat-low", "#0EA5E9", "#BAE6FD"],
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
    (window as unknown as { __agroMap?: unknown }).__agroMap = map;
  }, [map]);
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
  currentWeather,
}: {
  field: FieldRequest;
  analysis: FieldAnalysis;
  activeLayer: FieldMapLayer;
  currentWeather: CurrentWeather | null;
}) {
  const layerView = getFieldLayerView(analysis, activeLayer, currentWeather);
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
  const { onWeatherChange } = props;
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [temperature, setTemperature] = useState<number | null>(null);
  const [precipitationToday, setPrecipitationToday] = useState<number | null>(null);
  const [temperatureTime, setTemperatureTime] = useState("");
  const [temperatureLoading, setTemperatureLoading] = useState(true);
  const [temperatureError, setTemperatureError] = useState(false);
  const layerView = props.analysis
    ? getFieldLayerView(props.analysis, props.activeLayer, props.currentWeather)
    : null;
  const polygonRef = useRef<LeafletPolygon | null>(null);
  const weatherLat = Number(
    (props.field?.centroid.lat ?? props.center[0]).toFixed(2),
  );
  const weatherLng = Number(
    (props.field?.centroid.lng ?? props.center[1]).toFixed(2),
  );

  useEffect(() => {
    let active = true;
    async function updateTemperature() {
      try {
        const current = await getCampoMouraoWeather(weatherLat, weatherLng);
        if (!active) return;
        setTemperature(current.temperatureC);
        setPrecipitationToday(current.precipitationTodayMm);
        setTemperatureTime(current.time);
        setTemperatureError(false);
        onWeatherChange(current);
      } catch {
        if (active) {
          setTemperatureError(true);
          onWeatherChange(null);
        }
      } finally {
        if (active) setTemperatureLoading(false);
      }
    }

    void updateTemperature();
    const interval = window.setInterval(() => void updateTemperature(), 15 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [onWeatherChange, weatherLat, weatherLng]);

  useEffect(() => {
    polygonRef.current
      ?.getElement()
      ?.classList.toggle("field-boundary-critical", Boolean(layerView?.critical));
  }, [layerView?.critical, props.points]);

  const [radarOn, setRadarOn] = useState(false);
  const [radarUrl, setRadarUrl] = useState<string | null>(null);

  async function toggleRadar() {
    if (radarOn) {
      setRadarOn(false);
      return;
    }
    setRadarOn(true);
    if (radarUrl) return;
    try {
      const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
      if (!res.ok) return;
      const data = (await res.json()) as {
        host?: string;
        radar?: { past?: Array<{ path?: string }> };
      };
      const past = data?.radar?.past || [];
      const latest = past[past.length - 1]?.path;
      if (data?.host && latest) {
        setRadarUrl(`${data.host}${latest}/256/{z}/{x}/{y}/2/1_1.png`);
      }
    } catch {
      // Radar opcional: ignora falha se estiver offline
    }
  }
  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError("");
    try {
      const location = await searchLocation(query.trim());
      if (!location) {
        setError("Local não encontrado. Tente cidade e estado.");
        return;
      }
      props.onCenterChange(location);
    } catch {
      setError("Serviços de localização indisponíveis. Você pode navegar pelo mapa.");
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
        {(radarOn || props.activeLayer === "rain-heatmap") && radarUrl && (
          <TileLayer url={radarUrl} opacity={props.activeLayer === "rain-heatmap" ? 0.65 : 0.55} />
        )}
        {props.activeLayer === "rain-heatmap" &&
          !props.currentWeather &&
          props.analysis?.rainHeatmapGrid?.map((cell) => {
            const color =
              cell.rain24hMm >= 45
                ? "#EF4444"
                : cell.rain24hMm >= 20
                  ? "#1D4ED8"
                  : cell.rain24hMm >= 5
                    ? "#0284C7"
                    : "#38BDF8";
            return (
              <Circle
                key={cell.label}
                center={[cell.lat, cell.lng]}
                radius={6500}
                pathOptions={{
                  color,
                  weight: 1,
                  opacity: 0.45,
                  fillColor: color,
                  fillOpacity: 0.24,
                }}
              >
                <Tooltip direction="top" opacity={0.95}>
                  <span>
                    {cell.label}: {cell.rain24hMm} mm
                    {typeof cell.pressureHpa === "number" ? ` · ${cell.pressureHpa} hPa` : ""}
                  </span>
                </Tooltip>
              </Circle>
            );
          })}
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
            currentWeather={props.currentWeather}
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
        <button
          type="button"
          onClick={toggleRadar}
          style={{
            marginLeft: 8,
            padding: "2px 8px",
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.28)",
            background: radarOn ? "#15803d" : "rgba(15,23,42,0.45)",
            color: "#fff",
            fontSize: "0.75rem",
            cursor: "pointer",
          }}
        >
          {radarOn ? "Radar ativo" : "Radar de chuva"}
        </button>
      </div>
      <div className="map-location">
        <span className="live-dot" />
        <span className="map-location-name">
          {props.analysis?.regionName
            ? props.analysis.regionName.replace(/\s*\(Brasil\)\s*$/i, "")
            : "Campo Mourão, PR"}
        </span>
        <span className="map-coordinates">
          {Math.abs(weatherLat).toFixed(2)}° {weatherLat <= 0 ? "S" : "N"} ·{" "}
          {Math.abs(weatherLng).toFixed(2)}° {weatherLng <= 0 ? "O" : "L"}
        </span>
        <span
          className="map-temperature"
          title={`Open-Meteo${temperatureTime ? ` · Atualizado às ${temperatureTime.slice(11, 16)}` : ""}${temperatureError ? " · Falha ao atualizar" : ""}`}
          aria-label={
            temperature === null
              ? "Temperatura atual indisponível"
              : `Temperatura atual em Campo Mourão: ${temperature.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} graus Celsius`
          }
        >
          <Thermometer size={13} aria-hidden="true" />
          {temperature !== null
            ? `${temperature.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}°C ${temperatureError ? "última leitura" : "agora"}`
            : temperatureLoading
              ? "Carregando temperatura"
              : "Temperatura indisponível"}
        </span>
        <span
          className="map-precipitation"
          title={`Acumulado estimado pela Open-Meteo até ${temperatureTime.slice(11, 16) || "agora"}; não é leitura de pluviômetro${temperatureError ? " · Falha ao atualizar" : ""}`}
          aria-label={
            precipitationToday === null
              ? "Precipitação de hoje indisponível"
              : `Precipitação estimada acumulada hoje: ${precipitationToday.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} milímetros`
          }
        >
          <CloudRain size={13} aria-hidden="true" />
          {precipitationToday !== null
            ? `${precipitationToday.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mm hoje est.`
            : temperatureLoading
              ? "Carregando chuva"
              : "Chuva indisponível"}
        </span>
      </div>
    </div>
  );
}
