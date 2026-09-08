import type { SavedFishingTrip, TripDestination, TripFishRecord, RecordingMode, TripOutcome, UpdateTripInput, TechniqueId } from "@/lib/types";
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
  fishRecordsBase?: TripFishRecord[];
  fishRevisionBase?: string | null;
  scalarBase?: Pick<TripDraft, typeof SCALAR_FIELDS[number]>;
  fish: FishDraft;
  fullEntry?: boolean;
  fishSaveBase?: TripFishRecord | null;
  pendingAction?: "save" | "complete";
}

const SCALAR_FIELDS = ["tripDate", "endedAt", "outcome", "fishingMinutes", "anglerCount", "conditionsRecordedAt", "notes"] as const;

const TECHNIQUES = ["surfcasting", "spinning", "shore-jigging", "eging", "bottom-fishing", "rock-fishing", "boat-fishing"];
export function preferredTechnique(fallback: TechniqueId): TechniqueId {
  try { const saved = localStorage.getItem("fishing-last-technique"); return saved && TECHNIQUES.includes(saved) ? saved as TechniqueId : fallback; } catch { return fallback; }
}
export function rememberTechnique(technique: TechniqueId) {
  try { localStorage.setItem("fishing-last-technique", technique); } catch { /* A preference must not block fishing. */ }
}

function sameFish(a?: TripFishRecord | null, b?: TripFishRecord | null): boolean {
  return a === b || Boolean(a && b && ["id", "species", "count", "weightKg", "lengthCm", "weightBasis", "lengthBasis", "bait", "notes", "released"].every((key) => (a[key as keyof TripFishRecord] ?? "") === (b[key as keyof TripFishRecord] ?? "")));
}

export function fishOnlyUpdate(latest: SavedFishingTrip, record: TripFishRecord, baseline?: TripFishRecord | null): UpdateTripInput {
  const current = latest.fishRecords.find((fish) => fish.id === record.id);
  // The same stable ID also makes a retry safe after a lost successful response.
  if (!sameFish(current, baseline) && !sameFish(current, record) && (current || baseline)) throw new Error("Το ψάρι άλλαξε σε άλλη συσκευή. Τα στοιχεία σου διατηρήθηκαν. Άνοιξε την αποθηκευμένη έκδοση πριν συνεχίσεις.");
  const savedRecord = { ...record, images: current?.images ?? [] };
  return { outcome: "recorded", fishRecords: current ? latest.fishRecords.map((fish) => fish.id === record.id ? savedRecord : fish) : [...latest.fishRecords, savedRecord], ...(latest.fishRevision ? { expectedFishRevision: latest.fishRevision } : {}) };
}

export function draftAfterFishSave(previous: TripDraft, baseline: SavedFishingTrip, saved: SavedFishingTrip, fishId: string): TripDraft {
  const before = previous.fishRecordsBase ?? baseline.fishRecords;
  const conflict = before.some((old) => {
    const local = previous.fishRecords.find((fish) => fish.id === old.id);
    const remote = saved.fishRecords.find((fish) => fish.id === old.id);
    return old.id !== fishId && !sameFish(local, old) && !sameFish(remote, old) && !sameFish(local, remote);
  });
  const records = saved.fishRecords.flatMap((fresh) => {
    if (fresh.id === fishId) return [fresh];
    const old = before.find((item) => item.id === fresh.id);
    const local = previous.fishRecords.find((item) => item.id === fresh.id);
    if (!local) return old ? [] : [fresh];
    return [sameFish(local, old) ? fresh : { ...local, images: fresh.images }];
  });
  for (const local of previous.fishRecords) {
    if (local.id !== fishId && !saved.fishRecords.some((fish) => fish.id === local.id) && !sameFish(local, before.find((fish) => fish.id === local.id))) records.push(local);
  }
  const original = previous.scalarBase ?? initialDraft(baseline).scalarBase!;
  const fresh = initialDraft(saved);
  const next = { ...previous };
  for (const key of SCALAR_FIELDS) if (previous[key] === original[key]) Object.assign(next, { [key]: fresh[key] });
  // A successful separate catch must not authorize an unresolved, conflicting edit/deletion.
  return { ...next, scalarBase: fresh.scalarBase, fishRecords: records, fishRecordsBase: conflict ? before : saved.fishRecords, fishRevisionBase: conflict ? previous.fishRevisionBase ?? null : saved.fishRevision ?? null, outcome: "recorded", fish: { ...EMPTY_FISH }, fishSaveBase: undefined };
}

export function initialDraft(trip?: SavedFishingTrip, destination?: TripDestination): TripDraft {
  const technique = destination ? preferredTechnique(destination.technique) : undefined;
  const scalars = {
    tripDate: localDateTime(trip?.tripDate ?? new Date().toISOString(), true), endedAt: trip?.endedAt ? localDateTime(trip.endedAt, true) : "",
    outcome: trip ? trip.outcome : "zero" as const, fishingMinutes: trip?.fishingMinutes?.toString() ?? "", anglerCount: trip?.anglerCount?.toString() ?? "",
    conditionsRecordedAt: trip?.conditionsRecordedAt ? localDateTime(trip.conditionsRecordedAt, true) : "", notes: trip?.notes ?? "",
  };
  return {
    destination: trip ? { name: trip.locationName, lat: trip.lat, lon: trip.lon, technique: trip.technique } : destination && technique !== destination.technique ? { ...destination, technique: technique!, spot: undefined, conditionsAt: undefined } : destination,
    recordingMode: trip?.recordingMode ?? "live", completing: false, fullEntry: false,
    ...scalars, scalarBase: scalars, fishRecords: trip?.fishRecords ?? [], fishRecordsBase: trip?.fishRecords ?? [], fishRevisionBase: trip?.fishRevision ?? null, fish: { ...EMPTY_FISH },
  };
}

