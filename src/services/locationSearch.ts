import type { Coordinate } from "@/lib/field";

type GeocodingProvider = (query: string) => Promise<Coordinate | null>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toCoordinate(latitude: unknown, longitude: unknown): Coordinate | null {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }
  return [lat, lng];
}

async function searchNominatim(query: string): Promise<Coordinate | null> {
  const params = new URLSearchParams({
    format: "jsonv2",
    countrycodes: "br",
    limit: "1",
    "accept-language": "pt-BR",
    q: query,
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Nominatim indisponível");

  const results: unknown = await response.json();
  if (!Array.isArray(results)) throw new Error("Resposta inválida do Nominatim");
  const result: unknown = results[0];
  if (!isRecord(result)) return null;
  return toCoordinate(result["lat"], result["lon"]);
}

async function searchPhoton(query: string): Promise<Coordinate | null> {
  const params = new URLSearchParams({ q: query, lang: "pt", limit: "1" });
  const response = await fetch(`https://photon.komoot.io/api/?${params}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Photon indisponível");

  const result: unknown = await response.json();
  if (!isRecord(result) || !Array.isArray(result["features"])) {
    throw new Error("Resposta inválida do Photon");
  }
  const feature: unknown = result["features"][0];
  if (!isRecord(feature) || !isRecord(feature["geometry"])) return null;
  const coordinates: unknown = feature["geometry"]["coordinates"];
  if (!Array.isArray(coordinates)) return null;
  return toCoordinate(coordinates[1], coordinates[0]);
}

export async function searchLocation(query: string): Promise<Coordinate | null> {
  const providers: GeocodingProvider[] = [searchNominatim, searchPhoton];
  let unavailableProviders = 0;

  for (const searchWithProvider of providers) {
    try {
      const location = await searchWithProvider(query);
      if (location) return location;
    } catch {
      unavailableProviders += 1;
    }
  }

  if (unavailableProviders === providers.length) {
    throw new Error("Os serviços de busca de localização estão indisponíveis");
  }
  return null;
}
