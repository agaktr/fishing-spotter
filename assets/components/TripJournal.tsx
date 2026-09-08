import { useRef, useState } from "react";
import type { ApiUser, CreateTripInput, PublicLocationPrecision, RecordingMode, SavedFishingTrip, TripDestination, TripFishRecord, TripOutcome } from "@/lib/types";
import { createTrip, deleteTrip, deleteTripImage, fetchTrip, updateTrip, uploadTripImage } from "@/lib/client/api";
import { displayDate, draftKey, localDateTime, readDraft, removeDraft, usePersistentDraft, writeDraft } from "@/lib/client/drafts";
import { draftAfterSave, draftAfterFishSave, fishOnlyUpdate, EMPTY_FISH, initialDraft, positiveNumber, rememberTechnique, resolveSelectedTrip, tripUpdateFromDraft, type FishDraft, type TripDraft } from "@/lib/client/tripDraft";
import { TECHNIQUE_PROFILES } from "@/lib/techniqueProfiles";
import { TripMediaGallery } from "./TripMediaGallery";
import { TripConditions } from "./TripConditions";
import { EMPTY_TRIP_FILTERS, matchesTripFilters, tripSpecies } from "@/lib/client/tripHistory";

export function tripOutcomeLabel(trip: SavedFishingTrip): string {
  if (trip.outcome === "zero") return "Δεν πιάσαμε ψάρια";
  if (trip.outcome !== "recorded") return "Δεν θυμάμαι / Δεν σημείωσα";
  return `Πιάσαμε ψάρια · ${trip.fishRecords.reduce((sum, fish) => sum + fish.count, 0)}`;
}