export function resolveSelectedTrip(id: string | undefined, trips: SavedFishingTrip[], activeTrip: SavedFishingTrip | null): SavedFishingTrip | undefined {
  return activeTrip && activeTrip.id === id ? activeTrip : trips.find((trip) => trip.id === id);
}

export function tripUpdateFromDraft(value: TripDraft, trip?: SavedFishingTrip, records = value.fishRecords, selectedOutcome = value.outcome): { fields: UpdateTripInput; deferredEffort: boolean } {
  const before = value.fishRecordsBase ?? trip?.fishRecords ?? [];
  const fishChanged = !trip || records.length !== before.length || records.some((fish, index) => !sameFish(fish, before[index]));
  const latest = trip ? initialDraft(trip) : undefined;
  const base = value.scalarBase ?? latest?.scalarBase;
  const outcomeOverride = selectedOutcome !== value.outcome;
  const current = { ...value };
  if (latest && base) for (const key of SCALAR_FIELDS) if (value[key] === base[key]) Object.assign(current, { [key]: latest[key] });
  if (!fishChanged && selectedOutcome === value.outcome) selectedOutcome = current.outcome;
  const validationRecords = !fishChanged && trip ? trip.fishRecords : records;
  const completing = trip?.status === "active" && value.completing;
  const finished = trip?.status === "completed" || (!trip && value.recordingMode === "historical") || completing;
  const start = validPastDate(trip && current.tripDate === localDateTime(trip.tripDate, true) ? trip.tripDate : current.tripDate, "έναρξη");
  const end = current.endedAt ? validPastDate(trip?.endedAt && current.endedAt === localDateTime(trip.endedAt, true) ? trip.endedAt : current.endedAt, "λήξη") : null;
  if (end && end < start) throw new Error("Η λήξη δεν μπορεί να προηγείται της έναρξης.");
  if (finished && !selectedOutcome) throw new Error("Διάλεξε αν πιάσαμε ψάρια.");
  const outcome = selectedOutcome || (validationRecords.length ? "recorded" : "not-recorded");
  if (validationRecords.length > 0 && outcome !== "recorded") throw new Error("Υπάρχουν ψάρια. Επίλεξε «Πιάσαμε ψάρια» ή αφαίρεσέ τα.");
  if (validationRecords.length === 0 && outcome === "recorded") throw new Error("Πρόσθεσε ψάρι ή επίλεξε «Δεν πιάσαμε ψάρια» ή «Δεν θυμάμαι / Δεν σημείωσα».");
  const minutes = positiveNumber(current.fishingMinutes, "λεπτά ψαρέματος", true);
  const anglers = positiveNumber(current.anglerCount, "αριθμό ψαράδων", true);
  if (minutes !== null && minutes > 4294967295) throw new Error("Τα λεπτά ψαρέματος υπερβαίνουν το επιτρεπτό όριο.");
  if (anglers !== null && anglers > 100) throw new Error("Ο αριθμός ψαράδων πρέπει να είναι από 1 έως 100.");
  if (end && minutes !== null && minutes > (end.getTime() - start.getTime()) / 60_000 + 1) throw new Error("Τα λεπτά ψαρέματος δεν μπορούν να υπερβαίνουν την πραγματική διάρκεια (ανοχή ενός λεπτού).");
  const deferredEffort = !end && minutes !== null;
  if (!end && trip?.fishingMinutes != null && minutes !== null) throw new Error("Υπάρχουν αποθηκευμένα λεπτά ψαρέματος. Για να αφαιρέσεις τη λήξη, άδειασε ρητά τα λεπτά ή κράτησε τη γνωστή λήξη. Δεν διαγράφηκαν στοιχεία.");
  const fields: UpdateTripInput = {
    tripDate: start.toISOString(), endedAt: end?.toISOString() ?? null, outcome,
    fishingMinutes: end ? minutes : null, anglerCount: anglers,
    conditionsRecordedAt: current.conditionsRecordedAt ? validPastDate(trip?.conditionsRecordedAt && current.conditionsRecordedAt === localDateTime(trip.conditionsRecordedAt, true) ? trip.conditionsRecordedAt : current.conditionsRecordedAt, "ώρα συνθηκών").toISOString() : null,
    notes: current.notes,
    ...(fishChanged ? { fishRecords: records.map((record) => ({ ...record, images: trip?.fishRecords.find((fish) => fish.id === record.id)?.images ?? record.images })), ...(trip && value.fishRevisionBase ? { expectedFishRevision: value.fishRevisionBase } : {}) } : {}),
    ...(trip?.status === "active" ? { visibility: "private" as const } : {}),
    ...(completing ? { status: "completed" as const } : {}),
  };
  // A newer parent DTO must not turn untouched local fields into stale writes.
  if (trip && base) for (const key of SCALAR_FIELDS) if (value[key] === base[key] && !(key === "outcome" && (fishChanged || outcomeOverride))) delete fields[key];
  if (trip && deferredEffort) delete fields.fishingMinutes;
  return { deferredEffort, fields };
}

export function draftAfterSave(saved: SavedFishingTrip, previous: TripDraft, deferredEffort: boolean): TripDraft {
  return { ...initialDraft(saved, previous.destination), ...(deferredEffort ? { fishingMinutes: previous.fishingMinutes } : {}) };
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
