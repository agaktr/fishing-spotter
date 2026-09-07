import type { ConditionsMetadata, RankedSpot, SpotsApiResponse, TechniqueId } from "@/lib/types";
import { TECHNIQUE_PROFILES } from "@/lib/techniqueProfiles";
import { displayDate } from "@/lib/client/drafts";

export function ResultNotices({ response, snapshot = false, spot }: { response: SpotsApiResponse; snapshot?: boolean; spot?: RankedSpot }) {
  const spots = spot ? [spot] : response.spots;
  const partial = spots.some((item) => item.weather.confidence === "none" || item.marine.confidence === "none" || item.depth.confidence === "none");
  // The API mixes provider failures with policy copy; only operational failures belong here.
  const failures = Array.from(new Set([...response.warnings, ...spots.flatMap((item) => item.warnings)]))
    .filter((warning) => /^Η υπηρεσία .+ δεν είναι προσωρινά διαθέσιμη\.$/.test(warning) || /^Δεν ήταν διαθέσιμα τα δεδομένα .+ για την επιλεγμένη ώρα\.$/.test(warning));
  return <div className="space-y-2">
    {snapshot && <p className="ui-warning">Ιστορικό στιγμιότυπο, όχι τρέχουσες συνθήκες.</p>}
    {spots.some((item) => item.conditionsStatus === "adverse") && <p className="ui-warning">Δυσμενείς καιρικές ή θαλάσσιες συνθήκες για την επιλεγμένη ώρα.</p>}
    {failures.length > 0 && <p className="ui-warning">{failures.join(" ")}</p>}
    {partial && failures.length === 0 && <p className="ui-help">Μερική κάλυψη δεδομένων καιρού, θάλασσας ή βάθους.</p>}
    {!response.spots.length && <p className="ui-warning">Δεν επιστράφηκαν σημεία με διαθέσιμη ανάλυση. Δοκίμασε διαφορετική περιοχή, ακτίνα ή ώρα.</p>}
  </div>;
}

export function AnalysisDataDetails({ response, spot }: { response: SpotsApiResponse; spot?: RankedSpot }) {
  return <details className="rounded-2xl border border-slate-200 p-3"><summary className="cursor-pointer py-2 text-sm font-black">Πηγές δεδομένων</summary><div className="mt-2 space-y-3">
    <p className="ui-help">Συνθήκες {response.conditionsScope === "regional" ? "περιφερειακής κλίμακας, όχι τοπική μέτρηση σε κάθε σημείο" : response.conditionsScope === "point" ? "για την περιοχή του σημείου, όχι επιτόπια μέτρηση" : "άγνωστης χωρικής κάλυψης"}. Ισχύς: {displayDate(response.conditionsAt)}. Ανάκτηση αποτελεσμάτων: {displayDate(response.generatedAt)}.</p>
    {spot && <><h3 className="ui-eyebrow">Πηγή καιρού</h3><ProviderMetadata metadata={spot.weather} /><h3 className="ui-eyebrow">Πηγή θάλασσας</h3><ProviderMetadata metadata={spot.marine} /><Metric label="Πηγή βάθους" value={spot.depthSourceLabel} /><Metric label="Κάλυψη" value={`${spot.depth.sampleCount} δείγματα · ${spot.confidenceLabel}`} /></>}
    <p className="ui-help">{Array.from(new Set(response.attributions)).join(" · ")}</p>
  </div></details>;
}