export function TripJournal({ user, trips, activeTrip, destination, selectedTripId, onSelectTrip, onShowOnMap, onDestination, onRecheck, onUpdated, onDeleted, onLogin, onClose }: {
  user?: ApiUser; trips: SavedFishingTrip[]; activeTrip: SavedFishingTrip | null; destination?: TripDestination; selectedTripId?: string;
  onSelectTrip: (id?: string) => void; onDestination: (point: TripDestination) => void; onRecheck: (point: TripDestination) => void;
  onShowOnMap: (trip: SavedFishingTrip) => void;
  onUpdated: (trip: SavedFishingTrip) => void; onDeleted: (id: string) => void; onLogin: () => void; onClose: () => void;
}) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [editingTripId, setEditingTripId] = useState<string>();
  const [filters, setFilters] = useState(EMPTY_TRIP_FILTERS);
  const filteredTrips = trips.filter((trip) => matchesTripFilters(trip, filters));
  const selected = resolveSelectedTrip(selectedTripId, trips, activeTrip);
  const editable = selected && selected.userId === user?.id ? selected : undefined;
  const editing = editable && (selected?.status === "active" || editingTripId === selected?.id);
  const subject = editable ? editable.id : !selectedTripId && destination ? `new:${destination.technique}:${destination.lat}:${destination.lon}` : undefined;
  function editTrip(id: string) { setEditingTripId(id); onSelectTrip(id); }
  async function remove(trip: SavedFishingTrip) {
    if (!user || !window.confirm("Οριστική διαγραφή εξόρμησης, ψαριών και εικόνων;")) return;
    setBusy(true);
    try { await deleteTrip(trip.id); removeDraft(user.id, trip.id); onDeleted(trip.id); setError(undefined); }
    catch (error) { setError(error instanceof Error ? error.message : "Η διαγραφή απέτυχε."); }
    finally { setBusy(false); }
  }
  return <section className="workflow-panel trip-journal" aria-label="Ημερολόγιο εξορμήσεων">
    <div className="trip-journal-header flex items-start justify-between gap-3"><div><p className="ui-eyebrow">Προσωπικό ημερολόγιο</p><h2 className="mt-1 text-xl font-black">Εξορμήσεις</h2></div><button className="ui-close shrink-0" aria-label="Κλείσιμο ημερολογίου" onClick={onClose}>x</button></div>
    {!user && <div className="ui-notice mt-4"><p>Συνδέσου για τις δικές σου εξορμήσεις. Το επιλεγμένο σημείο θα διατηρηθεί.</p><button className="ui-primary mt-3" onClick={onLogin}>Σύνδεση / ενεργοποίηση</button></div>}
    {error && <p role="alert" className="ui-error mt-3">{error}</p>}
    {editing && selected?.status !== "active" && <button className="ui-secondary mt-4" onClick={() => setEditingTripId(undefined)}>Προβολή αποθηκευμένων στοιχείων</button>}
    {selected && !editing && <article className="mt-4 space-y-3" aria-label="Λεπτομέρειες εξόρμησης">
      <TripDetails trip={selected} />
      <div className="flex flex-wrap gap-2">
        <button className="ui-secondary" onClick={() => onShowOnMap(selected)}>Τοποθεσία στον χάρτη</button>
        {editable && editingTripId !== selected.id && <button className="ui-primary" onClick={() => editTrip(selected.id)}>Επεξεργασία</button>}
        <button className="ui-secondary" onClick={() => { setEditingTripId(undefined); onSelectTrip(undefined); }}>Όλες οι εξορμήσεις</button>
      </div>
      <details className="trip-disclosure"><summary>Περισσότερες επιλογές</summary><div className="flex flex-wrap gap-2">
        <button className="ui-secondary" onClick={() => onRecheck({ name: selected.locationName, lat: selected.lat, lon: selected.lon, technique: selected.technique })}>Νέος έλεγχος συνθηκών</button>
        <button className="ui-secondary" onClick={() => onDestination({ name: selected.locationName, lat: selected.lat, lon: selected.lon, technique: selected.technique })}>Νέα εξόρμηση εδώ</button>
        {editable && <button className="ui-secondary" disabled={busy} onClick={() => void remove(selected)}>Διαγραφή εξόρμησης</button>}
      </div></details>
    </article>}
    {activeTrip && user && !selected && <button className="ui-notice mt-4 w-full text-left" onClick={() => editTrip(activeTrip.id)}>Συνέχεια ενεργής: {activeTrip.locationName}</button>}
    {selected && !editable && <div className="ui-notice mt-4">Δημόσια καταγραφή. Η τοποθεσία {selected.publicLocationPrecision === "exact" ? "έχει κοινοποιηθεί με ακρίβεια" : "είναι προσεγγιστική, όχι το ακριβές σημείο του κατόχου"}.</div>}
    {user && subject && (!selected || editing) ? <TripEditor key={draftKey(user.id, subject)} user={user} subject={subject} trip={editable} destination={destination} activeTrip={activeTrip} onUpdated={onUpdated} onSaved={(trip) => editTrip(trip.id)} onClose={onClose} onRecheck={onRecheck} /> : !selected && (selectedTripId || !trips.length) && <p className="ui-help mt-4">{selectedTripId ? "Φόρτωση επιλεγμένης εξόρμησης..." : "Διάλεξε σημείο στον χάρτη, στα αποτελέσματα ή στη βιβλιοθήκη για νέα εξόρμηση."}</p>}
    {!selected && !destination && <div className="mt-5 space-y-3"><h3 className="font-bold">{user ? "Ιστορικό εξορμήσεων" : "Δημόσιες εξορμήσεις"} ({trips.length})</h3>
      {!trips.length && <p className="ui-help">Δεν υπάρχουν διαθέσιμες εξορμήσεις.</p>}
      <details className="trip-disclosure"><summary>Φίλτρα ιστορικού {Object.values(filters).filter(Boolean).length > 0 && `(${Object.values(filters).filter(Boolean).length})`}</summary><fieldset className="grid grid-cols-2 gap-2">
        <label className="ui-label">Είδος<select className="ui-input" value={filters.species} onChange={(e) => setFilters({ ...filters, species: e.target.value })}><option value="">Όλα τα είδη</option>{[...new Set(trips.flatMap(tripSpecies))].sort((a, b) => a.localeCompare(b, "el")).map((species) => <option key={species}>{species}</option>)}</select></label>
        <label className="ui-label">Τεχνική<select className="ui-input" value={filters.technique} onChange={(e) => setFilters({ ...filters, technique: e.target.value })}><option value="">Όλες οι τεχνικές</option>{Object.values(TECHNIQUE_PROFILES).map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label>
        <label className="ui-label">Από ημερομηνία<input type="date" className="ui-input" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
        <label className="ui-label">Έως ημερομηνία<input type="date" className="ui-input" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
        <label className="ui-label">Κατάσταση<select className="ui-input" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">Όλες</option><option value="active">Ενεργές</option><option value="completed">Ολοκληρωμένες</option></select></label>
        <label className="ui-label">Πιάσαμε τίποτα;<select className="ui-input" value={filters.outcome} onChange={(e) => setFilters({ ...filters, outcome: e.target.value })}><option value="">Όλα</option><option value="zero">Δεν πιάσαμε ψάρια</option><option value="recorded">Πιάσαμε ψάρια</option><option value="not-recorded">Δεν θυμάμαι / Δεν σημείωσα</option></select></label>
      </fieldset>
      <div className="flex items-center justify-between gap-2"><p role="status" className="ui-help">{filteredTrips.length} / {trips.length} εξορμήσεις · ημερομηνία έναρξης, τοπική ώρα</p><button className="ui-secondary shrink-0" disabled={!Object.values(filters).some(Boolean)} onClick={() => setFilters(EMPTY_TRIP_FILTERS)}>Καθαρισμός</button></div>
      {filters.from && filters.to && filters.from > filters.to && <p role="alert" className="ui-error">Η λήξη του εύρους προηγείται της αρχής.</p>}
      </details>
      {trips.length > 0 && !filteredTrips.length && <p className="ui-help">Καμία εξόρμηση με αυτά τα φίλτρα.</p>}
      {filteredTrips.map((trip) => <article key={trip.id} className="trip-history-card">
        <div className="min-w-0 space-y-1"><button className="trip-location" onClick={() => { setEditingTripId(undefined); onSelectTrip(trip.id); }}>{trip.locationName}</button>
        <p className="ui-help">{displayDate(trip.tripDate)} · {trip.techniqueLabel} · {trip.status === "active" ? "Ενεργή" : "Ολοκληρωμένη"}</p>
        <p className="text-xs font-bold">{tripOutcomeLabel(trip)}</p>
        {tripSpecies(trip).length > 0 && <p className="ui-help">{tripSpecies(trip).join(" · ")}</p>}
        <div className="flex flex-wrap gap-2 pt-2">
          <button className="ui-primary" onClick={() => { setEditingTripId(undefined); onSelectTrip(trip.id); }}>{trip.status === "active" && trip.userId === user?.id ? "Συνέχεια" : "Άνοιγμα"}</button>
          <button className="ui-secondary" onClick={() => onShowOnMap(trip)}>Τοποθεσία στον χάρτη</button>
        </div></div>
        {(trip.images.length > 0 || trip.fishRecords.some((fish) => fish.images.length)) && <div className="trip-history-photo"><TripMediaGallery images={[...trip.images, ...trip.fishRecords.flatMap((fish) => fish.images)].slice(0, 1)} /></div>}
      </article>)}
    </div>}
  </section>;
}

