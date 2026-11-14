import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Polygon, Polyline, CircleMarker, useMap, useMapEvents } from 'react-leaflet';
import { Search, LocateFixed, Plus, Minus, Layers, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { INITIAL_CENTER, type Coordinate } from '@/lib/field';

interface Props { points: Coordinate[]; onPointsChange: (points: Coordinate[]) => void; drawing: boolean; center: Coordinate; onCenterChange: (center: Coordinate) => void }
function MapBehavior({ points, onPointsChange, drawing, center }: Props) {
  const map = useMap();
  useEffect(() => { map.flyTo(center, 14, { duration: 1 }); }, [map, center]);
  useEffect(() => { if (!drawing && points.length >= 3) map.fitBounds(points, { padding: [60, 60], maxZoom: 16 }); }, [map, points, drawing]);
  useMapEvents({ click: e => { if (drawing) onPointsChange([...points, [e.latlng.lat, e.latlng.lng]]); } });
  return <div className="map-zoom"><Button variant="map" size="icon" aria-label="Aproximar mapa" title="Aproximar" onClick={() => map.zoomIn()}><Plus /></Button><Button variant="map" size="icon" aria-label="Afastar mapa" title="Afastar" onClick={() => map.zoomOut()}><Minus /></Button><Button variant="map" size="icon" aria-label="Centralizar em Campo Mourão" title="Campo Mourão" onClick={() => map.flyTo(INITIAL_CENTER, 14)}><LocateFixed /></Button></div>;
}
export default function FieldMap(props: Props) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true); setError('');
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=br&limit=1&q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error();
      const results = await res.json() as { lat: string; lon: string }[];
      const result = results[0];
      if (!result) { setError('Local não encontrado. Tente cidade e estado.'); return; }
      props.onCenterChange([Number(result.lat), Number(result.lon)]);
    } catch { setError('Busca indisponível. Você pode navegar pelo mapa.'); }
    finally { setSearching(false); }
  }
  return <div className={`field-map ${props.drawing ? 'is-drawing' : ''}`}>
    <MapContainer center={INITIAL_CENTER} zoom={14} zoomControl={false} className="leaflet-surface" doubleClickZoom={!props.drawing}>
      <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Tiles © Esri, Maxar, Earthstar Geographics" />
      <TileLayer url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" />
      {props.points.length >= 3 ? <Polygon positions={props.points} pathOptions={{ className: 'field-boundary' }} /> : <Polyline positions={props.points} pathOptions={{ className: 'field-boundary' }} />}
      {props.points.map((point, index) => <CircleMarker key={`${point.join(',')}-${index}`} center={point} radius={5} pathOptions={{ className: 'field-vertex' }} />)}
      <MapBehavior {...props} />
    </MapContainer>
    <form className="map-search" onSubmit={search}><Search size={18} /><input aria-label="Buscar cidade ou fazenda" placeholder="Buscar cidade ou fazenda" value={query} onChange={e => setQuery(e.target.value)} /><Button variant="ghost" size="icon" type="submit" aria-label="Buscar local" disabled={searching}>{searching ? <LoaderCircle className="animate-spin" /> : <Search />}</Button></form>
    {error && <div className="map-message" role="status">{error}</div>}
    {props.drawing && <div className="map-draw-message">Marque os vértices do talhão no mapa</div>}
    <div className="map-layer"><Layers size={15} /> Satélite Esri</div>
    <div className="map-location"><span className="live-dot" /> Campo Mourão, PR <span>24°02′ S · 52°23′ O</span></div>
  </div>;
}