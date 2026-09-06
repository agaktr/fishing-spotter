import { FormEvent, useEffect, useState } from "react";
import type { ApiUser, PersonalInsights, SavedPlace, SavedScan, ScanSummary, SpotsApiRequest, TripDestination } from "@/lib/types";
import { deletePlace, deleteScans, fetchInsights, fetchSavedPlaces, fetchScan, fetchScans, savePlace } from "@/lib/client/api";
import { displayDate } from "@/lib/client/drafts";
import { TECHNIQUE_PROFILES } from "@/lib/techniqueProfiles";
import { scanRecheckRequest } from "@/lib/client/scanRequest";

export function PrivateLibrary({ user, destination, onTrip, onRecheck, onScan, onSearch, onLogin, onClose }: {
  user?: ApiUser; destination?: TripDestination; onTrip: (point: TripDestination) => void; onRecheck: (point: TripDestination) => void;
  onScan: (scan: SavedScan) => void; onSearch: (request: SpotsApiRequest) => void; onLogin: () => void; onClose: () => void;
}) {
  const [tab, setTab] = useState<"places" | "scans" | "insights">("places");
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [insights, setInsights] = useState<PersonalInsights>();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (!user) return;
    setLoading(true); setError(undefined);
    void (async () => {
      try {
        if (tab === "places") { const result = await fetchSavedPlaces(); if (!cancelled) setPlaces(result); }
        else if (tab === "scans") { const result = await fetchScans(); if (!cancelled) setScans(result); }
        else { const result = await fetchInsights(); if (!cancelled) setInsights(result); }
      } catch (error) { if (!cancelled) setError(error instanceof Error ? error.message : "Η βιβλιοθήκη δεν φορτώθηκε."); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [user?.id, tab, revision]);

  async function act(action: () => Promise<void>) {
    setBusy(true); setError(undefined); setMessage(undefined);
    try { await action(); }
    catch (error) { setError(error instanceof Error ? error.message : "Η ενέργεια απέτυχε."); }
    finally { setBusy(false); }
  }
  async function scanAction(id: string, fresh: boolean) {
    const scan = await fetchScan(id);
    if (fresh) onSearch(scanRecheckRequest(scan)); else onScan(scan);
  }

  return <section className="workflow-panel" aria-label="Ιδιωτική βιβλιοθήκη">
    <div className="flex items-start justify-between gap-3"><div><p className="ui-eyebrow">Μόνο για εσένα</p><h2 className="mt-1 text-xl font-black">Η βιβλιοθήκη μου</h2></div><button className="ui-close" aria-label="Κλείσιμο βιβλιοθήκης" onClick={onClose}>x</button></div>
    {!user ? <div className="ui-notice mt-4"><p>Συνδέσου για αποθηκευμένα σημεία, προηγούμενες σαρώσεις και προσωπικά στατιστικά. Η επιλογή σημείου διατηρείται.</p><button className="ui-primary mt-3" onClick={onLogin}>Σύνδεση / ενεργοποίηση</button></div> : <fieldset className="min-w-0" disabled={busy || loading}>
      <div className="mt-4 grid grid-cols-3 gap-2">{([ ["places", "Σημεία"], ["scans", "Σαρώσεις"], ["insights", "Στατιστικά"] ] as const).map(([id, label]) => <button key={id} aria-pressed={tab === id} className={tab === id ? "ui-primary" : "ui-secondary"} onClick={() => setTab(id)}>{label}</button>)}</div>
      <button className="ui-secondary mt-3" disabled={loading || busy} onClick={() => setRevision((n) => n + 1)}>Ανανέωση</button>
      {error && <p role="alert" className="ui-error mt-3">{error} Τα στοιχεία που ήδη εμφανίζονται μπορεί να είναι παλιότερα.</p>}
      {message && <p role="status" className="ui-notice mt-3">{message}</p>}
      {loading && <p role="status" className="ui-help mt-3">Φόρτωση ιδιωτικών στοιχείων...</p>}
      {tab === "places" && <div className="mt-4 space-y-3">
        {destination ? <SavePlaceForm key={`${destination.lat}:${destination.lon}:${destination.technique}`} destination={destination} busy={busy || loading} onSave={(name, notes) => void act(async () => { const place = await savePlace({ name, notes, lat: destination.lat, lon: destination.lon, technique: destination.technique }); setPlaces((items) => [place, ...items.filter((item) => item.id !== place.id)]); setMessage(`Αποθηκεύτηκε ιδιωτικά: ${place.name}.`); })} /> : <p className="ui-notice">Επίλεξε σημείο στον χάρτη ή στα αποτελέσματα και πάτησε «Αποθήκευση σημείου».</p>}
        {!loading && !error && !places.length && <p className="ui-help">Δεν έχεις αποθηκεύσει σημεία.</p>}
        {places.map((place) => <article key={place.id} className="space-y-2 rounded-2xl border border-slate-200 p-3"><h3 className="font-black">{place.name}</h3><p className="ui-help">{TECHNIQUE_PROFILES[place.technique].label} · {place.lat.toFixed(5)}, {place.lon.toFixed(5)}</p>{place.notes && <p className="whitespace-pre-wrap text-xs">{place.notes}</p>}<p className="ui-help">Αποθηκεύτηκε {displayDate(place.createdAt)} · ενημέρωση {displayDate(place.updatedAt)}</p><div className="flex flex-wrap gap-2"><button className="ui-primary" onClick={() => onRecheck(place)}>Έλεγχος συνθηκών τώρα</button><button className="ui-secondary" onClick={() => onTrip(place)}>Νέα εξόρμηση εδώ</button><button className="ui-secondary" disabled={busy} onClick={() => { if (window.confirm(`Διαγραφή του ιδιωτικού σημείου «${place.name}»;`)) void act(async () => { await deletePlace(place.id); setPlaces((items) => items.filter((item) => item.id !== place.id)); }); }}>Διαγραφή</button></div></article>)}
      </div>}
      {tab === "scans" && <div className="mt-4 space-y-3"><p className="ui-notice">Οι σαρώσεις είναι ιστορικά στιγμιότυπα, όχι σημερινή πρόγνωση. Αποθηκεύονται μόνο όταν επιλέγεις ρητά την αποθήκευση ιστορικού στην αναζήτηση.</p>
        {!loading && !error && !scans.length && <p className="ui-help">Δεν υπάρχουν αποθηκευμένες σαρώσεις.</p>}
        {scans.length > 0 && <button className="ui-secondary" disabled={busy} onClick={() => { if (window.confirm("Διαγραφή όλων των δικών σου σαρώσεων; Δεν διαγράφονται εξορμήσεις ή σημεία.")) void act(async () => { await deleteScans(); setScans([]); }); }}>Διαγραφή όλου του δικού μου ιστορικού</button>}
        {scans.map((scan) => <article key={scan.id} className="space-y-2 rounded-2xl border border-slate-200 p-3"><p className="ui-eyebrow">Ιστορικό στιγμιότυπο · {displayDate(scan.createdAt)}</p><h3 className="font-black">{scan.locationLabel}</h3><p className="ui-help">{TECHNIQUE_PROFILES[scan.technique].label} · {scan.resultCount} αποτελέσματα</p><div className="flex flex-wrap gap-2"><button className="ui-primary" disabled={busy} onClick={() => void act(() => scanAction(scan.id, true))}>Νέα σάρωση τώρα</button><button className="ui-secondary" disabled={busy} onClick={() => void act(() => scanAction(scan.id, false))}>Προβολή στιγμιοτύπου</button><button className="ui-secondary" onClick={() => onTrip({ lat: scan.lat, lon: scan.lon, name: scan.locationLabel, technique: scan.technique })}>Νέα εξόρμηση στο κέντρο</button><button className="ui-secondary" disabled={busy} onClick={() => { if (window.confirm("Διαγραφή αυτού του στιγμιοτύπου;")) void act(async () => { await deleteScans(scan.id); setScans((items) => items.filter((item) => item.id !== scan.id)); }); }}>Διαγραφή</button></div></article>)}
      </div>}
      {tab === "insights" && insights && <InsightsView insights={insights} />}
    </fieldset>}
  </section>;
}

function SavePlaceForm({ destination, busy, onSave }: { destination: TripDestination; busy: boolean; onSave: (name: string, notes: string) => void }) {
  const [name, setName] = useState(destination.name);
  const [notes, setNotes] = useState("");
  return <form className="space-y-3 rounded-2xl border border-tide/25 bg-tide/10 p-3" onSubmit={(event: FormEvent) => { event.preventDefault(); if (name.trim()) onSave(name.trim(), notes); }}><h3 className="font-black">Αποθήκευση επιλεγμένου σημείου</h3><p className="ui-help">{destination.lat.toFixed(5)}, {destination.lon.toFixed(5)} · {TECHNIQUE_PROFILES[destination.technique].label}. Δεν αποθηκεύεται πρόγνωση ως τρέχουσα.</p><label className="ui-label">Όνομα<input className="ui-input" value={name} required onChange={(e) => setName(e.target.value)} /></label><label className="ui-label">Ιδιωτικές σημειώσεις<textarea className="ui-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label><button className="ui-primary w-full" disabled={busy}>Αποθήκευση ιδιωτικού σημείου</button></form>;
}

function InsightsView({ insights }: { insights: PersonalInsights }) {
  const summary = insights.summary;
  const rate = (value: number | null) => value === null ? "Μη διαθέσιμο" : value.toLocaleString("el-GR", { maximumFractionDigits: 2 });
  return <div className="mt-4 space-y-3"><p className="ui-warning">Περιγραφή του δικού σου δείγματος, όχι πρόβλεψη για ψάρια ή πιθανότητα επιτυχίας. Άγνωστο αποτέλεσμα δεν σημαίνει μηδενική αλίευση. Η προσπάθεια δεν συμπληρώνεται με υποθέσεις.</p>
    <dl className="grid grid-cols-2 gap-2">{[
      ["Ολοκληρωμένες εξορμήσεις", summary.completedTrips], ["Με γνωστό αποτέλεσμα", summary.knownOutcomeTrips], ["Καταγεγραμμένα ψάρια", summary.fishCount], ["Εξορμήσεις με προσπάθεια", summary.effortTrips], ["Ώρες ψαρέματος", rate(summary.effortHours)], ["Ανθρωποώρες", rate(summary.anglerHours)], ["Ψάρια / ανθρωποώρα", rate(summary.catchPerAnglerHour)],
    ].map(([label, value]) => <div key={label} className="min-w-0 rounded-2xl bg-slate-50 p-3"><dt className="ui-help">{label}</dt><dd className="mt-1 text-xl font-black">{value}</dd></div>)}</dl>
    <p className="ui-help">Ο ρυθμός χρησιμοποιεί μόνο τις εξορμήσεις με τα απαιτούμενα στοιχεία αποτελέσματος και προσπάθειας. Δείγμα προσπάθειας: {summary.effortTrips} / {summary.completedTrips} εξορμήσεις.</p>
    {!insights.groups.length && <p className="ui-help">Δεν υπάρχει ακόμα επαρκές καταγεγραμμένο δείγμα.</p>}
    {insights.groups.map((group, index) => <article key={`${group.technique}:${group.locationName}:${index}`} className="space-y-2 rounded-2xl border border-slate-200 p-3"><h3 className="font-black">{group.locationName} · {TECHNIQUE_PROFILES[group.technique].label}</h3><p className="ui-help">Δείγμα: {group.tripCount} εξορμήσεις, {group.knownOutcomeTrips} με γνωστό αποτέλεσμα, {group.effortTrips} με προσπάθεια.</p><p className="text-xs font-bold">{group.fishCount} ψάρια · {rate(group.anglerHours)} ανθρωποώρες · {rate(group.catchPerAnglerHour)} ψάρια / ανθρωποώρα</p></article>)}
  </div>;
}