function TripDetails({ trip }: { trip: SavedFishingTrip }) {
  return <>
    <p className="ui-eyebrow">{trip.username ? `@${trip.username}` : "Δημόσια κοινοποίηση"} · {trip.techniqueLabel}</p><h3 className="break-words font-black">{trip.locationName}</h3>
    <p className="ui-help">{displayDate(trip.tripDate)} · {trip.status === "active" ? "Ενεργή" : "Ολοκληρωμένη"} · {trip.recordingMode === "historical" ? "Ιστορική καταχώριση" : "Ζωντανή καταγραφή"}</p>
    <p className="text-xs font-bold">{tripOutcomeLabel(trip)}</p>
    <p className="ui-help">{trip.visibility === "public" ? `Κοινοποιημένη · ${trip.publicLocationPrecision === "exact" ? "ακριβές στίγμα" : "προσεγγιστική περιοχή"}` : "Μόνο εγώ"}</p>
    <p className="ui-help">Πραγματική λήξη: {displayDate(trip.endedAt)}. Καταχώριση ολοκλήρωσης: {displayDate(trip.completedAt)}.</p>
    {(trip.fishingMinutes != null || trip.anglerCount != null) && <p className="ui-help">Λεπτά ψαρέματος: {trip.fishingMinutes ?? "Άγνωστα"} · Ψαράδες: {trip.anglerCount ?? "Άγνωστοι"}</p>}
    <TripConditions weather={trip.weather} marine={trip.marine} recordedAt={trip.conditionsRecordedAt} label={trip.conditionsLabel} />
    {trip.notes && <p className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-2 text-xs">{trip.notes}</p>}
    <TripMediaGallery images={trip.images} />
    {trip.fishRecords.map((fish) => <div key={fish.id} className="break-words border-t border-slate-100 pt-2"><p className="text-xs font-bold">{fish.count}x {fish.species} · {fishMetrics(fish)}</p>{fish.notes && <p className="ui-help whitespace-pre-wrap">{fish.notes}</p>}<TripMediaGallery images={fish.images} /></div>)}
  </>;
}

function TripEditor({ user, subject, trip, destination, activeTrip, onUpdated, onSaved, onClose, onRecheck }: {
  user: ApiUser; subject: string; trip?: SavedFishingTrip; destination?: TripDestination; activeTrip: SavedFishingTrip | null;
  onUpdated: (trip: SavedFishingTrip) => void; onSaved: (trip: SavedFishingTrip) => void; onClose: () => void; onRecheck: (point: TripDestination) => void;
}) {
  const draft = usePersistentDraft(user.id, subject, () => {
    const initial = initialDraft(trip, destination);
    const stored = readDraft<TripDraft>(user.id, subject);
    // A stored pre-revision array cannot inherit a newer DTO's concurrency token.
    if (stored && stored.fishRevisionBase === undefined) initial.fishRevisionBase = null;
    // Older full forms may contain only a manually corrected start. Never quick-start over it.
    return !trip && stored && stored.fullEntry === undefined ? { ...initial, fullEntry: true } : initial;
  });
  const value = draft.value;
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const completing = trip?.status === "active" && value.completing;
  const pendingAction = value.pendingAction;
  const [publishing, setPublishing] = useState(false);
  const [conflictTrip, setConflictTrip] = useState<SavedFishingTrip>();
  const [precision, setPrecision] = useState<PublicLocationPrecision>("approximate");
  const [shareNotes, setShareNotes] = useState(false);
  const [sharedMediaIds, setSharedMediaIds] = useState<string[]>([]);
  const [shareConfirmed, setShareConfirmed] = useState(false);
  const point = value.destination ?? destination;
  const finished = trip?.status === "completed" || (!trip && value.recordingMode === "historical") || completing;
  const hasPendingFish = Object.entries(EMPTY_FISH).some(([field, defaultValue]) => value.fish[field as keyof FishDraft] !== defaultValue) || Boolean(value.fish.id);
  const images = trip ? [...trip.images, ...trip.fishRecords.flatMap((fish) => fish.images)] : [];
  const change = (fields: Partial<TripDraft>) => { draft.change((previous) => ({ ...previous, ...fields })); setMessage(undefined); };
  const setPendingAction = (pendingAction?: "save" | "complete") => change({ pendingAction });
  const setCompleting = (next: boolean) => change({ completing: next });
  const changeFish = (fields: Partial<FishDraft>) => change({ fish: { ...value.fish, ...fields } });
  const [fishOpen, setFishOpen] = useState(hasPendingFish);
  const fishSection = useRef<HTMLElement>(null);
  const photoSection = useRef<HTMLDetailsElement>(null);
  const quickStart = !trip && value.recordingMode === "live" && !value.fullEntry && !value.notes && !value.fishRecords.length && !hasPendingFish && !value.fishingMinutes && !value.anglerCount && !value.endedAt && !value.conditionsRecordedAt && value.outcome === "zero";

  function prepareFish(): TripFishRecord | undefined {
    try {
      const fish = value.fish;
      if (!fish.species.trim()) throw new Error("Γράψε είδος ψαριού.");
      const count = Number(fish.count);
      if (!Number.isInteger(count) || count < 1 || count > 999) throw new Error("Το πλήθος πρέπει να είναι ακέραιος από 1 έως 999.");
      const weightKg = positiveNumber(fish.weightKg, "βάρος") ?? undefined;
      const lengthCm = positiveNumber(fish.lengthCm, "μήκος") ?? undefined;
      if (count > 1 && ((weightKg !== undefined && !fish.weightBasis) || (lengthCm !== undefined && !fish.lengthBasis))) throw new Error("Για ομάδα ψαριών, δήλωσε ρητά τη βάση κάθε μέτρησης ή επίλεξε άγνωστη.");
      const existing = value.fishRecords.find((record) => record.id === fish.id);
      const record: TripFishRecord = { id: fish.id ?? crypto.randomUUID(), species: fish.species.trim(), count, weightKg, lengthCm,
        weightBasis: fish.weightBasis || (count === 1 ? "individual" : "unknown"), lengthBasis: fish.lengthBasis || (count === 1 ? "individual" : "unknown"),
        bait: fish.bait.trim(), notes: fish.notes.trim(), released: fish.released, images: existing?.images ?? [] };
      setError(undefined);
      return record;
    } catch (error) { setError(error instanceof Error ? error.message : "Έλεγξε τα στοιχεία ψαριού."); return undefined; }
  }

  async function addFish() {
    if (mutation.current) return;
    const record = prepareFish();
    if (!record) return;
    if (!trip) {
      change({ fishRecords: [...value.fishRecords.filter((fish) => fish.id !== record.id), record], fish: { ...EMPTY_FISH }, outcome: "recorded" });
      return;
    }
    mutation.current = true; setBusy(true); setMessage(undefined);
    const baseline = value.fishSaveBase !== undefined ? value.fishSaveBase : (value.fishRecordsBase ?? trip.fishRecords).find((fish) => fish.id === record.id) ?? null;
    change({ fish: { ...value.fish, id: record.id }, fishSaveBase: baseline });
    try {
      const latest = await fetchTrip(trip.id);
      let fields;
      try { fields = fishOnlyUpdate(latest, record, baseline); }
      catch (error) { setConflictTrip(latest); throw error; }
      const saved = await updateTrip(trip.id, fields);
      // Do not reset the editor or submit notes, effort, dates or other local catch edits.
      draft.change((previous) => draftAfterFishSave(previous, trip, saved, record.id));
      onUpdated(saved); setFishOpen(false); setConflictTrip(undefined); setMessage("Το ψάρι αποθηκεύτηκε. Οι υπόλοιπες αλλαγές σου διατηρούνται.");
    } catch (error) { setError(error instanceof Error ? error.message : "Το ψάρι δεν αποθηκεύτηκε. Τα στοιχεία διατηρήθηκαν για νέα προσπάθεια."); }
    finally { mutation.current = false; setBusy(false); }
  }

  function requestSave(action: "save" | "complete") {
    if (mutation.current) return;
    setError(undefined);
    if (hasPendingFish) { setPendingAction(action); return; }
    if (action === "complete" && !window.confirm("Ολοκλήρωση εξόρμησης και αποθήκευση αλλαγών; Η λήξη είναι προαιρετική.")) return;
    void save(value.fishRecords, value.outcome, { ...value, completing: action === "complete" || value.completing });
  }
  function resolvePending(add: boolean) {
    const record = add ? prepareFish() : undefined;
    if (add && !record) return;
    const records = record ? [...value.fishRecords.filter((fish) => fish.id !== record.id), record] : value.fishRecords;
    const next = { ...value, fishRecords: records, fish: { ...EMPTY_FISH }, fishSaveBase: undefined, outcome: record ? "recorded" as const : value.outcome, pendingAction: undefined, completing: pendingAction === "complete" || value.completing };
    change(next);
    void save(records, next.outcome, next);
  }

  async function save(records: TripFishRecord[], outcomeOverride = value.outcome, submitted = value) {
    if (mutation.current) return;
    setError(undefined); setMessage(undefined);
    try {
      const { fields, deferredEffort } = tripUpdateFromDraft(submitted, trip, records, outcomeOverride);
      if (deferredEffort && !writeDraft(user.id, subject, submitted)) throw new Error("Ο browser δεν μπορεί να διατηρήσει την εκκρεμή προσπάθεια. Αποκατάστησε την τοπική αποθήκευση ή αφαίρεσέ την ρητά πριν αποθηκεύσεις.");
      mutation.current = true; setBusy(true);
      let saved: SavedFishingTrip;
      if (trip) saved = await updateTrip(trip.id, fields);
      else {
        const start = new Date(fields.tripDate!);
        if (!point) throw new Error("Διάλεξε τοποθεσία.");
        if (submitted.recordingMode === "live" && activeTrip) throw new Error("Ολοκλήρωσε πρώτα την ενεργή εξόρμηση ή διάλεξε ιστορική καταχώριση.");
        // A forecast or an old scan must never become the observed weather of a trip.
        const snapshotTime = point.conditionsAt ? new Date(point.conditionsAt).getTime() : NaN;
        const spot = submitted.recordingMode === "live" && point.spot?.weather.temporalMode !== "forecast" && point.spot?.marine.temporalMode !== "forecast" && Math.abs(snapshotTime - start.getTime()) < 3_600_000 && snapshotTime <= Date.now() ? point.spot : undefined;
        const input: CreateTripInput = {
          ...fields, tripDate: start.toISOString(), endedAt: fields.endedAt ?? null, outcome: fields.outcome!,
          fishingMinutes: fields.fishingMinutes ?? null, anglerCount: fields.anglerCount ?? null,
          conditionsRecordedAt: fields.conditionsRecordedAt ?? (spot ? point.conditionsAt ?? null : null),
          recordingMode: submitted.recordingMode, visibility: "private", publicLocationPrecision: "approximate", shareNotes: false, sharedMediaIds: [],
          technique: point.technique, techniqueLabel: TECHNIQUE_PROFILES[point.technique].label, locationName: point.name, lat: point.lat, lon: point.lon,
          fishRecords: fields.fishRecords ?? [], spotId: spot?.id, score: spot?.score,
          conditionsLabel: spot?.conditionsLabel ?? "Χωρίς παρατηρημένο στιγμιότυπο συνθηκών.", depthLabel: spot?.techniqueDepthRange.label, seabedLabel: spot?.seabedLabel,
          weather: spot?.weather, marine: spot?.marine,
        };
        saved = await createTrip(input);
        rememberTechnique(point.technique);
      }
      const nextDraft = draftAfterSave(saved, submitted, deferredEffort);
      draft.reset(nextDraft);
      const retained = !deferredEffort || writeDraft(user.id, saved.id, nextDraft);
      onUpdated(saved); onSaved(saved);
      if (!retained) window.alert(`Η εξόρμηση αποθηκεύτηκε, αλλά απέτυχε η τοπική διατήρηση των ${submitted.fishingMinutes} λεπτών ψαρέματος. Συμπλήρωσέ τα ξανά μετά την πραγματική λήξη.`);
      setMessage(deferredEffort ? "Η εξόρμηση αποθηκεύτηκε. Τα λεπτά ψαρέματος διατηρούνται στη συσκευή μέχρι να δηλώσεις πραγματική λήξη." : "Η εξόρμηση αποθηκεύτηκε.");
    } catch (error) { setError(error instanceof Error ? error.message : "Η αποθήκευση απέτυχε. Οι αλλαγές διατηρήθηκαν στη συσκευή."); }
    finally { mutation.current = false; setBusy(false); }
  }

  async function media(files: File[], fishId?: string, removeId?: string) {
    if (!trip || mutation.current) return;
    mutation.current = true; setBusy(true); setError(undefined);
    try {
      if (removeId) onUpdated(await deleteTripImage(trip.id, removeId));
      else for (const file of files) onUpdated(await uploadTripImage(trip.id, file, fishId));
      setMessage("Η εικόνα αποθηκεύτηκε. Οι υπόλοιπες αλλαγές χρειάζονται αποθήκευση.");
    } catch (error) { setError(error instanceof Error ? error.message : "Η εικόνα δεν αποθηκεύτηκε. Ήδη επιτυχημένα uploads διατηρούνται."); }
    finally { mutation.current = false; setBusy(false); }
  }

  async function publish(makePrivate = false) {
    if (!trip || trip.status !== "completed" || mutation.current) return;
    mutation.current = true; setBusy(true); setError(undefined);
    try {
      const saved = await updateTrip(trip.id, makePrivate ? { visibility: "private" } : { visibility: "public", publicLocationPrecision: precision, shareNotes, sharedMediaIds });
      onUpdated(saved); setPublishing(false); setMessage(makePrivate ? "Μόνο εγώ. Τυχόν εξωτερικά αντίγραφα δεν ανακαλούνται." : "Κοινοποιήθηκαν τα αποθηκευμένα στοιχεία με τις επιλογές σου.");
    } catch (error) { setError(error instanceof Error ? error.message : "Η αλλαγή κοινοποίησης απέτυχε."); }
    finally { mutation.current = false; setBusy(false); }
  }

  return <div className="trip-workspace mt-4 space-y-4" aria-label={trip?.status === "active" ? "Ενεργή εξόρμηση" : quickStart ? "Γρήγορη έναρξη" : "Καταγραφή εξόρμησης"}>
    <div><p className="ui-help">{trip?.status === "active" ? "Ψαρεύουμε τώρα" : trip ? "Επεξεργασία εξόρμησης" : quickStart ? "Έτοιμοι για ψάρεμα;" : "Καταγραφή εξόρμησης"}</p><h3 className="mt-1 text-xl font-black">{trip?.locationName ?? point?.name}</h3><p className="ui-help">{trip ? `${trip.techniqueLabel} · ${displayDate(trip.tripDate)}` : `${point?.lat.toFixed(5)}, ${point?.lon.toFixed(5)}`}</p></div>
    {trip?.visibility === "public" && <p className="ui-warning">Οι αλλαγές που αποθηκεύεις κοινοποιούνται με τις τρέχουσες επιλογές. Επίλεξε «Μόνο εγώ» πριν προσθέσεις ευαίσθητα στοιχεία. Νέες εικόνες δεν κοινοποιούνται αυτόματα.</p>}
    {draft.storageError && <p role="alert" className="ui-warning">Δεν είναι δυνατή η αυτόματη ανάκτηση αλλαγών. Μην κλείσεις ή ανανεώσεις τη σελίδα πριν αποθηκεύσεις στον server.</p>}
    {error && <p role="alert" className="ui-error">{error}</p>}{message && <p role="status" className="ui-notice">{message}</p>}
    {conflictTrip && <details className="trip-disclosure"><summary>Αποθηκευμένη έκδοση ψαριού</summary><p className="ui-help">{conflictTrip.fishRecords.filter((fish) => fish.id === value.fish.id).map((fish) => `${fish.count}x ${fish.species} · ${fishMetrics(fish)} · ${fish.notes ?? ""}`).join(" ") || "Το ψάρι αφαιρέθηκε σε άλλη συσκευή."}</p><button className="ui-secondary" onClick={() => { change({ fishSaveBase: conflictTrip.fishRecords.find((fish) => fish.id === value.fish.id) ?? null }); setConflictTrip(undefined); setError(undefined); }}>Κράτησε τα δικά μου στοιχεία για νέα αποθήκευση</button></details>}
    <fieldset disabled={busy} className="min-w-0 space-y-3">
      {!trip && point && <label className="ui-label">Τεχνική<select className="ui-input" value={point.technique} onChange={(event) => {
        const technique = event.target.value as TripDestination["technique"];
        rememberTechnique(technique);
        change({ destination: { ...point, technique, spot: undefined, conditionsAt: undefined } });
      }}>{Object.values(TECHNIQUE_PROFILES).map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label>}
      {quickStart ? <div className="space-y-3">
        <p className="ui-help">Η έναρξη μπαίνει αυτόματα τώρα. Ξεκινάς με 0 ψάρια και προσθέτεις ό,τι πιάσεις.</p>
        <button className="ui-primary w-full" disabled={Boolean(activeTrip)} onClick={() => void save([], "zero", { ...value, tripDate: localDateTime(new Date().toISOString(), true) })}>{busy ? "Έναρξη..." : "Έναρξη ψαρέματος"}</button>
        {activeTrip && <p className="ui-notice">Υπάρχει ήδη ενεργή εξόρμηση. Συνέχισέ την ή πρόσθεσε παλιότερη καταγραφή.</p>}
        <button className="ui-secondary w-full" onClick={() => change({ recordingMode: "historical", fullEntry: true, tripDate: "" })}>Προσθήκη παλιότερης εξόρμησης</button>
        <button className="trip-text-action" onClick={() => change({ fullEntry: true })}>Πλήρης καταγραφή / διαφορετική έναρξη</button>
      </div> : <>
      {trip?.status === "active" && <div className="trip-live-actions">
        <p className="font-bold">{trip.fishRecords.reduce((sum, fish) => sum + fish.count, 0)} ψάρια <span className="ui-help">αποθηκευμένα</span></p>
        <div className="flex flex-wrap gap-2"><button className="ui-primary" onClick={() => { setFishOpen(true); window.setTimeout(() => { fishSection.current?.scrollIntoView({ block: "nearest" }); fishSection.current?.querySelector("input")?.focus({ preventScroll: true }); }, 0); }}>+ Ψάρι</button><button className="ui-secondary" onClick={() => { if (photoSection.current) { photoSection.current.open = true; photoSection.current.scrollIntoView({ block: "nearest" }); } }}>Φωτογραφία</button><button className="ui-secondary" onClick={() => requestSave("complete")}>Τέλος ψαρέματος</button></div>
      </div>}
      {pendingAction && <div role="alert" className="ui-warning space-y-2"><p>Υπάρχουν μη προστιθέμενα στοιχεία ψαριού. Τι θέλεις να γίνει πριν συνεχίσεις;</p><div className="flex flex-wrap gap-2"><button className="ui-secondary" onClick={() => resolvePending(true)}>Προσθήκη / ενημέρωση και συνέχεια</button><button className="ui-secondary" onClick={() => resolvePending(false)}>Απόρριψη και συνέχεια</button><button className="ui-secondary" onClick={() => setPendingAction(undefined)}>Συνέχεια επεξεργασίας</button></div></div>}
      {!trip && <label className="ui-label">Πότε πήγαμε;<select className="ui-input" value={value.recordingMode} onChange={(event) => change({ recordingMode: event.target.value as RecordingMode })}><option value="live">Ψαρεύουμε τώρα</option><option value="historical">Έχουμε επιστρέψει</option></select></label>}
      {!trip && <label className="ui-label">Πότε ξεκινήσαμε;<input type="datetime-local" step="1" className="ui-input" max={localDateTime(new Date().toISOString(), true)} value={value.tripDate} onChange={(e) => change({ tripDate: e.target.value })} /></label>}
      {trip?.status === "active" ? <details className="trip-disclosure"><summary>Αποτέλεσμα · {value.outcome === "zero" ? "0 ψάρια" : value.outcome === "recorded" ? "Πιάσαμε ψάρια" : "Δεν σημειώθηκε"}</summary><OutcomeInput value={value.outcome} onChange={(outcome) => change({ outcome })} /></details> : <OutcomeInput value={value.outcome} onChange={(outcome) => change({ outcome })} />}
      {value.outcome === "zero" && (value.fishRecords.length > 0 || hasPendingFish) && <div className="ui-notice space-y-2">
        {value.fishRecords.length > 0 && <p role="alert" className="ui-error">Υπάρχουν ψάρια. Επίλεξε «Πιάσαμε ψάρια» ή αφαίρεσέ τα πριν αποθηκεύσεις. Οι εγγραφές δεν διαγράφηκαν.</p>}
        {hasPendingFish && !trip && <p>Τα στοιχεία ψαριού διατηρούνται. Επίλεξε «Πιάσαμε ψάρια» για να συνεχίσεις.</p>}
      </div>}
      {(trip || value.outcome !== "zero" || value.fishRecords.length > 0) && <section ref={fishSection} aria-label="Ψάρια" className="space-y-3">{(value.fishRecords.length > 0 || fishOpen || hasPendingFish || !trip) && <h3 className="font-black">Ψάρια</h3>}
      {(trip ? fishOpen || hasPendingFish : value.outcome !== "zero") && <div className="fish-entry space-y-3"><h4 className="font-bold">{value.fish.id && value.fishRecords.some((fish) => fish.id === value.fish.id) ? "Επεξεργασία ψαριού" : "Προσθήκη ψαριού"}</h4>
        <label className="ui-label">Είδος<input className="ui-input" value={value.fish.species} onChange={(e) => changeFish({ species: e.target.value })} /></label>
        <label className="ui-label">Πόσα;<input className="ui-input" type="number" min="1" step="1" value={value.fish.count} onChange={(e) => changeFish({ count: e.target.value, ...(Number(e.target.value) > 1 && Number(value.fish.count) <= 1 ? { weightBasis: "", lengthBasis: "" } : {}) })} /></label>
        <label className="ui-check"><input type="checkbox" checked={value.fish.released} onChange={(e) => changeFish({ released: e.target.checked })} />Όλα απελευθερώθηκαν (C&amp;R)</label>
        <details className="space-y-3"><summary className="cursor-pointer text-xs font-bold">Μετρήσεις, δόλωμα και σημειώσεις (προαιρετικά)</summary>
        <div className="grid grid-cols-2 gap-2"><label className="ui-label">Βάρος kg<input className="ui-input" type="number" min="0.001" step="any" value={value.fish.weightKg} onChange={(e) => changeFish({ weightKg: e.target.value })} /></label><label className="ui-label">Βάση βάρους<select className="ui-input" value={value.fish.weightBasis} onChange={(e) => changeFish({ weightBasis: e.target.value as FishDraft["weightBasis"] })}><option value="">Επίλεξε βάση</option><option value="individual">Ένα άτομο</option><option value="total">Συνολικό ομάδας</option><option value="average">Μέσο ανά άτομο</option><option value="unknown">Άγνωστη βάση</option></select></label></div>
        <div className="grid grid-cols-2 gap-2"><label className="ui-label">Μήκος cm<input className="ui-input" type="number" min="0.1" step="any" value={value.fish.lengthCm} onChange={(e) => changeFish({ lengthCm: e.target.value })} /></label><label className="ui-label">Βάση μήκους<select className="ui-input" value={value.fish.lengthBasis} onChange={(e) => changeFish({ lengthBasis: e.target.value as FishDraft["lengthBasis"] })}><option value="">Επίλεξε βάση</option><option value="individual">Ένα άτομο</option><option value="average">Μέσο ανά άτομο</option><option value="unknown">Άγνωστη βάση</option></select></label></div>
        <label className="ui-label">Δόλωμα<input className="ui-input" value={value.fish.bait} onChange={(e) => changeFish({ bait: e.target.value })} /></label>
        <label className="ui-label">Σημειώσεις ψαριού<input className="ui-input" value={value.fish.notes} onChange={(e) => changeFish({ notes: e.target.value })} /></label>
        </details>
        <button type="button" className="ui-primary w-full" onClick={() => void addFish()}>{busy ? "Αποθήκευση..." : value.fish.id && value.fishRecords.some((fish) => fish.id === value.fish.id) ? "Ενημέρωση ψαριού" : "Προσθήκη ψαριού"}</button>
        {hasPendingFish && <button className="ui-secondary w-full" onClick={() => { if (window.confirm("Απόρριψη μόνο των στοιχείων ψαριού που γράφεις τώρα;")) change({ fish: { ...EMPTY_FISH }, fishSaveBase: undefined }); }}>Απόρριψη φόρμας ψαριού</button>}
      </div>}
      {trip?.status === "completed" && !fishOpen && !hasPendingFish && <button className="trip-text-action" onClick={() => setFishOpen(true)}>+ Προσθήκη ψαριού</button>}
      {value.fishRecords.map((fish) => {
        const persisted = trip?.fishRecords.find((record) => record.id === fish.id);
        return <article key={fish.id} className="space-y-2 rounded-2xl border border-kelp/20 p-3"><h4 className="text-sm font-black">{fish.count}x {fish.species}</h4><p className="ui-help">{fishMetrics(fish)}</p>{fish.notes && <p className="ui-help">{fish.notes}</p>}
          <div className="flex flex-wrap gap-2"><button className="ui-secondary" onClick={() => {
            if (hasPendingFish && !window.confirm("Απόρριψη της εκκρεμούς φόρμας για επεξεργασία άλλου ψαριού;")) return;
            change({ outcome: "recorded" });
            setFishOpen(true);
            change({ fishSaveBase: undefined, fish: { id: fish.id, species: fish.species, count: String(fish.count), weightKg: fish.weightKg?.toString() ?? "", lengthCm: fish.lengthCm?.toString() ?? "", weightBasis: fish.weightBasis ?? "unknown", lengthBasis: fish.lengthBasis ?? "unknown", bait: fish.bait ?? "", notes: fish.notes ?? "", released: fish.released } });
          }}>Επεξεργασία</button><button className="ui-secondary" onClick={() => {
            if (!window.confirm("Αφαίρεση ψαριού; Οι εικόνες του θα αφαιρεθούν όταν αποθηκεύσεις.")) return;
            const records = value.fishRecords.filter((record) => record.id !== fish.id);
            change({ fishRecords: records, ...(value.fish.id === fish.id ? { fish: { ...EMPTY_FISH } } : {}) });
          }}>Αφαίρεση</button></div>
          {persisted ? <><TripMediaGallery images={persisted.images} busy={busy} onRemove={(id) => void media([], undefined, id)} /><UploadInput label={`Εικόνες ψαριού (${persisted.images.length}/5)`} disabled={persisted.images.length >= 5} onFiles={(files) => void media(files, fish.id)} /></> : <p className="ui-help">Αποθήκευσε πρώτα την εγγραφή για να προσθέσεις εικόνες.</p>}
        </article>;
      })}
      </section>}
      {trip && <details ref={photoSection} className="trip-disclosure"><summary>Φωτογραφίες εξόρμησης ({trip.images.length}/20)</summary><TripMediaGallery images={trip.images} busy={busy} onRemove={(id) => void media([], undefined, id)} /><UploadInput label="Πρόσθεσε εικόνες εξόρμησης" disabled={trip.images.length >= 20} onFiles={(files) => void media(files)} /><p className="ui-help mt-2">Οι εικόνες αποθηκεύονται αμέσως. Κοινοποιούνται μόνο αν τις επιλέξεις.</p></details>}
      {!trip && <p className="ui-help">Φωτογραφίες μπορείς να προσθέσεις μόλις αποθηκεύσεις την εξόρμηση.</p>}
      {trip ? <details className="trip-disclosure"><summary>Σημειώσεις {value.notes && "· Έχουν προστεθεί"}</summary><label className="ui-label">Σημειώσεις<textarea rows={3} className="ui-input" value={value.notes} onChange={(e) => change({ notes: e.target.value })} /></label></details> : <label className="ui-label">Σημειώσεις<textarea rows={3} className="ui-input" value={value.notes} onChange={(e) => change({ notes: e.target.value })} /></label>}
      <details className="trip-disclosure space-y-3"><summary className="cursor-pointer text-xs font-bold">Χρόνος ψαρέματος και παρέα (προαιρετικά)</summary>
        {trip && <label className="ui-label">Πότε ξεκινήσαμε;<input type="datetime-local" step="1" className="ui-input" max={localDateTime(new Date().toISOString(), true)} value={value.tripDate} onChange={(e) => change({ tripDate: e.target.value })} /></label>}
        {(finished || trip) && <label className="ui-label">Λήξη (προαιρετικά)<input type="datetime-local" step="1" className="ui-input" max={localDateTime(new Date().toISOString(), true)} min={value.tripDate} value={value.endedAt} onChange={(e) => change({ endedAt: e.target.value })} /></label>}
        <div className="grid grid-cols-2 gap-2"><label className="ui-label">Ψάρεμα σε λεπτά<input type="number" min="1" step="1" placeholder="Άγνωστα" className="ui-input" value={value.fishingMinutes} onChange={(e) => change({ fishingMinutes: e.target.value })} /></label><label className="ui-label">Πόσοι ψαρεύαμε;<input type="number" min="1" max="100" step="1" placeholder="Άγνωστο" className="ui-input" value={value.anglerCount} onChange={(e) => change({ anglerCount: e.target.value })} /></label></div>
        {!value.endedAt && <p className="ui-help">Μόνο τα λεπτά ψαρέματος μένουν στη συσκευή μέχρι να συμπληρώσεις τη λήξη. Ο αριθμός ψαράδων αποθηκεύεται και χωρίς λήξη.</p>}
      </details>
      <TripConditions weather={trip ? trip.weather : value.recordingMode === "live" ? point?.spot?.weather : undefined} marine={trip ? trip.marine : value.recordingMode === "live" ? point?.spot?.marine : undefined} pending={!trip} label={trip?.conditionsLabel}>
        <label className="ui-label">Ώρα συνθηκών (αν τη γνωρίζεις)<input type="datetime-local" step="1" max={localDateTime(new Date().toISOString(), true)} className="ui-input" value={value.conditionsRecordedAt} onChange={(e) => change({ conditionsRecordedAt: e.target.value })} /></label>
      </TripConditions>
      <div className="grid gap-2"><button className="ui-primary" disabled={!trip && value.recordingMode === "live" && Boolean(activeTrip)} onClick={() => requestSave("save")}>{busy ? "Αποθήκευση..." : completing ? "Επιβεβαίωση ολοκλήρωσης" : trip ? "Αποθήκευση εξόρμησης" : value.recordingMode === "historical" ? "Αποθήκευση ολοκληρωμένης εξόρμησης" : "Έναρξη εξόρμησης"}</button>
        {completing && <button className="ui-secondary" onClick={() => setCompleting(false)}>Συνέχεια ενεργής εξόρμησης</button>}
        <button className="ui-secondary" onClick={onClose}>Κλείσιμο</button>
      </div>
      {trip?.status === "completed" && <details className="trip-disclosure space-y-3"><summary>Κοινοποίηση · {trip.visibility === "public" ? "Κοινοποιημένη" : "Μόνο εγώ"}</summary>
        <button className="ui-secondary" onClick={() => { setPrecision(trip.visibility === "public" ? trip.publicLocationPrecision : "approximate"); setShareNotes(trip.visibility === "public" ? trip.shareNotes : false); setSharedMediaIds(trip.visibility === "public" ? trip.sharedMediaIds : []); setShareConfirmed(false); setPublishing(true); }}>Κοινοποίηση</button>
        {trip.visibility === "public" && <button className="ui-secondary ml-2" onClick={() => void publish(true)}>Μόνο εγώ</button>}
        {publishing && <div className="space-y-3 rounded-2xl border border-amber-200 p-3"><p className="ui-warning">Φωτογραφίες, ονόματα, σημειώσεις και ορατά τοπόσημα μπορεί να αποκαλύπτουν το σημείο. Δημόσια αντίγραφα ή screenshots δεν ανακαλούνται όταν κάνεις την εξόρμηση ξανά ιδιωτική.</p>
          <p className="ui-help">Κοινοποιείται η αποθηκευμένη έκδοση, όχι οι εκκρεμείς αλλαγές.</p>
          <label className="ui-label">Τοποθεσία<select className="ui-input" value={precision} onChange={(e) => setPrecision(e.target.value as PublicLocationPrecision)}><option value="approximate">Προσεγγιστική περιοχή</option><option value="exact">Ακριβές στίγμα</option></select></label>
          <p className="ui-help">{precision === "approximate" ? "Κρύβονται το ακριβές όνομα και οι πηγές συντεταγμένων. Εσύ διατηρείς το ακριβές σημείο." : "Όλοι θα βλέπουν το ακριβές σημείο και το όνομα τοποθεσίας."}</p>
          <label className="ui-check"><input type="checkbox" checked={shareNotes} onChange={(e) => setShareNotes(e.target.checked)} />Κοινοποίηση σημειώσεων εξόρμησης και ψαριών</label>
          {shareNotes && <p className="ui-warning whitespace-pre-wrap">{trip.notes || "Χωρίς σημειώσεις εξόρμησης."}{trip.fishRecords.filter((fish) => fish.notes).map((fish) => `\n${fish.species}: ${fish.notes}`).join("")}</p>}
          <p className="ui-label">Μόνο οι επιλεγμένες αποθηκευμένες εικόνες θα δημοσιευτούν</p>
          {!images.length && <p className="ui-help">Δεν υπάρχουν αποθηκευμένες εικόνες.</p>}
          {images.map((image) => <div key={image.id}><label className="ui-check"><input type="checkbox" checked={sharedMediaIds.includes(image.id)} onChange={(e) => setSharedMediaIds((ids) => e.target.checked ? [...ids, image.id] : ids.filter((id) => id !== image.id))} />{image.originalName}</label><TripMediaGallery images={[image]} /></div>)}
          <label className="ui-check"><input type="checkbox" checked={shareConfirmed} onChange={(e) => setShareConfirmed(e.target.checked)} />Συμφωνώ να είναι ορατά σε όλους με αυτές τις επιλογές.</label><button className="ui-primary w-full" disabled={!shareConfirmed} onClick={() => void publish()}>Επιβεβαίωση κοινοποίησης</button><button className="ui-secondary w-full" onClick={() => setPublishing(false)}>Ακύρωση</button>
        </div>}
      </details>}
      </>}
    </fieldset>
  </div>;
}

function UploadInput({ label, disabled, onFiles }: { label: string; disabled: boolean; onFiles: (files: File[]) => void }) {
  return <label className="ui-label mt-3">{label}<input className="ui-input text-xs" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled} onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} /></label>;
}

function OutcomeInput({ value, onChange }: { value: TripOutcome | ""; onChange: (outcome: TripOutcome) => void }) {
  return <label className="ui-label">Πιάσαμε τίποτα;<select className="ui-input" value={value} onChange={(event) => onChange(event.target.value as TripOutcome)}>{value === "" && <option value="" disabled>Διάλεξε αν πιάσαμε ψάρια</option>}<option value="zero">Δεν πιάσαμε ψάρια</option><option value="recorded">Πιάσαμε ψάρια</option><option value="not-recorded">Δεν θυμάμαι / Δεν σημείωσα</option></select></label>;
}

function fishMetrics(fish: TripFishRecord): string {
  const basis = { individual: "ενός ατόμου", total: "σύνολο ομάδας", average: "μέσο ανά άτομο", unknown: "άγνωστη βάση" };
  return [fish.weightKg !== undefined ? `${fish.weightKg}kg (${basis[fish.weightBasis ?? "unknown"]})` : null, fish.lengthCm !== undefined ? `${fish.lengthCm}cm (${basis[fish.lengthBasis ?? "unknown"]})` : null, fish.bait, fish.released ? "όλα απελευθερώθηκαν" : "όλα κρατήθηκαν"].filter(Boolean).join(" · ");
}
