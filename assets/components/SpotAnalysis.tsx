import type { ApproximateZone, ConditionsMetadata, RankedSpot, SpotsApiResponse, TechniqueId } from "@/lib/types";
import { TECHNIQUE_PROFILES } from "@/lib/techniqueProfiles";
import { displayDate } from "@/lib/client/drafts";

export function recommendationLabel(spot: RankedSpot): string {
  return { eligible: "Συμβατό με τα διαθέσιμα στοιχεία", caution: "Χρειάζεται προσοχή", unsuitable: "Μη κατάλληλο", unverified: "Μη επαληθευμένο" }[spot.recommendationStatus ?? "unverified"];
}

export function ResultNotices({ response, snapshot = false }: { response: SpotsApiResponse; snapshot?: boolean }) {
  const partial = response.spots.some((spot) => spot.weather.confidence === "none" || spot.marine.confidence === "none" || spot.depth.confidence === "none");
  return <div className="space-y-2">
    {snapshot && <p className="ui-warning">Ιστορικό στιγμιότυπο. Δεν περιγράφει τις συνθήκες τώρα. Κάνε νέο έλεγχο πριν προγραμματίσεις εξόρμηση.</p>}
    <p className="ui-help">Συνθήκες {response.conditionsScope === "regional" ? "περιφερειακής κλίμακας, όχι τοπική μέτρηση σε κάθε σημείο" : response.conditionsScope === "point" ? "για την περιοχή του σημείου, όχι επιτόπια μέτρηση" : "άγνωστης χωρικής κάλυψης"}. Ισχύς: {displayDate(response.conditionsAt)}. Ανάκτηση αποτελεσμάτων: {displayDate(response.generatedAt)}.</p>
    <p className="ui-notice">Η κατάταξη είναι ευρετική συμβατότητα, όχι πιθανότητα αλίευσης ή πιστοποίηση ασφάλειας. Βαθυμετρία περίπου 115μ: ενδεικτικές ζώνες, όχι ακριβείς βολές ή πλοήγηση.</p>
    {partial && <p className="ui-warning">Μερική κάλυψη δεδομένων. Λείπουν στοιχεία καιρού, θάλασσας ή βάθους σε ορισμένα σημεία. Η απουσία δυσμενούς ένδειξης δεν σημαίνει ασφάλεια.</p>}
    {response.warnings.length > 0 && <details className="ui-warning"><summary className="cursor-pointer font-black">Προειδοποιήσεις αναζήτησης ({response.warnings.length})</summary><ul className="mt-2 list-disc space-y-1 pl-4">{response.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
    {!response.spots.length && <p className="ui-warning">Δεν επιστράφηκαν σημεία με διαθέσιμη ανάλυση. Δοκίμασε διαφορετική περιοχή, ακτίνα ή ώρα. Αυτό δεν σημαίνει ότι δεν υπάρχουν ψάρια στην περιοχή.</p>}
  </div>;
}

export function SpotWarnings({ spot }: { spot: RankedSpot }) {
  return <div className="space-y-2"><p className={spot.recommendationStatus === "eligible" && spot.conditionsStatus === "no-adverse-signal" ? "ui-notice" : "ui-warning"}><strong>{recommendationLabel(spot)}</strong>{spot.actionabilityLabel && <span className="block">{spot.actionabilityLabel}</span>}<span className="block">{spot.conditionsStatus === "adverse" ? "Δυσμενείς συνθήκες. Μην αντιμετωπίζεις το σκορ ως προτροπή για ψάρεμα." : spot.conditionsStatus === "no-adverse-signal" ? "Δεν εντοπίστηκε δυσμενής ένδειξη στα διαθέσιμα δεδομένα. Δεν αποτελεί εγγύηση ασφάλειας." : "Άγνωστη αξιολόγηση συνθηκών. Απαιτείται επιτόπιος έλεγχος."}</span></p>
    {Boolean(spot.recommendationReasons?.length || spot.warnings.length) && <ul className="ui-warning list-inside list-disc space-y-1">{Array.from(new Set([...(spot.recommendationReasons ?? []), ...spot.warnings])).map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
  </div>;
}

export function SpotAnalysis({ spot, response, snapshot, onTrip, onSavePlace, onRecheck, onClose }: {
  spot: RankedSpot; response: SpotsApiResponse; snapshot: boolean; onTrip: () => void; onSavePlace: () => void; onRecheck: () => void; onClose: () => void;
}) {
  const point = response.mode === "point" ? response.pointAnalysis : undefined;
  const zone = point?.approximateZone;
  const technique = response.intent.technique;
  const profile = TECHNIQUE_PROFILES[technique];
  return <section className="workflow-panel" aria-label="Ανάλυση σημείου">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="ui-eyebrow">{point ? "Ανάλυση σημείου" : `#${spot.rank} · ${spot.distanceKm.toFixed(1)}χλμ από το κέντρο`}</p><h2 className="mt-1 text-xl font-black">{spot.name}</h2></div><button className="ui-close" aria-label="Κλείσιμο ανάλυσης" onClick={onClose}>x</button></div>
    {snapshot && <p className="ui-warning mt-3">Ιστορικό στιγμιότυπο. Δεν περιγράφει τις συνθήκες τώρα. Κάνε νέο έλεγχο πριν προγραμματίσεις εξόρμηση.</p>}
    <div className="mt-3 flex flex-wrap gap-2"><button className="ui-primary" onClick={onTrip}>Νέα εξόρμηση εδώ</button><button className="ui-secondary" onClick={onSavePlace}>Αποθήκευση σημείου</button><button className="ui-secondary" onClick={onRecheck}>Νέος έλεγχος τώρα</button></div>
    <div className="mt-3 space-y-3"><SpotWarnings spot={spot} />
      <p className="text-sm font-bold">Ευρετική συμβατότητα: {spot.score}/100. Όχι ποσοστό επιτυχίας.</p>
      <ResultNotices response={response} />
      {point && <><p className="ui-notice">{!spot.depth.hasNearbyWater ? "Δεν εντοπίστηκε κελί νερού κοντά στο σημείο. Δεν τεκμηριώνεται κατάλληλη πρόσβαση." : point.adjustedToWater ? `Αναλύθηκε διαφορετικό κελί νερού περίπου ${Math.round(point.waterDistanceM)}μ μακριά. Το κελί νερού δεν αποδεικνύει προσβάσιμο ή ασφαλές πάτημα.` : "Το στίγμα αντιστοιχεί σε κελί νερού της βαθυμετρίας, όχι σε επιτόπια επιβεβαίωση."}</p><div className="grid grid-cols-2 gap-2"><Metric label="Επιλεγμένο στίγμα" value={`${point.requestedPoint.lat.toFixed(5)}, ${point.requestedPoint.lon.toFixed(5)}`} /><Metric label="Σημείο δειγματοληψίας" value={`${point.analyzedPoint.lat.toFixed(5)}, ${point.analyzedPoint.lon.toFixed(5)}`} /><Metric label="Ακρίβεια GPS" value={point.gpsAccuracyM === undefined ? "Άγνωστη" : `±${Math.round(point.gpsAccuracyM)}μ`} /></div></>}
      <h3 className="ui-eyebrow">Καιρός για την επιλεγμένη ώρα</h3><ProviderMetadata metadata={spot.weather} /><div className="grid grid-cols-2 gap-2"><Metric label="Θερμοκρασία / αισθητή" value={`${metric(spot.weather.airTemperatureC, "°C")} / ${metric(spot.weather.apparentTemperatureC, "°C")}`} /><Metric label="Άνεμος / διεύθυνση" value={`${metric(spot.weather.windSpeedKmh, "km/h")} / ${metric(spot.weather.windDirectionDeg, "°", 0)}`} /><Metric label="Ριπές" value={metric(spot.weather.gustKmh, "km/h")} /><Metric label="Υγρασία" value={metric(spot.weather.relativeHumidityPct, "%", 0)} /><Metric label="Πίεση" value={`${metric(spot.weather.pressureHpa, "hPa", 0)} · ${{ rising: "ανοδική", falling: "πτωτική", stable: "σταθερή", unknown: "άγνωστη τάση" }[spot.weather.pressureTrend]}`} /><Metric label="Βροχή" value={metric(spot.weather.precipitationMm, "mm")} /><Metric label="Νέφωση" value={metric(spot.weather.cloudCoverPct, "%", 0)} /><Metric label="Ορατότητα" value={metric(spot.weather.visibilityM, "μ", 0)} /></div>
      <h3 className="ui-eyebrow">Θάλασσα για την επιλεγμένη ώρα</h3><ProviderMetadata metadata={spot.marine} /><div className="grid grid-cols-2 gap-2"><Metric label="Κύμα / περίοδος" value={`${metric(spot.marine.waveHeightM, "μ")} / ${metric(spot.marine.wavePeriodS, "s")}`} /><Metric label="Διεύθυνση κύματος" value={metric(spot.marine.waveDirectionDeg, "°", 0)} /><Metric label="Αποθαλασσιά / περίοδος" value={`${metric(spot.marine.swellHeightM, "μ")} / ${metric(spot.marine.swellPeriodS, "s")}`} /><Metric label="Διεύθυνση αποθαλασσιάς" value={metric(spot.marine.swellDirectionDeg, "°", 0)} /><Metric label="Θερμοκρασία νερού" value={metric(spot.marine.seaSurfaceTemperatureC, "°C")} /><Metric label="Ρεύμα / διεύθυνση" value={`${metric(spot.marine.currentSpeedKmh, "km/h")} / ${metric(spot.marine.currentDirectionDeg, "°", 0)}`} /><Metric label="Στάθμη MSL" value={metric(spot.marine.seaLevelMslM, "μ")} /></div>
      <h3 className="ui-eyebrow">Βάθος και βυθός</h3><div className="grid grid-cols-2 gap-2"><Metric label="Ενδεικτικό βάθος ζώνης" value={spot.techniqueDepthRange.label} /><Metric label="Κοντινό δείγμα νερού" value={metric(spot.depth.closestFishableDepthM, "μ")} /><Metric label="Μέγιστο δείγμα" value={metric(spot.depth.maxDepthM, "μ")} /><Metric label="Κλίση / βυθός" value={`${spot.depthStyle} · ${spot.seabedLabel}`} /><Metric label="Σκαλώματα" value={spot.snagRiskLabel} /><Metric label="Πηγή βάθους" value={spot.depthSourceLabel} /><Metric label="Κάλυψη" value={`${spot.depth.sampleCount} δείγματα · ${spot.confidenceLabel}`} /><Metric label="Πρόσβαση" value={{ easy: "Εύκολη κατά τα δεδομένα χάρτη", moderate: "Μέτρια", hard: "Δύσκολη", restricted: "Περιορισμένη", unknown: "Άγνωστη" }[spot.access.rating]} /></div>
      {spot.access.notes.length > 0 && <p className="ui-warning">{spot.access.notes.join(" ")}</p>}
      <DepthProfileGraphic spot={spot} />
      {zone ? <ApproximateZoneInfo zone={zone} resolutionM={point?.spatialResolutionM} /> : point && <p className="ui-warning">Δεν επιστράφηκε χονδρική ζώνη από το μοντέλο. Δεν κατασκευάζεται στόχος ή οδηγία βολής από τις συντεταγμένες των δειγμάτων.</p>}
      <h3 className="ui-eyebrow">Γενικό προφίλ τεχνικής, όχι τοπική πρόβλεψη</h3><SpeciesProfile technique={technique} target={response.intent.targetSpecies} species={spot.typicalSpecies} /><div className="grid gap-2"><Metric label="Συνήθη δολώματα / τεχνητά" value={profile.baits.join(", ")} /><Metric label="Αρματωσιές" value={profile.rigs.join(", ")} /><Metric label="Γενικά χρονικά παράθυρα" value={profile.bestTimes.join(", ")} /></div><p className="ui-help">{profile.castingAdvice} Γενική πληροφορία τεχνικής, όχι εξατομικευμένη σύσταση για αυτό το σημείο ή αυτές τις συνθήκες.</p>
      {spot.breakdown.length > 0 && <details className="rounded-2xl border border-slate-200 p-3"><summary className="text-sm font-black">Πώς υπολογίστηκε η ευρετική συμβατότητα</summary><div className="mt-2 space-y-2">{spot.breakdown.map((factor) => <div key={factor.key}><p className="text-xs font-black">{factor.label}: {factor.score}/100 · βάρος {factor.weight}</p><p className="ui-help">{factor.explanation}</p></div>)}</div></details>}
      <p className="ui-help">{response.attributions.join(" · ")}</p>
    </div>
  </section>;
}

export function ApproximateZoneInfo({ zone, resolutionM = 115 }: { zone: ApproximateZone; resolutionM?: number }) {
  return <section className="ui-warning space-y-2" aria-label="Χονδρική ζώνη χωρίς οδηγία βολής" data-actionable={zone.actionable}><h3 className="font-black">Χονδρική ζώνη μοντέλου, όχι στόχος βολής</h3><p>{zone.label}</p><p>Μόνο πληροφορία, όχι οδηγία για εκτέλεση. Κελιά περίπου {resolutionM}μ, χαμηλή βεβαιότητα. Δεν αποδεικνύονται ασφαλές πάτημα, πρόσβαση, εμπόδια ή συνεχής διαδρομή νερού επιτόπου.</p><p>Γενικός προσανατολισμός: {zone.direction} ({metric(zone.bearingDeg, "°", 0)}). Εύρος απόστασης μοντέλου: {zone.distanceRangeM.join(" - ")}μ. Εύρος βάθους δειγμάτων: {zone.depthRangeM.map((depth) => depth.toFixed(1)).join(" - ")}μ.</p><p>Δεν προκύπτει ακριβές στίγμα στόχου από αυτά τα εύρη. Απαιτείται επιτόπιος έλεγχος, όχι πλοήγηση ή βολή σύμφωνα με το μοντέλο.</p></section>;
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
  const samples = points.map((point) => ({ ...point, x: 25 + point.distanceM / distance * 270, y: 25 + point.depthM! / maximum * 70 }));
  return <div className="rounded-2xl border border-tide/25 bg-sky-50 p-3"><p className="ui-eyebrow">Ενδεικτικό προφίλ βάθους ζώνης</p><svg className="mt-2 w-full" viewBox="0 0 320 125" role="img" aria-label="Ενδεικτικά δείγματα βάθους, όχι ακριβής βολή"><path d="M10 20 H310" stroke="#19a7ce" strokeWidth="2" /><polyline points={samples.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#0b5f6f" strokeWidth="3" />{samples.map((point, index) => <g key={index}><circle cx={point.x} cy={point.y} r="4" fill="#09202a" /><text x={point.x} y={point.y - 7} textAnchor="middle" fontSize="9" fill="#09202a">{point.depthM!.toFixed(0)}μ</text><text x={point.x} y="118" textAnchor="middle" fontSize="9" fill="#0b5f6f">{point.distanceM}μ</text></g>)}</svg><p className="ui-help">Ονομαστική κλίμακα περίπου 115μ. Δείγματα σε μικρότερες αποστάσεις μπορεί να προέρχονται από το ίδιο κελί.</p></div>;
}
