import type { SavedFishingTrip, TripDestination, TripFishRecord, RecordingMode, TripOutcome, UpdateTripInput } from "@/lib/types";
import { localDateTime } from "./drafts";

export interface FishDraft {
  id?: string;
  species: string;
  count: string;
  weightKg: string;
  lengthCm: string;
  weightBasis: NonNullable<TripFishRecord["weightBasis"]> | "";
  lengthBasis: NonNullable<TripFishRecord["lengthBasis"]> | "";
  bait: string;
  notes: string;
  released: boolean;
}
export const EMPTY_FISH: FishDraft = { species: "", count: "1", weightKg: "", lengthCm: "", weightBasis: "", lengthBasis: "", bait: "", notes: "", released: false };
export interface TripDraft {
  destination?: TripDestination;
  recordingMode: RecordingMode;
  completing: boolean;
  tripDate: string;
  endedAt: string;
  outcome: TripOutcome | "";
  fishingMinutes: string;
  anglerCount: string;
  conditionsRecordedAt: string;
  notes: string;
  fishRecords: TripFishRecord[];
  fish: FishDraft;
}

export function initialDraft(trip?: SavedFishingTrip, destination?: TripDestination): TripDraft {
  return {
    destination: trip ? { name: trip.locationName, lat: trip.lat, lon: trip.lon, technique: trip.technique } : destination,
    recordingMode: trip?.recordingMode ?? "live", completing: false,
    tripDate: localDateTime(trip?.tripDate ?? new Date().toISOString(), true), endedAt: trip?.endedAt ? localDateTime(trip.endedAt, true) : "",
    outcome: trip ? trip.outcome : "zero", fishingMinutes: trip?.fishingMinutes?.toString() ?? "", anglerCount: trip?.anglerCount?.toString() ?? "",
    conditionsRecordedAt: trip?.conditionsRecordedAt ? localDateTime(trip.conditionsRecordedAt, true) : "", notes: trip?.notes ?? "", fishRecords: trip?.fishRecords ?? [], fish: { ...EMPTY_FISH },
  };
}

export function resolveSelectedTrip(id: string | undefined, trips: SavedFishingTrip[], activeTrip: SavedFishingTrip | null): SavedFishingTrip | undefined {
  return activeTrip && activeTrip.id === id ? activeTrip : trips.find((trip) => trip.id === id);
}

export function tripUpdateFromDraft(value: TripDraft, trip?: SavedFishingTrip, records = value.fishRecords, selectedOutcome = value.outcome): { fields: UpdateTripInput; deferredEffort: boolean } {
  const completing = trip?.status === "active" && value.completing;
  const finished = trip?.status === "completed" || (!trip && value.recordingMode === "historical") || completing;
  const requiresEnd = completing || (!trip && value.recordingMode === "historical");
  const start = validPastDate(trip && value.tripDate === localDateTime(trip.tripDate, true) ? trip.tripDate : value.tripDate, "έναρξη");
  const end = finished && value.endedAt ? validPastDate(trip?.endedAt && value.endedAt === localDateTime(trip.endedAt, true) ? trip.endedAt : value.endedAt, "λήξη") : null;
  if (end && end < start) throw new Error("Η λήξη δεν μπορεί να προηγείται της έναρξης.");
  if (requiresEnd && !end) throw new Error("Συμπλήρωσε την πραγματική λήξη για την ολοκλήρωση ή τη νέα ιστορική εξόρμηση.");
  if (finished && !selectedOutcome) throw new Error("Επίλεξε ρητά το αποτέλεσμα.");
  const outcome = selectedOutcome || (records.length ? "recorded" : "not-recorded");
  if (records.length > 0 && outcome !== "recorded") throw new Error("Υπάρχουν ψάρια. Επίλεξε καταγεγραμμένη αλίευση ή αφαίρεσέ τα ρητά.");
  if (records.length === 0 && outcome === "recorded") throw new Error("Πρόσθεσε ψάρι ή επίλεξε μηδενική / μη καταγεγραμμένη αλίευση.");
  const minutes = positiveNumber(value.fishingMinutes, "λεπτά ψαρέματος", true);
  const anglers = positiveNumber(value.anglerCount, "αριθμό ψαράδων", true);
  if (minutes !== null && minutes > 4294967295) throw new Error("Τα λεπτά ψαρέματος υπερβαίνουν το επιτρεπτό όριο.");
  if (anglers !== null && anglers > 100) throw new Error("Ο αριθμός ψαράδων πρέπει να είναι από 1 έως 100.");
  if (end && minutes !== null && minutes > (end.getTime() - start.getTime()) / 60_000 + 1) throw new Error("Τα λεπτά ψαρέματος δεν μπορούν να υπερβαίνουν την πραγματική διάρκεια (ανοχή ενός λεπτού).");
  const deferredEffort = !end && (minutes !== null || anglers !== null);
  return { deferredEffort, fields: {
    tripDate: start.toISOString(), endedAt: end?.toISOString() ?? null, outcome,
    fishingMinutes: end ? minutes : null, anglerCount: end ? anglers : null,
    conditionsRecordedAt: value.conditionsRecordedAt ? validPastDate(trip?.conditionsRecordedAt && value.conditionsRecordedAt === localDateTime(trip.conditionsRecordedAt, true) ? trip.conditionsRecordedAt : value.conditionsRecordedAt, "ώρα συνθηκών").toISOString() : null,
    notes: value.notes, fishRecords: records.map((record) => ({ ...record, images: trip?.fishRecords.find((fish) => fish.id === record.id)?.images ?? record.images })),
    ...(trip?.status === "active" ? { visibility: "private" as const } : {}),
    ...(completing ? { status: "completed" as const } : {}),
  } };
}

export function draftAfterSave(saved: SavedFishingTrip, previous: TripDraft, deferredEffort: boolean): TripDraft {
  return { ...initialDraft(saved, previous.destination), ...(deferredEffort ? { fishingMinutes: previous.fishingMinutes, anglerCount: previous.anglerCount } : {}) };
}

export function positiveNumber(value: string, label: string, integer = false): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || (integer && !Number.isInteger(number))) throw new Error(`Έλεγξε το πεδίο ${label}: απαιτείται θετική τιμή. Άφησέ το κενό αν είναι άγνωστο.`);
  return number;
}
function validPastDate(value: string, label: string): Date {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime()) || date.getTime() > Date.now()) throw new Error(`Η ${label} πρέπει να είναι έγκυρη και όχι μελλοντική.`);
  return date;
}
