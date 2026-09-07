import type { SavedFishingTrip } from "@/lib/types";

export const EMPTY_TRIP_FILTERS = { species: "", technique: "", from: "", to: "", status: "", outcome: "" };

export function tripSpecies(trip: SavedFishingTrip): string[] {
  return [...new Set(trip.fishRecords.map((fish) => fish.species.trim()).filter(Boolean))];
}

export function matchesTripFilters(trip: SavedFishingTrip, filters: typeof EMPTY_TRIP_FILTERS): boolean {
  const date = new Date(trip.tripDate);
  const day = Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` : "";
  return (!filters.species || tripSpecies(trip).includes(filters.species))
    && (!filters.technique || trip.technique === filters.technique)
    && (!filters.status || trip.status === filters.status)
    && (!filters.outcome || trip.outcome === filters.outcome)
    && (!filters.from || Boolean(day && day >= filters.from))
    && (!filters.to || Boolean(day && day <= filters.to));
}

export function tripDurationMinutes(trip: SavedFishingTrip): number | undefined {
  if (!trip.endedAt) return undefined;
  const elapsed = new Date(trip.endedAt).getTime() - new Date(trip.tripDate).getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed / 60000) : undefined;
}