export function SpotAnalysis({ spot, response, snapshot, onTrip, onSavePlace, onRecheck, onClose }: {
  spot: RankedSpot; response: SpotsApiResponse; snapshot: boolean; onTrip: () => void; onSavePlace: () => void; onRecheck: () => void; onClose: () => void;
}) {
  const point = response.mode === "point" ? response.pointAnalysis : undefined;
  const technique = response.intent.technique;
  const profile = TECHNIQUE_PROFILES[technique];
  return <section className="workflow-panel" aria-label="Ανάλυση σημείου">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="ui-eyebrow">{point ? "Ανάλυση σημείου" : `#${spot.rank} · ${spot.distanceKm.toFixed(1)}χλμ από το κέντρο`}</p><h2 className="mt-1 text-xl font-black">{spot.name}</h2></div><button className="ui-close" aria-label="Κλείσιμο ανάλυσης" onClick={onClose}>x</button></div>
    <div className="mt-3 flex flex-wrap gap-2"><button className="ui-primary" onClick={onTrip}>Νέα εξόρμηση εδώ</button><button className="ui-secondary" onClick={onSavePlace}>Αποθήκευση σημείου</button><button className="ui-secondary" onClick={onRecheck}>Νέος έλεγχος τώρα</button></div>
    <div className="mt-3 space-y-3"><ResultNotices response={response} spot={spot} snapshot={snapshot} />
      {point && <>{!spot.depth.hasNearbyWater ? <p className="ui-notice">Δεν εντοπίστηκε κελί νερού κοντά στο σημείο.</p> : point.adjustedToWater && <p className="ui-notice">Το δείγμα νερού βρίσκεται περίπου {Math.round(point.waterDistanceM)}μ από το επιλεγμένο στίγμα.</p>}<div className="grid grid-cols-2 gap-2"><Metric label="Επιλεγμένο στίγμα" value={`${point.requestedPoint.lat.toFixed(5)}, ${point.requestedPoint.lon.toFixed(5)}`} /><Metric label="Σημείο δειγματοληψίας" value={`${point.analyzedPoint.lat.toFixed(5)}, ${point.analyzedPoint.lon.toFixed(5)}`} /><Metric label="Ακρίβεια GPS" value={point.gpsAccuracyM === undefined ? "Μη διαθέσιμο" : `±${Math.round(point.gpsAccuracyM)}μ`} /></div></>}
      <h3 className="ui-eyebrow">Συνθήκες για την επιλεγμένη ώρα</h3>
      <h4 className="ui-eyebrow">Καιρός</h4><div className="grid grid-cols-2 gap-2"><Metric label="Θερμοκρασία / αισθητή" value={`${metric(spot.weather.airTemperatureC, "°C")} / ${metric(spot.weather.apparentTemperatureC, "°C")}`} /><Metric label="Άνεμος / διεύθυνση" value={`${metric(spot.weather.windSpeedKmh, "km/h")} / ${metric(spot.weather.windDirectionDeg, "°", 0)}`} /><Metric label="Ριπές" value={metric(spot.weather.gustKmh, "km/h")} /><Metric label="Υγρασία" value={metric(spot.weather.relativeHumidityPct, "%", 0)} /><Metric label="Πίεση" value={`${metric(spot.weather.pressureHpa, "hPa", 0)} · ${{ rising: "ανοδική", falling: "πτωτική", stable: "σταθερή", unknown: "άγνωστη τάση" }[spot.weather.pressureTrend]}`} /><Metric label="Βροχή" value={metric(spot.weather.precipitationMm, "mm")} /><Metric label="Νέφωση" value={metric(spot.weather.cloudCoverPct, "%", 0)} /><Metric label="Ορατότητα" value={metric(spot.weather.visibilityM, "μ", 0)} /></div>
      <h4 className="ui-eyebrow">Θάλασσα</h4><div className="grid grid-cols-2 gap-2"><Metric label="Κύμα / περίοδος" value={`${metric(spot.marine.waveHeightM, "μ")} / ${metric(spot.marine.wavePeriodS, "s")}`} /><Metric label="Διεύθυνση κύματος" value={metric(spot.marine.waveDirectionDeg, "°", 0)} /><Metric label="Αποθαλασσιά / περίοδος" value={`${metric(spot.marine.swellHeightM, "μ")} / ${metric(spot.marine.swellPeriodS, "s")}`} /><Metric label="Διεύθυνση αποθαλασσιάς" value={metric(spot.marine.swellDirectionDeg, "°", 0)} /><Metric label="Θερμοκρασία νερού" value={metric(spot.marine.seaSurfaceTemperatureC, "°C")} /><Metric label="Ρεύμα / διεύθυνση" value={`${metric(spot.marine.currentSpeedKmh, "km/h")} / ${metric(spot.marine.currentDirectionDeg, "°", 0)}`} /><Metric label="Στάθμη MSL" value={metric(spot.marine.seaLevelMslM, "μ")} /></div>
      <h3 className="ui-eyebrow">Βάθος και βυθός</h3><Metric label="Ενδεικτικό βάθος ζώνης" value={spot.techniqueDepthRange.label} /><div className="grid grid-cols-2 gap-2"><Metric label="Κοντινό δείγμα νερού" value={metric(spot.depth.closestFishableDepthM, "μ")} /><Metric label="Μέγιστο δείγμα" value={metric(spot.depth.maxDepthM, "μ")} /><Metric label="Κλίση / βυθός" value={`${spot.depthStyle} · ${spot.seabedLabel}`} /><Metric label="Σκαλώματα" value={spot.snagRiskLabel} /><Metric label="Πρόσβαση" value={{ easy: "Εύκολη κατά τα δεδομένα χάρτη", moderate: "Μέτρια", hard: "Δύσκολη", restricted: "Περιορισμένη", unknown: "Άγνωστη" }[spot.access.rating]} /></div>
      <DepthProfileGraphic spot={spot} />
      <h3 className="ui-eyebrow">Γενικό προφίλ τεχνικής</h3><SpeciesProfile technique={technique} target={response.intent.targetSpecies} species={spot.typicalSpecies} /><div className="grid gap-2"><Metric label="Συνήθη δολώματα / τεχνητά" value={profile.baits.join(", ")} /><Metric label="Αρματωσιές" value={profile.rigs.join(", ")} /><Metric label="Γενικά χρονικά παράθυρα" value={profile.bestTimes.join(", ")} /></div><p className="ui-help">{profile.castingAdvice}</p>
      <AnalysisDataDetails response={response} spot={spot} />
    </div>
  </section>;
}

