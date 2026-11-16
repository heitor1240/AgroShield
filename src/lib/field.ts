import turfArea from '@turf/area';
import turfCentroid from '@turf/centroid';
import { polygon as turfPolygon } from '@turf/helpers';

export type Coordinate = [number, number]; // latitude, longitude
export type Crop = 'Soja' | 'Milho' | 'Trigo' | 'Outro';
export const INITIAL_CENTER: Coordinate = [-24.045, -52.383];
export const EXAMPLE_FIELD: Coordinate[] = [
  [-24.0118, -52.4415],
  [-24.0125, -52.4338],
  [-24.0182, -52.4348],
  [-24.0175, -52.4425],
];
export function calculateField(points: Coordinate[]) {
  if (points.length < 3) return null;
  const ring = points.map(([lat, lng]) => [lng, lat]);
  const first = ring[0];
  if (!first) return null;
  const shape = turfPolygon([[...ring, first]]);
  const [lng, lat] = turfCentroid(shape).geometry.coordinates;
  if (lat === undefined || lng === undefined) return null;
  return { areaHectares: turfArea(shape) / 10000, centroid: { lat, lng } };
}
export const formatNumber = (value: number, digits = 1) => value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });