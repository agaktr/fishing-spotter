import type { SavedScan, SpotsApiRequest } from "@/lib/types";

// Persisted query-only scans predate the structured search contract. Never re-parse their text.
export function scanRecheckRequest(scan: SavedScan): SpotsApiRequest {
  const request = scan.request;
  const structured = Boolean(request.technique && request.location);
  return {
    technique: request.technique ?? scan.technique,
    location: request.location ?? scan.locationLabel,
    locationLabel: request.locationLabel ?? scan.locationLabel,
    mode: request.mode ?? scan.mode ?? scan.response.mode ?? "nearby",
    coordinates: request.coordinates ?? (!structured ? { lat: scan.lat, lon: scan.lon } : undefined),
    targetSpecies: structured ? request.targetSpecies : undefined,
    radiusKm: request.radiusKm ?? scan.radiusKm,
    resultLimit: request.resultLimit ?? scan.resultLimit,
    saveHistory: false,
  };
}