export function SpeciesProfile({ technique, target, species }: { technique: TechniqueId; target?: string; species?: string[] }) {
  const profile = TECHNIQUE_PROFILES[technique];
  const typicalSpecies = species ?? profile.species;
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const typical = target?.trim() && typicalSpecies.some((species) => normalize(species).includes(normalize(target)));
  return <div className="ui-notice"><p>Συνήθη είδη για {profile.label}: {typicalSpecies.join(", ") || "Δεν δηλώθηκαν τυπικά είδη"}.</p>{target?.trim() && <p className="mt-1">{typical ? "Ο στόχος περιλαμβάνεται στο γενικό προφίλ της τεχνικής." : "Ο στόχος δεν αναγνωρίζεται ως τυπικός στο γενικό προφίλ. Αυτό δεν αποδεικνύει ασυμβατότητα."}</p>}<p className="mt-1">Δεν τεκμηριώνεται παρουσία, αφθονία ή πιθανότητα αλίευσης αυτών των ειδών στην περιοχή.</p></div>;
}

function ProviderMetadata({ metadata }: { metadata: ConditionsMetadata }) {
  return <p className="ui-help">Ισχύει: {displayDate(metadata.validAt)} · Λήψη: {displayDate(metadata.fetchedAt)} · {metadata.temporalMode === "forecast" ? "Πρόγνωση, όχι παρατήρηση" : metadata.temporalMode === "current" ? "Τρέχον μοντέλο, όχι επιτόπια μέτρηση" : metadata.temporalMode === "historical" ? "Ιστορικά δεδομένα" : metadata.temporalMode ?? "Άγνωστη χρονική κάλυψη"}. Πηγή: {metadata.sourceCoordinates ? `${metadata.sourceCoordinates.lat.toFixed(3)}, ${metadata.sourceCoordinates.lon.toFixed(3)}` : "άγνωστες συντεταγμένες πηγής"}.</p>;
}
function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3"><p className="ui-eyebrow">{label}</p><p className="mt-1 text-xs font-bold leading-5">{value || "Μη διαθέσιμο"}</p></div>;
}
function metric(value: number | undefined, unit: string, digits = 1) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : "Μη διαθέσιμο";
}
function DepthProfileGraphic({ spot }: { spot: RankedSpot }) {
  const points = spot.depth.castingProfile.filter((point) => typeof point.depthM === "number" && Number.isFinite(point.depthM));
  if (!points.length) return <p className="ui-help">Δεν υπάρχει διαθέσιμο προφίλ βάθους.</p>;
  const maximum = Math.max(1, ...points.map((point) => point.depthM!));
  const distance = Math.max(1, ...points.map((point) => point.distanceM));
  const samples = points.map((point) => ({ ...point, x: 40 + point.distanceM / distance * 240, y: 42 + point.depthM! / maximum * 72 }));
  return <figure className="depth-profile rounded-2xl border border-tide/25 bg-sky-50 p-3">
    <h3 className="ui-eyebrow">Ενδεικτικό προφίλ βάθους ζώνης</h3>
    <svg className="mt-2 w-full" viewBox="0 0 320 180" role="img" aria-label="Εκτιμώμενο βάθος σε μέτρα προς τα κάτω, απόσταση από το σημείο σε μέτρα προς τα δεξιά">
      <text x="12" y="18" fill="#0b5f6f">Εκτιμώμενο βάθος (m)</text>
      <path d="M40 36 V138 H296 M40 42 H296" fill="none" stroke="#19a7ce" strokeWidth="2" />
      <text x="28" y="46" textAnchor="end" fill="#0b5f6f">0</text>
      <polyline points={samples.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#0b5f6f" strokeWidth="3" />
      {samples.map((point, index) => <g key={index}><circle cx={point.x} cy={point.y} r="4" fill="#09202a" /><text x={point.x} y={point.y - 9} textAnchor="middle" fill="#09202a">~{point.depthM!.toFixed(0)}</text><text x={point.x} y="153" textAnchor="middle" fill="#0b5f6f">{point.distanceM}</text></g>)}
      <text x="168" y="175" textAnchor="middle" fill="#0b5f6f">Απόσταση από το σημείο (m)</text>
    </svg>
    <figcaption className="ui-help mt-2">Εκτίμηση βάθους, όχι επιτόπια μέτρηση. Όχι για ακριβή βολή ή πλοήγηση.</figcaption>
    <details className="mt-3 text-sm"><summary className="cursor-pointer py-2 font-bold">Τιμές δειγμάτων</summary><table className="w-full text-left"><thead><tr><th scope="col">Απόσταση (m)</th><th scope="col">Εκτιμώμενο βάθος (m)</th></tr></thead><tbody>{samples.map((point, index) => <tr key={index}><td>{point.distanceM}</td><td>~{point.depthM!.toFixed(0)}</td></tr>)}</tbody></table></details>
  </figure>;
}
