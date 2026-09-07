import { useState } from "react";
import type { ApiUser, CreateTripInput, PublicLocationPrecision, RecordingMode, SavedFishingTrip, TripDestination, TripFishRecord, TripOutcome } from "@/lib/types";
import { createTrip, deleteTrip, deleteTripImage, updateTrip, uploadTripImage } from "@/lib/client/api";
import { displayDate, draftKey, localDateTime, removeDraft, usePersistentDraft, writeDraft } from "@/lib/client/drafts";
import { draftAfterSave, EMPTY_FISH, initialDraft, positiveNumber, resolveSelectedTrip, tripUpdateFromDraft, type FishDraft, type TripDraft } from "@/lib/client/tripDraft";
import { TECHNIQUE_PROFILES } from "@/lib/techniqueProfiles";
import { TripMediaGallery } from "./TripMediaGallery";
import { EMPTY_TRIP_FILTERS, matchesTripFilters, tripDurationMinutes, tripSpecies } from "@/lib/client/tripHistory";

export function tripOutcomeLabel(trip: SavedFishingTrip): string {
  if (trip.outcome === "zero") return "Ολοκληρωμένη καταγραφή: 0 ψάρια";
  if (trip.outcome !== "recorded") return "Αποτέλεσμα μη καταγεγραμμένο";
  return `${trip.fishRecords.reduce((sum, fish) => sum + fish.count, 0)} ψάρια καταγεγραμμένα`;
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
    <div className="flex items-start justify-between gap-3"><div><p className="ui-eyebrow">Προσωπικό ημερολόγιο</p><h2 className="mt-1 text-xl font-black">Εξορμήσεις</h2></div><button className="ui-close" aria-label="Κλείσιμο ημερολογίου" onClick={onClose}>x</button></div>
    {!user && <div className="ui-notice mt-4"><p>Συνδέσου για τις δικές σου εξορμήσεις. Το επιλεγμένο σημείο θα διατηρηθεί.</p><button className="ui-primary mt-3" onClick={onLogin}>Σύνδεση / ενεργοποίηση</button></div>}
    {error && <p role="alert" className="ui-error mt-3">{error}</p>}
    {editable && editingTripId === selected?.id && <button className="ui-secondary mt-4" onClick={() => setEditingTripId(undefined)}>Προβολή αποθηκευμένων στοιχείων</button>}
    {selected && (!editable || editingTripId !== selected.id) && <article className="mt-4 space-y-2 rounded-2xl border border-slate-200 p-3" aria-label="Λεπτομέρειες εξόρμησης">
      <TripDetails trip={selected} />
      <div className="flex flex-wrap gap-2">
        <button className="ui-secondary" onClick={() => onShowOnMap(selected)}>Τοποθεσία στον χάρτη</button>
        {editable && editingTripId !== selected.id && <button className="ui-primary" onClick={() => editTrip(selected.id)}>Επεξεργασία</button>}
        <button className="ui-secondary" onClick={() => { setEditingTripId(undefined); onSelectTrip(undefined); }}>Όλες οι εξορμήσεις</button>
      </div>
    </article>}
    {activeTrip && user && !selected && <button className="ui-notice mt-4 w-full text-left" onClick={() => editTrip(activeTrip.id)}>Συνέχεια ενεργής: {activeTrip.locationName}</button>}
    {selected && !editable && <div className="ui-notice mt-4">Δημόσια καταγραφή. Η τοποθεσία {selected.publicLocationPrecision === "exact" ? "έχει κοινοποιηθεί με ακρίβεια" : "είναι προσεγγιστική, όχι το ακριβές σημείο του κατόχου"}.</div>}
    {user && subject && (!selected || editable && editingTripId === selected.id) ? <TripEditor key={draftKey(user.id, subject)} user={user} subject={subject} trip={editable} destination={destination} activeTrip={activeTrip} onUpdated={onUpdated} onSaved={(trip) => editTrip(trip.id)} onClose={onClose} onRecheck={onRecheck} /> : !selected && <p className="ui-help mt-4">{selectedTripId ? "Φόρτωση επιλεγμένης εξόρμησης..." : "Διάλεξε σημείο στον χάρτη, στα αποτελέσματα ή στη βιβλιοθήκη για νέα εξόρμηση."}</p>}
    {!selected && <div className="mt-5 space-y-3 border-t border-slate-200 pt-4"><h3 className="ui-eyebrow">{user ? "Ιστορικό εξορμήσεων" : "Δημόσιες εξορμήσεις"} ({trips.length})</h3>
      {!trips.length && <p className="ui-help">Δεν υπάρχουν διαθέσιμες εξορμήσεις.</p>}
      <fieldset className="grid grid-cols-2 gap-2"><legend className="ui-label mb-2">Φίλτρα ιστορικού</legend>
        <label className="ui-label">Είδος<select className="ui-input" value={filters.species} onChange={(e) => setFilters({ ...filters, species: e.target.value })}><option value="">Όλα τα είδη</option>{[...new Set(trips.flatMap(tripSpecies))].sort((a, b) => a.localeCompare(b, "el")).map((species) => <option key={species}>{species}</option>)}</select></label>
        <label className="ui-label">Τεχνική<select className="ui-input" value={filters.technique} onChange={(e) => setFilters({ ...filters, technique: e.target.value })}><option value="">Όλες οι τεχνικές</option>{Object.values(TECHNIQUE_PROFILES).map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label>
        <label className="ui-label">Από ημερομηνία<input type="date" className="ui-input" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
        <label className="ui-label">Έως ημερομηνία<input type="date" className="ui-input" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
        <label className="ui-label">Κατάσταση<select className="ui-input" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">Όλες</option><option value="active">Ενεργές</option><option value="completed">Ολοκληρωμένες</option></select></label>
        <label className="ui-label">Αποτέλεσμα<select className="ui-input" value={filters.outcome} onChange={(e) => setFilters({ ...filters, outcome: e.target.value })}><option value="">Όλα</option><option value="recorded">Με καταγεγραμμένα ψάρια</option><option value="zero">Ρητά 0 ψάρια</option><option value="not-recorded">Μη καταγεγραμμένο</option></select></label>
      </fieldset>
      <div className="flex items-center justify-between gap-2"><p role="status" className="ui-help">{filteredTrips.length} / {trips.length} εξορμήσεις · ημερομηνία έναρξης, τοπική ώρα</p><button className="ui-secondary shrink-0" disabled={!Object.values(filters).some(Boolean)} onClick={() => setFilters(EMPTY_TRIP_FILTERS)}>Καθαρισμός</button></div>
      {filters.from && filters.to && filters.from > filters.to && <p role="alert" className="ui-error">Η λήξη του εύρους προηγείται της αρχής.</p>}
      {trips.length > 0 && !filteredTrips.length && <p className="ui-help">Καμία εξόρμηση με αυτά τα φίλτρα.</p>}
      {filteredTrips.map((trip) => <article key={trip.id} className="space-y-2 rounded-2xl border border-slate-200 p-3">
        <h3 className="break-words font-black">{trip.locationName}</h3>
        <p className="ui-help">{displayDate(trip.tripDate)} · {trip.techniqueLabel} · {trip.status === "active" ? "Ενεργή" : "Ολοκληρωμένη"}</p>
        <p className="text-xs font-bold">{tripOutcomeLabel(trip)}</p>
        {tripSpecies(trip).length > 0 && <p className="ui-help">{tripSpecies(trip).join(" · ")}</p>}
        <p className="ui-help">Διάρκεια εξόρμησης: {tripDurationMinutes(trip) === undefined ? "άγνωστη" : `${tripDurationMinutes(trip)} λεπτά`}{trip.fishingMinutes != null && ` · Ψάρεμα: ${trip.fishingMinutes} λεπτά`}</p>
        {trip.username && <p className="ui-help">@{trip.username}</p>}
        <div className="flex flex-wrap gap-2">
          <button className="ui-secondary" onClick={() => { setEditingTripId(undefined); onSelectTrip(trip.id); }}>Λεπτομέρειες</button>
          <button className="ui-secondary" onClick={() => onShowOnMap(trip)}>Τοποθεσία στον χάρτη</button>
          {trip.userId === user?.id && <button className="ui-secondary" onClick={() => editTrip(trip.id)}>Επεξεργασία</button>}
          <button className="ui-secondary" onClick={() => onRecheck({ name: trip.locationName, lat: trip.lat, lon: trip.lon, technique: trip.technique })}>Νέος έλεγχος συνθηκών</button>
          <button className="ui-secondary" onClick={() => onDestination({ name: trip.locationName, lat: trip.lat, lon: trip.lon, technique: trip.technique })}>Νέα εξόρμηση εδώ</button>
          {trip.userId === user?.id && <button className="ui-secondary" disabled={busy} onClick={() => void remove(trip)}>Διαγραφή</button>}
        </div>
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
    {trip.conditionsLabel && <p className="ui-help">Αποθηκευμένο στιγμιότυπο, όχι τρέχουσες συνθήκες: {trip.conditionsLabel} · {displayDate(trip.conditionsRecordedAt)}</p>}
    {trip.notes && <p className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-2 text-xs">{trip.notes}</p>}
    <TripMediaGallery images={trip.images} />
    {trip.fishRecords.map((fish) => <div key={fish.id} className="break-words border-t border-slate-100 pt-2"><p className="text-xs font-bold">{fish.count}x {fish.species} · {fishMetrics(fish)}</p>{fish.notes && <p className="ui-help whitespace-pre-wrap">{fish.notes}</p>}<TripMediaGallery images={fish.images} /></div>)}
  </>;
}

function TripEditor({ user, subject, trip, destination, activeTrip, onUpdated, onSaved, onClose, onRecheck }: {
  user: ApiUser; subject: string; trip?: SavedFishingTrip; destination?: TripDestination; activeTrip: SavedFishingTrip | null;
  onUpdated: (trip: SavedFishingTrip) => void; onSaved: (trip: SavedFishingTrip) => void; onClose: () => void; onRecheck: (point: TripDestination) => void;
}) {
  const draft = usePersistentDraft(user.id, subject, () => initialDraft(trip, destination));
  const value = draft.value;
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const completing = trip?.status === "active" && value.completing;
  const [pendingAction, setPendingAction] = useState<"save" | "complete">();
  const [publishing, setPublishing] = useState(false);
  const [precision, setPrecision] = useState<PublicLocationPrecision>("approximate");
  const [shareNotes, setShareNotes] = useState(false);
  const [sharedMediaIds, setSharedMediaIds] = useState<string[]>([]);
  const [shareConfirmed, setShareConfirmed] = useState(false);
  const point = value.destination ?? destination;
  const finished = trip?.status === "completed" || (!trip && value.recordingMode === "historical") || completing;
  const hasPendingFish = Object.entries(EMPTY_FISH).some(([field, defaultValue]) => value.fish[field as keyof FishDraft] !== defaultValue) || Boolean(value.fish.id);
  const images = trip ? [...trip.images, ...trip.fishRecords.flatMap((fish) => fish.images)] : [];
  const change = (fields: Partial<TripDraft>) => { draft.change((previous) => ({ ...previous, ...fields })); setMessage(undefined); };
  const setCompleting = (next: boolean) => change({ completing: next });
  const changeFish = (fields: Partial<FishDraft>) => change({ fish: { ...value.fish, ...fields } });

  function addFish(): TripFishRecord[] | undefined {
    try {
      const fish = value.fish;
      if (!fish.species.trim()) throw new Error("Γράψε είδος ψαριού.");
      const count = Number(fish.count);
      if (!Number.isInteger(count) || count < 1 || count > 999) throw new Error("Το πλήθος πρέπει να είναι ακέραιος από 1 έως 999.");
      const weightKg = positiveNumber(fish.weightKg, "βάρος") ?? undefined;
      const lengthCm = positiveNumber(fish.lengthCm, "μήκος") ?? undefined;
      if (count > 1 && ((weightKg !== undefined && !fish.weightBasis) || (lengthCm !== undefined && !fish.lengthBasis))) throw new Error("Για ομάδα ψαριών, δήλωσε ρητά τη βάση κάθε μέτρησης ή επίλεξε άγνωστη.");
      const existing = value.fishRecords.find((record) => record.id === fish.id);
      const record: TripFishRecord = { id: existing?.id ?? crypto.randomUUID(), species: fish.species.trim(), count, weightKg, lengthCm,
        weightBasis: fish.weightBasis || (count === 1 ? "individual" : "unknown"), lengthBasis: fish.lengthBasis || (count === 1 ? "individual" : "unknown"),
        bait: fish.bait.trim(), notes: fish.notes.trim(), released: fish.released, images: existing?.images ?? [] };
      const records = existing ? value.fishRecords.map((item) => item.id === record.id ? record : item) : [...value.fishRecords, record];
      change({ fishRecords: records, fish: { ...EMPTY_FISH }, outcome: "recorded" }); setError(undefined);
      return records;
    } catch (error) { setError(error instanceof Error ? error.message : "Έλεγξε τα στοιχεία ψαριού."); return undefined; }
  }

  function requestSave(action: "save" | "complete") {
    setError(undefined);
    if (hasPendingFish) { setPendingAction(action); return; }
    if (action === "complete") beginCompletion(); else void save(value.fishRecords);
  }
  function beginCompletion() {
    setCompleting(true);
    if (!value.endedAt) change({ endedAt: localDateTime(new Date().toISOString(), true) });
    setMessage("Έλεγξε την πραγματική λήξη και δήλωσε το αποτέλεσμα πριν επιβεβαιώσεις.");
  }
  function resolvePending(add: boolean) {
    const records = add ? addFish() : value.fishRecords;
    if (!records) return;
    if (!add) change({ fish: { ...EMPTY_FISH } });
    const action = pendingAction; setPendingAction(undefined);
    if (action === "complete") {
      setCompleting(true);
      draft.change((previous) => ({ ...previous, endedAt: previous.endedAt || localDateTime(new Date().toISOString(), true) }));
    } else void save(records, add ? "recorded" : value.outcome);
  }

  async function save(records: TripFishRecord[], outcomeOverride = value.outcome) {
    setError(undefined); setMessage(undefined);
    try {
      const { fields, deferredEffort } = tripUpdateFromDraft(value, trip, records, outcomeOverride);
      const start = new Date(fields.tripDate!);
      if (deferredEffort && !writeDraft(user.id, subject, value)) throw new Error("Ο browser δεν μπορεί να διατηρήσει την εκκρεμή προσπάθεια. Αποκατάστησε την τοπική αποθήκευση ή αφαίρεσέ την ρητά πριν αποθηκεύσεις.");
      setBusy(true);
      let saved: SavedFishingTrip;
      if (trip) saved = await updateTrip(trip.id, fields);
      else {
        if (!point) throw new Error("Διάλεξε τοποθεσία.");
        if (value.recordingMode === "live" && activeTrip) throw new Error("Ολοκλήρωσε πρώτα την ενεργή εξόρμηση ή διάλεξε ιστορική καταχώριση.");
        // A forecast or an old scan must never become the observed weather of a trip.
        const snapshotTime = point.conditionsAt ? new Date(point.conditionsAt).getTime() : NaN;
        const spot = value.recordingMode === "live" && Math.abs(snapshotTime - start.getTime()) < 3_600_000 && snapshotTime <= Date.now() ? point.spot : undefined;
        const input: CreateTripInput = {
          ...fields, tripDate: start.toISOString(), endedAt: fields.endedAt ?? null, outcome: fields.outcome!,
          fishingMinutes: fields.fishingMinutes ?? null, anglerCount: fields.anglerCount ?? null,
          conditionsRecordedAt: fields.conditionsRecordedAt ?? (spot ? point.conditionsAt ?? null : null),
          recordingMode: value.recordingMode, visibility: "private", publicLocationPrecision: "approximate", shareNotes: false, sharedMediaIds: [],
          technique: point.technique, techniqueLabel: TECHNIQUE_PROFILES[point.technique].label, locationName: point.name, lat: point.lat, lon: point.lon,
          fishRecords: fields.fishRecords ?? [], spotId: spot?.id, score: spot?.score,
          conditionsLabel: spot?.conditionsLabel ?? "Χωρίς παρατηρημένο στιγμιότυπο συνθηκών.", depthLabel: spot?.techniqueDepthRange.label, seabedLabel: spot?.seabedLabel,
          weather: spot?.weather, marine: spot?.marine,
        };
        saved = await createTrip(input);
      }
      const nextDraft = draftAfterSave(saved, value, deferredEffort);
      draft.reset(nextDraft);
      const retained = !deferredEffort || writeDraft(user.id, saved.id, nextDraft);
      onUpdated(saved); onSaved(saved);
      if (!retained) window.alert(`Η εξόρμηση αποθηκεύτηκε, αλλά απέτυχε η τοπική διατήρηση προσπάθειας: ${value.fishingMinutes || "άγνωστα"} λεπτά, ${value.anglerCount || "άγνωστοι"} ψαράδες. Συμπλήρωσέ την ξανά μετά την πραγματική λήξη.`);
      setMessage(deferredEffort ? "Η εξόρμηση αποθηκεύτηκε. Η προσπάθεια διατηρείται στη συσκευή μέχρι να δηλώσεις πραγματική λήξη." : "Η εξόρμηση αποθηκεύτηκε.");
    } catch (error) { setError(error instanceof Error ? error.message : "Η αποθήκευση απέτυχε. Οι αλλαγές διατηρήθηκαν στη συσκευή."); }
    finally { setBusy(false); }
  }

  async function media(files: File[], fishId?: string, removeId?: string) {
    if (!trip) return;
    setBusy(true); setError(undefined);
    try {
      if (removeId) onUpdated(await deleteTripImage(trip.id, removeId));
      else for (const file of files) onUpdated(await uploadTripImage(trip.id, file, fishId));
      setMessage("Η εικόνα αποθηκεύτηκε. Οι υπόλοιπες αλλαγές χρειάζονται αποθήκευση.");
    } catch (error) { setError(error instanceof Error ? error.message : "Η εικόνα δεν αποθηκεύτηκε. Ήδη επιτυχημένα uploads διατηρούνται."); }
    finally { setBusy(false); }
  }

  async function publish(makePrivate = false) {
    if (!trip || trip.status !== "completed") return;
    setBusy(true); setError(undefined);
    try {
      const saved = await updateTrip(trip.id, makePrivate ? { visibility: "private" } : { visibility: "public", publicLocationPrecision: precision, shareNotes, sharedMediaIds });
      onUpdated(saved); setPublishing(false); setMessage(makePrivate ? "Μόνο εγώ. Τυχόν εξωτερικά αντίγραφα δεν ανακαλούνται." : "Κοινοποιήθηκαν τα αποθηκευμένα στοιχεία με τις επιλογές σου.");
    } catch (error) { setError(error instanceof Error ? error.message : "Η αλλαγή κοινοποίησης απέτυχε."); }
    finally { setBusy(false); }
  }

  return <div className="mt-4 space-y-3">
    <div className="ui-notice"><h3 className="font-black">{trip ? "Επεξεργασία" : "Νέα εξόρμηση"}: {trip?.locationName ?? point?.name}</h3><p>{trip?.lat ?? point?.lat}, {trip?.lon ?? point?.lon}</p></div>
    {trip?.visibility === "public" && <p className="ui-warning">Οι αλλαγές που αποθηκεύεις κοινοποιούνται με τις τρέχουσες επιλογές. Επίλεξε «Μόνο εγώ» πριν προσθέσεις ευαίσθητα στοιχεία. Νέες εικόνες δεν κοινοποιούνται αυτόματα.</p>}
    {draft.storageError && <p role="alert" className="ui-warning">Δεν είναι δυνατή η αυτόματη ανάκτηση αλλαγών. Μην κλείσεις ή ανανεώσεις τη σελίδα πριν αποθηκεύσεις στον server.</p>}
    {error && <p role="alert" className="ui-error">{error}</p>}{message && <p role="status" className="ui-notice">{message}</p>}
    <fieldset disabled={busy} className="min-w-0 space-y-3">
      {!trip && <label className="ui-label">Τρόπος καταγραφής<select className="ui-input" value={value.recordingMode} onChange={(event) => change({ recordingMode: event.target.value as RecordingMode })}><option value="live">Ζωντανή</option><option value="historical">Ιστορική, ολοκληρωμένη</option></select></label>}
      {!trip && point && <button type="button" className="ui-secondary" onClick={() => onRecheck(point)}>Έλεγξε ξανά τις συνθήκες τώρα</button>}
      <label className="ui-label">Πραγματική έναρξη<input type="datetime-local" step="1" className="ui-input" max={localDateTime(new Date().toISOString(), true)} value={value.tripDate} onChange={(e) => change({ tripDate: e.target.value })} /></label>
      {finished && <label className="ui-label">Πραγματική λήξη, όχι ώρα καταχώρισης<input type="datetime-local" step="1" className="ui-input" max={localDateTime(new Date().toISOString(), true)} min={value.tripDate} value={value.endedAt} onChange={(e) => change({ endedAt: e.target.value })} /></label>}
      {trip?.status === "completed" && !trip.endedAt && <p className="ui-notice">Παλιότερη ολοκληρωμένη καταγραφή χωρίς γνωστή πραγματική λήξη. Μπορείς να διορθώσεις στοιχεία και ψάρια χωρίς να επινοήσεις ώρα. Συμπλήρωσε λήξη μόνο αν είναι γνωστή, για να αποθηκεύσεις προσπάθεια.</p>}
      <label className="ui-label">Αποτέλεσμα<select className="ui-input" value={value.outcome} onChange={(e) => change({ outcome: e.target.value as TripOutcome | "" })}><option value="">Επίλεξε ρητά</option><option value="not-recorded">Δεν καταγράφηκε αποτέλεσμα</option><option value="zero">Ψάρεψα, έπιασα 0 ψάρια</option><option value="recorded">Καταγεγραμμένη αλίευση</option></select></label>
      {value.outcome === "zero" && <div className="ui-notice space-y-2">
        <p>Για προσθήκη ή διόρθωση ψαριού, επίλεξε «Καταγεγραμμένη αλίευση».</p>
        {value.fishRecords.length > 0 && <p role="alert" className="ui-error">Υπάρχουν ψάρια. Επίλεξε καταγεγραμμένη αλίευση ή αφαίρεσέ τα ρητά πριν αποθηκεύσεις. Οι εγγραφές δεν διαγράφηκαν.</p>}
        {hasPendingFish && <p>Τα μη προστιθέμενα στοιχεία ψαριού διατηρούνται. Άλλαξε αποτέλεσμα για να συνεχίσεις την επεξεργασία τους.</p>}
      </div>}
      <div className="grid grid-cols-2 gap-2"><label className="ui-label">Λεπτά πραγματικού ψαρέματος<input type="number" min="1" step="1" placeholder="Άγνωστα" className="ui-input" value={value.fishingMinutes} onChange={(e) => change({ fishingMinutes: e.target.value })} /></label><label className="ui-label">Αριθμός ψαράδων<input type="number" min="1" max="100" step="1" placeholder="Άγνωστος" className="ui-input" value={value.anglerCount} onChange={(e) => change({ anglerCount: e.target.value })} /></label></div>
      <p className="ui-help">Προαιρετική προσπάθεια. Δεν συμπεραίνεται από τη διάρκεια της εξόρμησης ούτε θεωρείται αυτόματα ένας ψαράς.</p>
      {(!finished || !value.endedAt) && <p className="ui-help">Τα λεπτά και οι ψαράδες διατηρούνται μόνο στη συσκευή μέχρι να δηλώσεις πραγματική λήξη. Κενό σημαίνει άγνωστο, όχι μηδέν.</p>}
      <label className="ui-label">Ώρα καταγραφής συνθηκών, αν είναι γνωστή<input type="datetime-local" step="1" max={localDateTime(new Date().toISOString(), true)} className="ui-input" value={value.conditionsRecordedAt} onChange={(e) => change({ conditionsRecordedAt: e.target.value })} /></label>
      <section aria-label="Πηγή και χρόνος συνθηκών" className="space-y-2">
        <h4 className="ui-eyebrow">Πηγή και χρόνος συνθηκών</h4>
        <p className="ui-help">{trip ? "Αποθηκευμένο στιγμιότυπο, όχι τρέχουσες συνθήκες." : "Στοιχεία επιλεγμένου σημείου, όχι επιτόπια παρατήρηση. Παλιές συνθήκες και προγνώσεις δεν αποθηκεύονται ως παρατήρηση."}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(["weather", "marine"] as const).map((kind) => {
            const snapshot = trip ? trip[kind] : point?.spot?.[kind];
            const metadata = snapshot?.sourceSnapshot ?? snapshot;
            const label = kind === "weather" ? "Καιρός" : "Θάλασσα";
            return <article key={kind} aria-label={label} className="min-w-0 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <h5 className="flex items-center gap-2 text-sm font-black"><svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0 text-tide" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={kind === "weather" ? "Ήλιος και σύννεφο" : "Θαλάσσια κύματα"}>
                {kind === "weather" ? <><circle cx="8" cy="8" r="3" /><path d="M8 1v2M1 8h2M3 3l1.5 1.5M13 3l-1.5 1.5M16 19H7a4 4 0 1 1 1-7.9A5 5 0 1 1 16 19Z" /></> : <path d="M2 6q2-3 5 0t5 0t5 0t5 0M2 12q2-3 5 0t5 0t5 0t5 0M2 18q2-3 5 0t5 0t5 0t5 0" />}
              </svg>{label}</h5>
              {snapshot?.sourceSnapshot && <p className="ui-help">Αρχική πηγή χωρίς χρονική αντιστοίχιση. Οι συνθήκες εξόρμησης είναι άγνωστες.</p>}
              <dl className="ui-help space-y-2 break-words">
                <div><dt className="font-bold">Συντεταγμένες πηγής</dt><dd>{metadata?.sourceCoordinates ? `${metadata.sourceCoordinates.lat.toFixed(3)}, ${metadata.sourceCoordinates.lon.toFixed(3)}` : "Μη διαθέσιμες"}</dd></div>
                <div><dt className="font-bold">Ισχύει</dt><dd>{displayDate(metadata?.validAt)}</dd></div>
                <div><dt className="font-bold">Λήψη</dt><dd>{displayDate(metadata?.fetchedAt)}</dd></div>
                <div><dt className="font-bold">Χρονική κάλυψη</dt><dd>{metadata?.temporalMode === "forecast" ? "Πρόγνωση, όχι παρατήρηση" : metadata?.temporalMode === "current" ? "Τρέχον μοντέλο, όχι επιτόπια μέτρηση" : metadata?.temporalMode === "historical" ? "Ιστορικά δεδομένα" : metadata?.temporalMode ?? "Άγνωστη"}</dd></div>
              </dl>
            </article>;
          })}
        </div>
      </section>
      <label className="ui-label">Σημειώσεις εξόρμησης<textarea rows={4} className="ui-input" value={value.notes} onChange={(e) => change({ notes: e.target.value })} /></label>
      {value.outcome !== "zero" && <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3"><h4 className="font-black">{value.fish.id ? "Διόρθωση ψαριού, ίδιο ID και εικόνες" : "Προσθήκη ψαριού / ομοιογενούς ομάδας"}</h4>
        <label className="ui-label">Είδος<input className="ui-input" value={value.fish.species} onChange={(e) => changeFish({ species: e.target.value })} /></label>
        <label className="ui-label">Πλήθος<input className="ui-input" type="number" min="1" step="1" value={value.fish.count} onChange={(e) => changeFish({ count: e.target.value, ...(Number(e.target.value) > 1 && Number(value.fish.count) <= 1 ? { weightBasis: "", lengthBasis: "" } : {}) })} /></label>
        <div className="grid grid-cols-2 gap-2"><label className="ui-label">Βάρος kg<input className="ui-input" type="number" min="0.001" step="any" value={value.fish.weightKg} onChange={(e) => changeFish({ weightKg: e.target.value })} /></label><label className="ui-label">Βάση βάρους<select className="ui-input" value={value.fish.weightBasis} onChange={(e) => changeFish({ weightBasis: e.target.value as FishDraft["weightBasis"] })}><option value="">Επίλεξε βάση</option><option value="individual">Ένα άτομο</option><option value="total">Συνολικό ομάδας</option><option value="average">Μέσο ανά άτομο</option><option value="unknown">Άγνωστη βάση</option></select></label></div>
        <div className="grid grid-cols-2 gap-2"><label className="ui-label">Μήκος cm<input className="ui-input" type="number" min="0.1" step="any" value={value.fish.lengthCm} onChange={(e) => changeFish({ lengthCm: e.target.value })} /></label><label className="ui-label">Βάση μήκους<select className="ui-input" value={value.fish.lengthBasis} onChange={(e) => changeFish({ lengthBasis: e.target.value as FishDraft["lengthBasis"] })}><option value="">Επίλεξε βάση</option><option value="individual">Ένα άτομο</option><option value="average">Μέσο ανά άτομο</option><option value="unknown">Άγνωστη βάση</option></select></label></div>
        <label className="ui-label">Δόλωμα<input className="ui-input" value={value.fish.bait} onChange={(e) => changeFish({ bait: e.target.value })} /></label>
        <label className="ui-check"><input type="checkbox" checked={value.fish.released} onChange={(e) => changeFish({ released: e.target.checked })} />Όλα απελευθερώθηκαν (C&amp;R)</label><p className="ui-help">Κάθε ομάδα έχει ίδιο είδος και ίδια κατάσταση απελευθέρωσης. Χώρισε κρατημένα και απελευθερωμένα σε διαφορετικές εγγραφές.</p>
        <label className="ui-label">Σημειώσεις ψαριού<input className="ui-input" value={value.fish.notes} onChange={(e) => changeFish({ notes: e.target.value })} /></label>
        <button type="button" className="ui-primary w-full" onClick={() => addFish()}>{value.fish.id ? "Ενημέρωση ψαριού" : "Προσθήκη ψαριού"}</button>
        {hasPendingFish && <button className="ui-secondary w-full" onClick={() => { if (window.confirm("Απόρριψη μόνο των στοιχείων ψαριού που γράφεις τώρα;")) change({ fish: { ...EMPTY_FISH } }); }}>Απόρριψη φόρμας ψαριού</button>}
      </div>}
      {value.fishRecords.map((fish) => {
        const persisted = trip?.fishRecords.find((record) => record.id === fish.id);
        return <article key={fish.id} className="space-y-2 rounded-2xl border border-kelp/20 p-3"><h4 className="text-sm font-black">{fish.count}x {fish.species}</h4><p className="ui-help">{fishMetrics(fish)}</p>{fish.notes && <p className="ui-help">{fish.notes}</p>}
          <div className="flex flex-wrap gap-2"><button className="ui-secondary" onClick={() => {
            if (hasPendingFish && !window.confirm("Απόρριψη της εκκρεμούς φόρμας για επεξεργασία άλλου ψαριού;")) return;
            change({ outcome: "recorded" });
            change({ fish: { id: fish.id, species: fish.species, count: String(fish.count), weightKg: fish.weightKg?.toString() ?? "", lengthCm: fish.lengthCm?.toString() ?? "", weightBasis: fish.weightBasis ?? "unknown", lengthBasis: fish.lengthBasis ?? "unknown", bait: fish.bait ?? "", notes: fish.notes ?? "", released: fish.released } });
          }}>Επεξεργασία</button><button className="ui-secondary" onClick={() => {
            if (!window.confirm("Αφαίρεση ψαριού; Οι εικόνες του θα αφαιρεθούν όταν αποθηκεύσεις.")) return;
            const records = value.fishRecords.filter((record) => record.id !== fish.id);
            change({ fishRecords: records, outcome: records.length ? value.outcome : "", ...(value.fish.id === fish.id ? { fish: { ...EMPTY_FISH } } : {}) });
          }}>Αφαίρεση</button></div>
          {persisted ? <><TripMediaGallery images={persisted.images} busy={busy} onRemove={(id) => void media([], undefined, id)} /><UploadInput label={`Εικόνες ψαριού (${persisted.images.length}/5)`} disabled={persisted.images.length >= 5} onFiles={(files) => void media(files, fish.id)} /></> : <p className="ui-help">Αποθήκευσε πρώτα την εγγραφή για να προσθέσεις εικόνες.</p>}
        </article>;
      })}
      {trip && <div className="rounded-2xl border border-slate-200 p-3"><h4 className="text-sm font-black">Εικόνες εξόρμησης ({trip.images.length}/20)</h4><TripMediaGallery images={trip.images} busy={busy} onRemove={(id) => void media([], undefined, id)} /><UploadInput label="Πρόσθεσε εικόνες εξόρμησης" disabled={trip.images.length >= 20} onFiles={(files) => void media(files)} /><p className="ui-help mt-2">Οι εικόνες αποθηκεύονται αμέσως. Κοινοποιούνται μόνο αν τις επιλέξεις.</p></div>}
      {pendingAction && <div role="alert" className="ui-warning space-y-2"><p>Υπάρχουν μη προστιθέμενα στοιχεία ψαριού. Τι θέλεις να γίνει πριν συνεχίσεις;</p><div className="flex flex-wrap gap-2"><button className="ui-secondary" onClick={() => resolvePending(true)}>Προσθήκη / ενημέρωση και συνέχεια</button><button className="ui-secondary" onClick={() => resolvePending(false)}>Απόρριψη και συνέχεια</button><button className="ui-secondary" onClick={() => setPendingAction(undefined)}>Συνέχεια επεξεργασίας</button></div></div>}
      <div className="grid gap-2"><button className="ui-primary" disabled={!trip && value.recordingMode === "live" && Boolean(activeTrip)} onClick={() => requestSave("save")}>{busy ? "Αποθήκευση..." : completing ? "Επιβεβαίωση ολοκλήρωσης" : trip ? "Αποθήκευση εξόρμησης" : value.recordingMode === "historical" ? "Αποθήκευση ολοκληρωμένης εξόρμησης" : "Έναρξη εξόρμησης"}</button>
        {trip?.status === "active" && !completing && <button className="ui-secondary" onClick={() => requestSave("complete")}>Ολοκλήρωση εξόρμησης</button>}
        {completing && <button className="ui-secondary" onClick={() => setCompleting(false)}>Συνέχεια ενεργής εξόρμησης</button>}
        <button className="ui-secondary" onClick={onClose}>Κλείσιμο</button>
      </div>
      {trip?.status === "completed" && <div className="space-y-3 border-t border-slate-200 pt-4"><h4 className="font-black">{trip.visibility === "public" ? "Κοινοποιημένη" : "Μόνο εγώ"}</h4>
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
      </div>}
    </fieldset>
  </div>;
}

function UploadInput({ label, disabled, onFiles }: { label: string; disabled: boolean; onFiles: (files: File[]) => void }) {
  return <label className="ui-label mt-3">{label}<input className="ui-input text-xs" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled} onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} /></label>;
}

function fishMetrics(fish: TripFishRecord): string {
  const basis = { individual: "ενός ατόμου", total: "σύνολο ομάδας", average: "μέσο ανά άτομο", unknown: "άγνωστη βάση" };
  return [fish.weightKg !== undefined ? `${fish.weightKg}kg (${basis[fish.weightBasis ?? "unknown"]})` : null, fish.lengthCm !== undefined ? `${fish.lengthCm}cm (${basis[fish.lengthBasis ?? "unknown"]})` : null, fish.bait, fish.released ? "όλα απελευθερώθηκαν" : "όλα κρατήθηκαν"].filter(Boolean).join(" · ");
}
