import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(await readFile(new URL("./tripHistory.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, context);
const { EMPTY_TRIP_FILTERS, matchesTripFilters, tripDurationMinutes, tripSpecies } = context.exports;
const trip = { tripDate: "2026-06-10T10:00:00", endedAt: "2026-06-10T12:30:00", technique: "spinning", status: "completed", outcome: "recorded", fishRecords: [{ species: "Bass", count: 3 }, { species: "Bass", count: 2 }] };

test("history filters combine and date boundaries include the whole local start day", () => {
  const filters = { ...EMPTY_TRIP_FILTERS, from: "2026-06-10", to: "2026-06-10", species: "Bass", technique: "spinning", status: "completed", outcome: "recorded" };
  assert.equal(matchesTripFilters(trip, filters), true);
  for (const [key, value] of Object.entries({ species: "Bream", technique: "eging", status: "active", outcome: "zero", from: "2026-06-11", to: "2026-06-09" })) assert.equal(matchesTripFilters(trip, { ...filters, [key]: value }), false, key);
  assert.equal(matchesTripFilters({ ...trip, tripDate: "invalid" }, filters), false);
  assert.equal(matchesTripFilters(trip, EMPTY_TRIP_FILTERS), true);
});

test("empty catches never imply explicit zero and duration never uses completion time", () => {
  for (const outcome of ["zero", "not-recorded"]) {
    const empty = { ...trip, outcome, fishRecords: [], endedAt: null, completedAt: trip.endedAt };
    assert.equal(matchesTripFilters(empty, { ...EMPTY_TRIP_FILTERS, outcome: "zero" }), outcome === "zero");
    assert.equal(tripDurationMinutes(empty), undefined);
  }
  assert.equal(tripDurationMinutes(trip), 150);
  assert.equal(tripDurationMinutes({ ...trip, endedAt: "invalid" }), undefined);
  assert.equal(tripDurationMinutes({ ...trip, endedAt: "2020-01-01" }), undefined);
  assert.deepEqual([...tripSpecies(trip)], ["Bass"]);
});
