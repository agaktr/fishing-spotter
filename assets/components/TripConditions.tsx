import type { ReactNode } from "react";
import type { MarineSnapshot, WeatherSnapshot } from "@/lib/types";
import { displayDate } from "@/lib/client/drafts";

const icons = {
  temperature: "M10 14.5V4a2 2 0 0 1 4 0v10.5a4 4 0 1 1-4 0ZM12 9v9M17 5h3M17 9h2",
  wind: "M3 8h13a3 3 0 1 0-3-3M3 12h17M3 16h10a3 3 0 1 1-3 3",
  direction: "m12 3 7 17-7-4-7 4 7-17ZM12 3v13",
  drop: "M12 3S5 11 5 15a7 7 0 0 0 14 0c0-4-7-12-7-12ZM9 15a3 3 0 0 0 3 3",
  pressure: "M5 19a9 9 0 1 1 14 0M12 5v2M5 12h2M17 12h2M12 15l4-6M9 19h6",
  rain: "M6 14a4 4 0 1 1 1-8 5 5 0 0 1 10 1 3.5 3.5 0 0 1 0 7ZM7 17l-1 3M12 17l-1 3M17 17l-1 3",
  cloud: "M6 18a5 5 0 1 1 1-10 6 6 0 0 1 11 1 4.5 4.5 0 0 1 0 9Z",
  visibility: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  wave: "M2 6q2-3 5 0t5 0t5 0t5 0M2 12q2-3 5 0t5 0t5 0t5 0M2 18q2-3 5 0t5 0t5 0t5 0",
  period: "M12 8v5l3 2M9 2h6M12 2v3M21 14a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  current: "M2 7h18m-4-4 4 4-4 4M2 17q2-3 5 0t5 0t5 0t5 0",
  level: "M5 3v12m-3-9 3-3 3 3M2 18q2-3 5 0t5 0t5 0t5 0M12 5h8M12 9h5",
};
type Metric = [keyof WeatherSnapshot | keyof MarineSnapshot, string, string, keyof typeof icons];
const weatherMetrics: Metric[] = [
  ["airTemperatureC", "Θερμ. αέρα", "°C", "temperature"],
  ["apparentTemperatureC", "Αισθητή", "°C", "temperature"],
  ["windSpeedKmh", "Άνεμος", "km/h", "wind"],
  ["windDirectionDeg", "Άνεμος · φορά", "°", "direction"],
  ["gustKmh", "Ριπές", "km/h", "wind"],
  ["relativeHumidityPct", "Υγρασία", "%", "drop"],
  ["pressureHpa", "Πίεση", "hPa", "pressure"],
  ["precipitationMm", "Βροχή", "mm", "rain"],
  ["cloudCoverPct", "Νέφωση", "%", "cloud"],
  ["visibilityM", "Ορατότητα", "m", "visibility"],
];
const marineMetrics: Metric[] = [
  ["seaSurfaceTemperatureC", "Θερμ. νερού", "°C", "temperature"],
  ["waveHeightM", "Ύψος κύματος", "m", "wave"],
  ["waveDirectionDeg", "Κύμα · φορά", "°", "direction"],
  ["wavePeriodS", "Κύμα · περίοδος", "s", "period"],
  ["swellHeightM", "Swell · ύψος", "m", "wave"],
  ["swellDirectionDeg", "Swell · φορά", "°", "direction"],
  ["swellPeriodS", "Swell · περίοδος", "s", "period"],
  ["currentSpeedKmh", "Ρεύμα", "km/h", "current"],
  ["currentDirectionDeg", "Ρεύμα · φορά", "°", "direction"],
  ["seaLevelMslM", "Στάθμη (MSL)", "m", "level"],
];
const number = new Intl.NumberFormat("el-GR", { maximumFractionDigits: 2 });

