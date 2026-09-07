"use client";

import { FormEvent, useEffect, useEffectEvent, useRef, useState } from "react";
import { FishingMap, type MapBaseLayer } from "./FishingMap";
import { UserConnectPanel } from "./UserConnectPanel";
import { PrivateLibrary } from "./PrivateLibrary";
import { TripJournal } from "./TripJournal";
import { recommendationLabel, ResultNotices, SpeciesProfile, SpotAnalysis, SpotWarnings } from "./SpotAnalysis";
import type { Coordinates, RankedSpot, SavedFishingTrip, SavedScan, SpotsApiRequest, SpotsApiResponse, SpotSearchMode, TechniqueId, TripDestination } from "@/lib/types";
import { TECHNIQUE_PROFILES } from "@/lib/techniqueProfiles";
import { fetchActiveTrip, fetchTrip, fetchTrips, searchSpots, SESSION_ENDED_EVENT, verifiedUserId, type SessionEndDetail } from "@/lib/client/api";
import { useSession } from "@/lib/client/useSession";
import { localDateTime, readContinuation, writeContinuation, type BrowserContinuation } from "@/lib/client/drafts";
import { scanRecheckRequest } from "@/lib/client/scanRequest";
import { resolveSelectedTrip } from "@/lib/client/tripDraft";

