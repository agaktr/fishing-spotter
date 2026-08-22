import type { Coordinates } from "./types";

const EARTH_RADIUS_KM = 6371.0088;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function toDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

export function distanceKm(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function destinationPoint(
  start: Coordinates,
  distanceMeters: number,
  bearingDegrees: number,
): Coordinates {
  const distance = distanceMeters / 1000 / EARTH_RADIUS_KM;
  const bearing = toRadians(bearingDegrees);
  const lat1 = toRadians(start.lat);
  const lon1 = toRadians(start.lon);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distance) +
      Math.cos(lat1) * Math.sin(distance) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(distance) * Math.cos(lat1),
      Math.cos(distance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    lat: toDegrees(lat2),
    lon: ((toDegrees(lon2) + 540) % 360) - 180,
  };
}

export function scoreRange(
  value: number | undefined,
  idealMin: number,
  idealMax: number,
  hardMin: number,
  hardMax: number,
  unknownScore = 55,
): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return unknownScore;
  }

  if (value >= idealMin && value <= idealMax) {
    return 95;
  }

  if (value < hardMin || value > hardMax) {
    return 18;
  }

  if (value < idealMin) {
    const span = idealMin - hardMin;
    return clamp(35 + ((value - hardMin) / span) * 50, 18, 85);
  }

  const span = hardMax - idealMax;
  return clamp(85 - ((value - idealMax) / span) * 55, 18, 85);
}

export function formatDistanceKm(value: number): string {
  if (value < 1) {
    return `${Math.round(value * 1000)}m`;
  }

  return `${round(value, 1)}km`;
}

export function median(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function average(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