export function TripConditions({ weather, marine, pending = false, recordedAt, label, children }: {
  weather?: WeatherSnapshot; marine?: MarineSnapshot; pending?: boolean; recordedAt?: string | null; label?: string; children?: ReactNode;
}) {
  const groups = [{ label: "Καιρός", snapshot: weather, metrics: weatherMetrics }, { label: "Θάλασσα", snapshot: marine, metrics: marineMetrics }];
  return <section aria-label="Συνθήκες εξόρμησης" className="trip-conditions space-y-3">
    <p className="ui-help">{pending ? "Στιγμιότυπο επιλεγμένου σημείου, όχι επιτόπια παρατήρηση. Παλιές συνθήκες και προγνώσεις δεν αποθηκεύονται ως παρατήρηση." : "Αποθηκευμένο στιγμιότυπο εξόρμησης, όχι τρέχουσες συνθήκες."}</p>
    {groups.map(({ label, snapshot, metrics }) => <section key={label} aria-label={label} className="space-y-2">
      <h4 className="ui-eyebrow">{label}</h4>
      {snapshot?.sourceSnapshot && <p className="ui-help">Η αρχική πηγή δεν αντιστοιχεί χρονικά στην εξόρμηση. Οι συνθήκες είναι μη διαθέσιμες.</p>}
      <dl className="trip-conditions-grid">{metrics.map(([key, title, unit, icon]) => {
        const value = snapshot?.sourceSnapshot ? undefined : snapshot?.[key as keyof typeof snapshot];
        const available = typeof value === "number" && Number.isFinite(value);
        return <div key={key} className="trip-condition">
          <dt><svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-tide" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={icons[icon]} /></svg>{title}</dt>
          <dd className={available ? "font-black tabular-nums" : "text-xs text-slate-500"}>{available ? <>{number.format(value)} <span className="text-xs font-bold">{unit}</span></> : "Μη διαθέσιμο"}</dd>
          {key === "pressureHpa" && weather?.pressureTrend && weather.pressureTrend !== "unknown" && !weather.sourceSnapshot && <p className="ui-help">Τάση: {{ rising: "ανοδική", falling: "πτωτική", stable: "σταθερή" }[weather.pressureTrend]}</p>}
        </div>;
      })}</dl>
      {label === "Θάλασσα" && <p className="ui-help">Swell: αποθαλασσιά · MSL: μέση στάθμη θάλασσας.</p>}
    </section>)}
    <details className="rounded-xl border border-slate-200 p-3">
      <summary className="cursor-pointer text-sm font-bold">Πηγές δεδομένων</summary>
      <div className="mt-3 space-y-3">
        {label && <p className="ui-help">{label}</p>}
        {children ?? <p className="ui-help">Ώρα καταγραφής: {recordedAt ? displayDate(recordedAt) : "Μη διαθέσιμο"}</p>}
        {groups.map(({ label, snapshot }) => {
          const metadata = snapshot?.sourceSnapshot ?? snapshot;
          return <div key={label} className="ui-help space-y-1 break-words"><h5 className="font-bold">{label}</h5>
            <p>Συντεταγμένες πηγής: {metadata?.sourceCoordinates ? `${metadata.sourceCoordinates.lat.toFixed(3)}, ${metadata.sourceCoordinates.lon.toFixed(3)}` : "Μη διαθέσιμο"}</p>
            <p>Ισχύει: {metadata?.validAt ? displayDate(metadata.validAt) : "Μη διαθέσιμο"}</p>
            <p>Λήψη: {metadata?.fetchedAt ? displayDate(metadata.fetchedAt) : "Μη διαθέσιμο"}</p>
            <p>Χρονική κάλυψη: {metadata?.temporalMode === "forecast" ? "Πρόγνωση, όχι παρατήρηση" : metadata?.temporalMode === "current" ? "Τρέχον μοντέλο, όχι επιτόπια μέτρηση" : metadata?.temporalMode === "historical" ? "Ιστορικά δεδομένα" : metadata?.temporalMode ?? "Μη διαθέσιμο"}</p>
          </div>;
        })}
      </div>
    </details>
  </section>;
}