export function SearchExperience() {
  const session = useSession();
  const [technique, setTechnique] = useState<TechniqueId>("surfcasting");
  const [location, setLocation] = useState("Γύθειο");
  const [resultLimit, setResultLimit] = useState(24);
  const [radiusKm, setRadiusKm] = useState(25);
  const [targetSpecies, setTargetSpecies] = useState("");
  const [fishingAt, setFishingAt] = useState("");
  const [saveHistory, setSaveHistory] = useState(false);
  const [baseLayer, setBaseLayer] = useState<MapBaseLayer>("satellite");
  const [depthVisible, setDepthVisible] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [recenterKey, setRecenterKey] = useState(0);
  const [sheetSize, setSheetSize] = useState<"collapsed" | "half" | "expanded">("half");
  const [pickedPoint, setPickedPoint] = useState<Coordinates>();
  const [gpsAccuracyM, setGpsAccuracyM] = useState<number>();
  const [response, setResponse] = useState<SpotsApiResponse>();
  const [snapshot, setSnapshot] = useState(false);
  const [selectedSpotId, setSelectedSpotId] = useState<string>();
  const [infoOpen, setInfoOpen] = useState(false);
  const [panel, setPanel] = useState<"search" | "trips" | "library">("search");
  const [panelOpen, setPanelOpen] = useState(true);
  const [authOpen, setAuthOpen] = useState(false);
  const [trips, setTrips] = useState<SavedFishingTrip[]>([]);
  const [activeTrip, setActiveTrip] = useState<SavedFishingTrip | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string>();
  const [tripFocus, setTripFocus] = useState<{ id: string; lat: number; lon: number; revision: number }>();
  const [destination, setDestination] = useState<TripDestination>();
  const [libraryDestination, setLibraryDestination] = useState<TripDestination>();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [tripsError, setTripsError] = useState<string>();
  const [tripRevision, setTripRevision] = useState(0);
  const searchSequence = useRef(0);
  const guestIntent = useRef(false);
  const [resumedAccount, setResumedAccount] = useState<string>();
  const continuation: BrowserContinuation = { panel, panelOpen, destination, libraryDestination, selectedTripId, pickedPoint, gpsAccuracyM, technique, location, targetSpecies, fishingAt, radiusKm, resultLimit };
  const selectedSpot = response?.spots.find((spot) => spot.id === selectedSpotId) ?? response?.spots[0];

  useEffect(() => {
    let cancelled = false;
    setTrips([]); setActiveTrip(null); setTripsError(undefined);
    if (session.restoring) return;
    setTripsLoading(true);
    void Promise.allSettled([fetchTrips(session.user ? "visible" : "public"), session.user ? fetchActiveTrip() : Promise.resolve(null)]).then(([visible, current]) => {
      if (cancelled || (session.user && verifiedUserId() !== session.user.id)) return;
      if (visible.status === "fulfilled") setTrips(visible.value);
      if (current.status === "fulfilled") setActiveTrip(current.value);
      if (visible.status === "rejected" || current.status === "rejected") setTripsError("Δεν φορτώθηκαν όλα τα στοιχεία εξορμήσεων. Δοκίμασε ανανέωση πριν ξεκινήσεις νέα ζωντανή καταγραφή.");
      setTripsLoading(false);
    });
    return () => { cancelled = true; };
  }, [session.restoring, session.user?.id, tripRevision]);

  const sessionEnded = useEffectEvent((event: Event) => {
    const reason = (event as CustomEvent<SessionEndDetail>).detail?.reason;
    if (reason === "expired" && session.user) writeContinuation(session.user.id, continuation);
    searchSequence.current += 1; setLoading(false); setTripsLoading(false); setTrips([]); setActiveTrip(null); setSelectedTripId(undefined); setResumedAccount(undefined);
    setSaveHistory(false); setError(undefined); setMessage(undefined);
    setTripFocus(undefined);
    // Lock private origins as well as forms. A genuinely new guest choice can cross login.
    if (session.user || !guestIntent.current) {
      setResponse(undefined); setInfoOpen(false); setSnapshot(false); setSelectedSpotId(undefined);
      setDestination(undefined); setLibraryDestination(undefined); setPickedPoint(undefined); setGpsAccuracyM(undefined);
      setLocation("Γύθειο"); setTargetSpecies(""); setFishingAt(""); setPanelOpen(false); guestIntent.current = false;
    }
    if (reason === "expired") setAuthOpen(true);
  });
  useEffect(() => {
    const ended = (event: Event) => sessionEnded(event);
    window.addEventListener(SESSION_ENDED_EVENT, ended);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, ended);
  }, []);

  useEffect(() => {
    if (!session.user) { setResumedAccount(undefined); return; }
    const saved = readContinuation(session.user.id, guestIntent.current);
    if (saved) {
      setPanel(saved.panel); setPanelOpen(saved.panelOpen); setDestination(saved.destination); setLibraryDestination(saved.libraryDestination);
      setSelectedTripId(saved.selectedTripId); setPickedPoint(saved.pickedPoint); setGpsAccuracyM(saved.gpsAccuracyM);
      setTechnique(saved.technique); setLocation(saved.location); setTargetSpecies(saved.targetSpecies); setFishingAt(saved.fishingAt);
      setRadiusKm(saved.radiusKm); setResultLimit(saved.resultLimit); setInfoOpen(false);
    }
    guestIntent.current = false; setResumedAccount(session.user.id);
  }, [session.user?.id]);

  useEffect(() => {
    if (session.user && resumedAccount === session.user.id) writeContinuation(session.user.id, continuation);
  }, [session.user?.id, resumedAccount, panel, panelOpen, destination, libraryDestination, selectedTripId, pickedPoint, gpsAccuracyM, technique, location, targetSpecies, fishingAt, radiusKm, resultLimit]);

  useEffect(() => {
    let cancelled = false;
    if (!session.user || !selectedTripId || tripsLoading || resolveSelectedTrip(selectedTripId, trips, activeTrip)) return;
    void fetchTrip(selectedTripId).then((trip) => { if (!cancelled && verifiedUserId() === session.user?.id) setTrips((items) => [trip, ...items.filter((item) => item.id !== trip.id)]); })
      .catch((error) => { if (!cancelled) { setError(error instanceof Error ? error.message : "Η εξόρμηση δεν φορτώθηκε."); setSelectedTripId(undefined); setDestination(undefined); } });
    return () => { cancelled = true; };
  }, [session.user?.id, selectedTripId, tripsLoading, activeTrip, tripRevision]);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "/" && event.target instanceof HTMLElement && !event.target.matches("input, textarea, select, [contenteditable=true]")) {
        event.preventDefault(); openPanel("search"); window.setTimeout(() => document.getElementById("spot-location")?.focus(), 0);
      }
    };
    window.addEventListener("keydown", keyDown); return () => window.removeEventListener("keydown", keyDown);
  }, []);

  function openPanel(next: typeof panel) { setPanel(next); setPanelOpen(true); setInfoOpen(false); setAuthOpen(false); }
  function currentDestination(spot?: RankedSpot): TripDestination | undefined {
    if (spot && response) {
      const point = response.mode === "point" ? response.pointAnalysis?.requestedPoint ?? spot : spot;
      return { lat: point.lat, lon: point.lon, name: spot.name, technique: response.intent.technique, ...(!snapshot ? { spot, conditionsAt: response.conditionsAt ?? spot.weather.validAt ?? spot.marine.validAt } : {}) };
    }
    return pickedPoint ? { ...pickedPoint, name: location || pointLabel(pickedPoint), technique } : undefined;
  }
  function newTrip(point?: TripDestination) {
    if (session.user && verifiedUserId() !== session.user.id) return;
    if (!session.user) guestIntent.current = true;
    if (point) setDestination(point);
    setSelectedTripId(undefined); openPanel("trips");
  }
  function saveCurrentPlace(point?: TripDestination) { if (!session.user) guestIntent.current = true; setLibraryDestination(point); openPanel("library"); }
  function selectTrip(id?: string) { if (session.user && verifiedUserId() !== session.user.id) return; if (!session.user) guestIntent.current = true; setDestination(undefined); setSelectedTripId(id); openPanel("trips"); }
  function updatedTrip(trip: SavedFishingTrip) {
    if (!session.user || verifiedUserId() !== session.user.id) return;
    setTrips((items) => [trip, ...items.filter((item) => item.id !== trip.id)]);
    setActiveTrip((current) => trip.status === "active" ? trip : current?.id === trip.id ? null : current);
  }

  function showTripOnMap(trip: SavedFishingTrip) {
    if (session.user && verifiedUserId() !== session.user.id) return;
    selectTrip(trip.id);
    searchSequence.current += 1; setLoading(false);
    setPanelOpen(false); setInfoOpen(false); setSheetSize("collapsed"); setLayersOpen(false);
    setTripFocus((previous) => ({ id: trip.id, lat: trip.lat, lon: trip.lon, revision: (previous?.revision ?? 0) + 1 }));
  }

  async function runSearch(mode: SpotSearchMode = "nearby", supplied?: SpotsApiRequest) {
    const sequence = ++searchSequence.current;
    setError(undefined); setMessage(undefined);
    try {
      let iso: string | undefined;
      if (!supplied && fishingAt) {
        const date = new Date(fishingAt);
        if (Number.isNaN(date.getTime()) || date.getTime() < Date.now() || date.getTime() > Date.now() + 7 * 86_400_000) throw new Error("Επίλεξε ώρα από τώρα έως τις επόμενες 7 ημέρες ή άφησε το πεδίο κενό για τώρα.");
        iso = date.toISOString();
      }
      const request: SpotsApiRequest = supplied ?? { technique, location: location.trim(), targetSpecies: targetSpecies.trim() || undefined, fishingAt: iso, mode,
        coordinates: pickedPoint, locationLabel: pickedPoint ? location : undefined, gpsAccuracyM: pickedPoint ? gpsAccuracyM : undefined,
        resultLimit, radiusKm, saveHistory: Boolean(session.user && saveHistory) };
      if (!request.location && !request.coordinates) throw new Error("Γράψε περιοχή ή διάλεξε σημείο.");
      if (!Number.isFinite(request.radiusKm) || request.radiusKm < 1 || request.radiusKm > 60) throw new Error("Η ακτίνα πρέπει να είναι από 1 έως 60χλμ.");
      if (request.mode === "point" && !request.coordinates) throw new Error("Επίλεξε στίγμα για ανάλυση σημείου.");
      setLoading(true); setResponse(undefined); setInfoOpen(false); setSnapshot(false);
      const result = await searchSpots({ ...request, saveHistory: Boolean(session.user && request.saveHistory) });
      if (sequence !== searchSequence.current) return;
      setResponse(result); setSelectedSpotId(result.spots[0]?.id); setInfoOpen(result.mode === "point" && result.spots.length > 0); setPanelOpen(false); setSheetSize("half");
      setMessage(`${result.cache.hit ? "Απάντηση από cache παρόχων" : "Νέα ανάλυση"}. ${result.spots.length} σημεία.${request.saveHistory && session.user ? result.scanId ? " Αποθηκεύτηκε στο ιδιωτικό ιστορικό." : " Η αποθήκευση ιστορικού δεν επιβεβαιώθηκε." : " Δεν ζητήθηκε αποθήκευση ιστορικού."}`);
    } catch (error) { if (sequence === searchSequence.current) setError(error instanceof Error ? error.message : "Η αναζήτηση απέτυχε."); }
    finally { if (sequence === searchSequence.current) setLoading(false); }
  }

  function loadRequest(request: SpotsApiRequest) {
    if (session.user && verifiedUserId() !== session.user.id) return;
    if (!session.user) guestIntent.current = true;
    setTechnique(request.technique); setLocation(request.locationLabel ?? request.location); setTargetSpecies(request.targetSpecies ?? ""); setFishingAt(""); setRadiusKm(request.radiusKm); setResultLimit(request.resultLimit);
    setPickedPoint(request.coordinates); setGpsAccuracyM(request.gpsAccuracyM); setSaveHistory(false); setInfoOpen(false); setPanelOpen(false);
    void runSearch(request.mode, { ...request, fishingAt: undefined, saveHistory: false });
  }
  function recheck(point: TripDestination) {
    loadRequest({ technique: point.technique, location: point.name, locationLabel: point.name, coordinates: { lat: point.lat, lon: point.lon }, mode: "point", radiusKm, resultLimit, saveHistory: false });
  }
  function showScan(scan: SavedScan) {
    if (!session.user || verifiedUserId() !== session.user.id) return;
    const request = scanRecheckRequest(scan);
    searchSequence.current += 1; setLoading(false); setResponse(scan.response); setSnapshot(true); setSelectedSpotId(scan.response.spots[0]?.id); setPanelOpen(false); setInfoOpen(scan.response.mode === "point" && scan.response.spots.length > 0);
    setPickedPoint(request.coordinates); setGpsAccuracyM(undefined); setLocation(request.locationLabel ?? request.location); setTechnique(request.technique); setTargetSpecies(request.targetSpecies ?? ""); setFishingAt(""); setSaveHistory(false); setRadiusKm(request.radiusKm); setResultLimit(request.resultLimit); setMessage("Προβολή ιστορικού στιγμιοτύπου. Οι επόμενοι έλεγχοι θα ζητήσουν νέες συνθήκες.");
  }
  function pickPoint(point: Coordinates, accuracy?: number, label = pointLabel(point)) {
    if (!session.user) guestIntent.current = true;
    searchSequence.current += 1; setLoading(false); setPickedPoint(point); setGpsAccuracyM(accuracy); setLocation(label); setResponse(undefined); setSnapshot(false); setSelectedSpotId(undefined); setMessage("Επιλέχθηκε σημείο. Διάλεξε ανάλυση εδώ ή κοντινά σημεία."); openPanel("search");
  }
  function editLocation(value: string) {
    if (!session.user) guestIntent.current = true;
    searchSequence.current += 1; setLoading(false); setLocation(value); setPickedPoint(undefined); setGpsAccuracyM(undefined); setResponse(undefined); setSelectedSpotId(undefined); setSnapshot(false); setMessage(undefined);
  }
  async function gps() {
    if (!navigator.geolocation) { setError("Ο browser δεν υποστηρίζει γεωεντοπισμό. Διάλεξε σημείο στον χάρτη."); return; }
    setGpsLoading(true); setError(undefined);
    const sequence = searchSequence.current;
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 }));
      if (sequence !== searchSequence.current) return;
      pickPoint({ lat: position.coords.latitude, lon: position.coords.longitude }, position.coords.accuracy, "Η θέση μου");
      setRecenterKey((key) => key + 1);
    } catch { setError("Δεν ήταν διαθέσιμη η θέση GPS. Έλεγξε την άδεια τοποθεσίας ή διάλεξε σημείο στον χάρτη."); }
    finally { setGpsLoading(false); }
  }

  return <main className="relative h-[100svh] w-full overflow-hidden bg-ink text-ink">
    <FishingMap key={session.user?.id ?? "guest"} userId={session.user?.id} selectedTripId={selectedTripId} tripFocus={tripFocus} location={response?.location} radiusKm={response?.intent.radiusKm ?? radiusKm} spots={response?.spots ?? []} selectedSpotId={selectedSpot?.id} onSelectSpot={(id) => { setSelectedSpotId(id); setInfoOpen(true); setSheetSize("half"); setPanelOpen(false); setAuthOpen(false); }} loading={loading || gpsLoading} baseLayer={baseLayer} depthVisible={depthVisible} recenterKey={recenterKey} onMeasureStart={() => { setPanelOpen(false); setSheetSize("collapsed"); setLayersOpen(false); }} pickedPoint={pickedPoint} mode={response?.mode} pointAnalysis={response?.pointAnalysis} trips={activeTrip && !trips.some((trip) => trip.id === activeTrip.id) ? [...trips, activeTrip] : trips} onSelectTrip={selectTrip} onPickPoint={pickPoint} />
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 p-3 sm:p-4"><nav aria-label="Κύρια πλοήγηση" className="workflow-toolbar pointer-events-auto mx-auto flex max-w-[1560px] items-center gap-2 pb-1">
      <button className="ui-secondary px-3 py-3 shadow-glow" onClick={() => { if (panelOpen && panel === "search") setPanelOpen(false); else openPanel("search"); }}>{panelOpen && panel === "search" ? "Κλείσιμο" : "Αναζήτηση"}</button>
      <button className="ui-secondary px-3 py-3 shadow-glow" onClick={() => openPanel("trips")}>Εξορμήσεις</button><button className="ui-secondary px-3 py-3 shadow-glow" onClick={() => openPanel("library")}>Βιβλιοθήκη</button>
      {activeTrip && session.user && <button className="ui-primary shadow-glow" onClick={() => selectTrip(activeTrip.id)}>Συνέχεια ενεργής</button>}
      <button className={`${session.user ? "ui-primary" : "ui-secondary"} max-w-[14rem] truncate py-3 shadow-glow`} disabled={session.restoring} onClick={() => { setAuthOpen(!authOpen); setInfoOpen(false); }}>{session.restoring ? "Επαλήθευση..." : session.user ? `@${session.user.username}` : "Σύνδεση"}</button>
    </nav></div>

    {(error || session.sessionError) && <div role="alert" className="search-alert ui-error absolute inset-x-3 top-[4.8rem] z-50 mx-auto max-w-xl"><div className="flex items-start justify-between gap-2"><p>{error || session.sessionError}</p><button className="ui-close" aria-label="Απόκρυψη μηνύματος" onClick={() => { setError(undefined); session.dismissError(); }}>x</button></div></div>}
    {authOpen && <UserConnectPanel activeUser={session.user} onConnected={(user) => { session.connect(user); setAuthOpen(false); }} onDisconnect={() => void session.disconnect()} onClose={() => setAuthOpen(false)} />}

    {panelOpen && panel === "search" && !authOpen && <section className="workflow-panel search-panel" aria-label="Αναζήτηση ψαρότοπων"><div className="flex items-start justify-between gap-3"><div><p className="ui-eyebrow">Ρυθμίσεις χάρτη</p><h1 className="mt-1 text-xl font-black">Αναζήτηση</h1></div><button className="ui-close" aria-label="Κλείσιμο αναζήτησης" onClick={() => setPanelOpen(false)}>x</button></div>
      <form className="mt-4 space-y-3" onSubmit={(event: FormEvent) => { event.preventDefault(); void runSearch("nearby"); }}>
        <label className="ui-label">Τύπος ψαρέματος<select className="ui-input" value={technique} onChange={(event) => setTechnique(event.target.value as TechniqueId)}>{Object.values(TECHNIQUE_PROFILES).map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label>
        <label className="ui-label">Περιοχή<input id="spot-location" className="ui-input" value={location} onChange={(event) => editLocation(event.target.value)} placeholder="π.χ. Γύθειο" required={!pickedPoint} /></label>
        <p className="ui-help">Η αλλαγή του κειμένου περιοχής απενεργοποιεί το προηγούμενο pin / GPS. Οι άλλες ρυθμίσεις διατηρούν το επιλεγμένο κέντρο.</p>
        <div className="grid grid-cols-2 gap-2"><label className="ui-label">Αποτελέσματα<select className="ui-input" value={resultLimit} onChange={(event) => setResultLimit(Number(event.target.value))}>{[12, 24, 36, 48].map((limit) => <option key={limit} value={limit}>{limit} σημεία</option>)}</select></label><label className="ui-label">Ακτίνα χλμ<input className="ui-input" type="number" min="1" max="60" step="1" value={Number.isFinite(radiusKm) ? radiusKm : ""} onChange={(event) => setRadiusKm(event.target.value === "" ? NaN : Number(event.target.value))} required /></label></div>
        <label className="ui-label">Στόχος είδους, προαιρετικά<input className="ui-input" list="target-species" value={targetSpecies} onChange={(event) => setTargetSpecies(event.target.value)} placeholder="π.χ. λαβράκι" /><datalist id="target-species">{Array.from(new Set(Object.values(TECHNIQUE_PROFILES).flatMap((profile) => profile.species))).map((fish) => <option key={fish} value={fish} />)}</datalist></label>
        {targetSpecies && <SpeciesProfile technique={technique} target={targetSpecies} />}
        <label className="ui-label">Ημερομηνία και ώρα πρόγνωσης<input className="ui-input" type="datetime-local" min={localDateTime(new Date().toISOString())} max={localDateTime(new Date(Date.now() + 7 * 86_400_000).toISOString())} value={fishingAt} onChange={(event) => setFishingAt(event.target.value)} /></label><p className="ui-help">Κενό για τώρα. Μελλοντική πρόγνωση έως 7 ημέρες, όχι επιβεβαίωση μελλοντικών τοπικών συνθηκών.</p>
        {session.user ? <label className="ui-check"><input type="checkbox" checked={saveHistory} onChange={(event) => setSaveHistory(event.target.checked)} />Αποθήκευση αυτής της αναζήτησης στο ιδιωτικό ιστορικό μου</label> : <p className="ui-help">Δεν αποθηκεύεται προσωπικό ιστορικό ως επισκέπτης.</p>}
        {pickedPoint && <div className="ui-notice space-y-2"><p className="font-black">Ενεργό κέντρο: {pickedPoint.lat.toFixed(5)}, {pickedPoint.lon.toFixed(5)}</p>{gpsAccuracyM !== undefined && <p>Ακρίβεια GPS ±{Math.round(gpsAccuracyM)}μ</p>}<div className="flex flex-wrap gap-2"><button type="button" className="ui-primary" disabled={loading || gpsLoading} onClick={() => void runSearch("point")}>Ανάλυση εδώ</button><button type="button" className="ui-secondary" onClick={() => newTrip(currentDestination())}>Εξόρμηση εδώ</button><button type="button" className="ui-secondary" onClick={() => saveCurrentPlace(currentDestination())}>Αποθήκευση σημείου</button><button type="button" className="ui-secondary" onClick={() => editLocation("Γύθειο")}>Αφαίρεση pin</button></div></div>}
        <div className="grid grid-cols-2 gap-2"><button type="submit" className="ui-primary" disabled={loading || gpsLoading}>{loading ? "Ανάλυση..." : pickedPoint ? "Σημεία κοντά" : "Αναζήτηση"}</button><button type="button" className="ui-secondary" disabled={loading || gpsLoading} onClick={() => void gps()}>{gpsLoading ? "GPS..." : "Η θέση μου / GPS"}</button></div>
      </form>{message && <p role="status" className="ui-notice mt-3">{message}</p>}
    </section>}

    {!authOpen && !(panelOpen && panel === "trips") && <div className="map-tools">
      <button className="ui-secondary shadow-glow" aria-expanded={layersOpen} aria-controls="map-layers" onClick={() => setLayersOpen(!layersOpen)}>Επίπεδα</button>
      {(pickedPoint || selectedSpot || response?.location) && <button className="ui-secondary shadow-glow" onClick={() => setRecenterKey((key) => key + 1)}>Στο σημείο</button>}
      {layersOpen && <section id="map-layers" className="map-layers" aria-label="Επίπεδα χάρτη"><div className="flex items-center justify-between gap-2"><h2 className="text-sm font-black">Επίπεδα χάρτη</h2><button className="ui-close" aria-label="Κλείσιμο επιπέδων" onClick={() => setLayersOpen(false)}>x</button></div>{([ ["terrain", "Ανάγλυφο"], ["satellite", "Δορυφόρος"], ["street", "Δρόμοι"] ] as const).map(([layer, label]) => <button key={layer} aria-pressed={baseLayer === layer} className={baseLayer === layer ? "ui-primary" : "ui-secondary"} onClick={() => setBaseLayer(layer)}>{label}</button>)}<button className={depthVisible ? "ui-primary" : "ui-secondary"} aria-pressed={depthVisible} onClick={() => setDepthVisible(!depthVisible)}>Βαθυμετρία {depthVisible ? "ενεργή" : "ανενεργή"}</button>{depthVisible && <div className="text-sm font-bold leading-6"><div className="depth-scale-gradient h-3 rounded-full" /><p>Βάθος: 0 · 5 · 10 · 15 · 20 · 25 μ</p><p>EMODnet: εκτίμηση βάθους, κελιά ~115 μ. Όχι για πλοήγηση ή ακριβή βολή.</p></div>}</section>}
    </div>}

    {response && !panelOpen && !authOpen && <div className={`result-sheet-controls sheet-${sheetSize}`} role="group" aria-label="Ύψος αποτελεσμάτων">{([["collapsed", "Σύνοψη"], ["half", "Μισή οθόνη"], ["expanded", "Ανάπτυξη"]] as const).map(([size, label]) => <button key={size} className="ui-secondary" aria-pressed={sheetSize === size} onClick={() => { setSheetSize(size); setRecenterKey((key) => key + 1); }}>{label}</button>)}</div>}

    {response && !panelOpen && !infoOpen && !authOpen && <section className={`results-panel sheet-${sheetSize} absolute bottom-3 left-3 right-3 z-20 overflow-y-auto rounded-3xl border border-white/80 bg-white/95 p-3 shadow-glow`} aria-label="Αποτελέσματα αναζήτησης"><p className="ui-eyebrow">{response.intent.techniqueLabel} · {response.spots.length}/{response.resultLimit} σημεία</p><h2 className="mb-3 mt-1 text-lg font-black">{response.location.displayName.split(",")[0]}</h2>{selectedSpot && <p className="depth-estimate">Εκτιμώμενο βάθος: {typeof selectedSpot.depth.closestFishableDepthM === "number" ? `~${Math.round(selectedSpot.depth.closestFishableDepthM)} μ` : "Μη διαθέσιμο"}</p>}{response.location.displayName.includes(",") && <details className="ui-help mb-3"><summary className="cursor-pointer py-1 font-bold">Πλήρης περιοχή</summary><p>{response.location.displayName}</p></details>}<ResultNotices response={response} snapshot={snapshot} />
      {selectedSpot && <div className="mt-3 space-y-2"><h3 className="text-lg font-black">#{selectedSpot.rank} {selectedSpot.name}</h3><SpotWarnings spot={selectedSpot} /><p className="ui-help">Ευρετική συμβατότητα {selectedSpot.score}/100, όχι πιθανότητα αλίευσης. {selectedSpot.techniqueDepthRange.label} · {selectedSpot.seabedLabel}</p><div className="flex flex-wrap gap-2"><button className="ui-primary" onClick={() => setInfoOpen(true)}>Πλήρης ανάλυση</button><button className="ui-secondary" onClick={() => newTrip(currentDestination(selectedSpot))}>Νέα εξόρμηση</button><button className="ui-secondary" onClick={() => saveCurrentPlace(currentDestination(selectedSpot))}>Αποθήκευση σημείου</button></div></div>}
      {response.spots.length > 1 && <div className="mt-3 flex gap-2 overflow-x-auto pb-2">{response.spots.map((spot) => <button key={spot.id} className={`w-44 shrink-0 rounded-2xl border p-3 text-left ${spot.id === selectedSpot?.id ? "border-lagoon bg-lagoon text-white" : "border-slate-200 bg-white"}`} onClick={() => setSelectedSpotId(spot.id)}><span className="block text-xs font-black">#{spot.rank} {spot.name}</span><span className="mt-1 block text-[10px] font-semibold">{recommendationLabel(spot)} · ευρετική {spot.score}/100</span></button>)}</div>}
      <button className="ui-secondary mt-3" onClick={() => openPanel("search")}>{snapshot ? "Νέα αναζήτηση με σημερινές συνθήκες" : "Αλλαγή ρυθμίσεων"}</button>{message && <p className="ui-help mt-2">{message}</p>}
    </section>}
    {response && selectedSpot && infoOpen && !authOpen && <div className={`map-analysis sheet-${sheetSize}`}><SpotAnalysis spot={selectedSpot} response={response} snapshot={snapshot} onTrip={() => newTrip(currentDestination(selectedSpot))} onSavePlace={() => saveCurrentPlace(currentDestination(selectedSpot))} onRecheck={() => { const point = currentDestination(selectedSpot); if (point) recheck(point); }} onClose={() => setInfoOpen(false)} /></div>}

    {panelOpen && panel === "trips" && !authOpen && <><TripJournal key={session.user?.id ?? "guest"} user={session.user} trips={trips} activeTrip={activeTrip} destination={destination} selectedTripId={selectedTripId} onSelectTrip={selectTrip} onShowOnMap={showTripOnMap} onDestination={newTrip} onRecheck={recheck} onUpdated={updatedTrip} onDeleted={(id) => { setTrips((items) => items.filter((trip) => trip.id !== id)); setActiveTrip((current) => current?.id === id ? null : current); if (selectedTripId === id) setSelectedTripId(undefined); }} onLogin={() => setAuthOpen(true)} onClose={() => setPanelOpen(false)} />{(tripsError || tripsLoading) && <div className="absolute inset-x-3 top-[4.8rem] z-50 mx-auto max-w-xl"><p role="status" className={tripsError ? "ui-warning" : "ui-notice"}>{tripsLoading ? "Φόρτωση εξορμήσεων..." : tripsError}{tripsError && <button className="ui-secondary ml-2" onClick={() => setTripRevision((n) => n + 1)}>Ανανέωση</button>}</p></div>}</>}
    {panelOpen && panel === "library" && !authOpen && <PrivateLibrary key={session.user?.id ?? "guest"} user={session.user} destination={libraryDestination} onTrip={newTrip} onRecheck={recheck} onScan={showScan} onSearch={loadRequest} onLogin={() => setAuthOpen(true)} onClose={() => setPanelOpen(false)} />}
  </main>;
}

function pointLabel(point: Coordinates) { return `Σημείο χάρτη ${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`; }
