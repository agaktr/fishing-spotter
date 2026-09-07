import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

const compiled = ts.transpileModule(await readFile(new URL("./api.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const compiledDrafts = ts.transpileModule(await readFile(new URL("./drafts.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const compiledTripDraft = ts.transpileModule(await readFile(new URL("./tripDraft.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const compiledScan = ts.transpileModule(await readFile(new URL("./scanRequest.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const compiledAnalysis = ts.transpileModule(await readFile(new URL("../../components/SpotAnalysis.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const compiledMap = ts.transpileModule(await readFile(new URL("../../components/FishingMap.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const compiledJournal = ts.transpileModule(await readFile(new URL("../../components/TripJournal.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const historyContext = { exports: {} };
vm.runInNewContext(ts.transpileModule(await readFile(new URL("./tripHistory.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, historyContext);
const user = { id: "owner", username: "owner", displayName: "Owner", role: "user", active: true };
const session = { user, token: "test-bearer-not-a-real-secret", expiresAt: "2099-01-01T00:00:00Z" };

function harness(existingLocalStorage) {
  const storage = () => {
    const values = {};
    Object.defineProperties(values, {
      getItem: { value: (key) => values[key] ?? null },
      setItem: { value: (key, value) => { values[key] = String(value); } },
      removeItem: { value: (key) => { delete values[key]; } },
    });
    return values;
  };
  const sessionStorage = storage();
  const localStorage = existingLocalStorage ?? storage();
  const events = [];
  const requests = [];
  const replies = [];
  const listeners = new EventTarget();
  const context = { exports: {}, Headers, FormData, URL, Event, CustomEvent, sessionStorage, localStorage,
    window: { location: { origin: "https://fishing.ddev.site" }, dispatchEvent: (event) => { events.push(event); return listeners.dispatchEvent(event); }, addEventListener: (...args) => listeners.addEventListener(...args), removeEventListener: (...args) => listeners.removeEventListener(...args) },
    fetch: async (url, init) => {
      requests.push({ url: String(url), ...init, headers: new Headers(init.headers) });
      assert.ok(replies.length, "Every network response must be mocked; no real API calls are allowed");
      const { payload, status = 200 } = replies.shift();
      return new Response(status === 204 ? null : JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
    },
  };
  vm.runInNewContext(compiled, context);
  const api = context.exports;
  // Storage hooks are exercised directly; component rendering is separately checked with React SSR.
  const draftContext = { ...context, exports: {}, require: (id) => id === "react"
    ? { useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}], useRef: (value) => ({ current: value }), useEffect: (effect) => effect() }
    : api };
  vm.runInNewContext(compiledDrafts, draftContext);
  const modelContext = { ...context, exports: {}, require: () => draftContext.exports };
  vm.runInNewContext(compiledTripDraft, modelContext);
  const scanContext = { exports: {} };
  vm.runInNewContext(compiledScan, scanContext);
  const componentContext = { ...context, exports: {}, require: (id) => {
    if (id === "react/jsx-runtime") return jsxRuntime;
    if (id === "react") return React;
    if (id === "@/lib/client/drafts") return draftContext.exports;
    if (id === "@/lib/techniqueProfiles") return { TECHNIQUE_PROFILES: { spinning: { label: "Spinning", species: ["profile fallback"], baits: ["Profile bait"], rigs: ["Profile rig"], bestTimes: ["Profile time"], castingAdvice: "Profile casting guidance" } } };
    if (id === "@/lib/geo") return { round: (value, digits) => Number(value.toFixed(digits)) };
    if (id === "maplibre-gl") return {};
    if (id === "./TripPhotoMarker") return {};
    throw new Error(`Unexpected module: ${id}`);
  } };
  vm.runInNewContext(compiledAnalysis, componentContext);
  const analysis = componentContext.exports;
  const mapContext = { ...componentContext, exports: {} };
  vm.runInNewContext(compiledMap, mapContext);
  return { api, drafts: draftContext.exports, tripDraft: modelContext.exports, scan: scanContext.exports, analysis, map: mapContext.exports, sessionStorage, localStorage, events, requests, window: context.window,
    reply: (payload, status) => replies.push({ payload, status }),
    login: async (nextUser = user, remember = false) => { replies.push({ payload: { ...session, user: nextUser, token: `${session.token}:${nextUser.id}:${requests.length}` } }); return api.authenticate({ username: nextUser.username, password: "test-password" }, remember); },
  };
}

test("journal hides draft management, recovers forms quietly and restricts editing to owners", async () => {
  const h = harness();
  const context = { exports: {}, require: (id) => {
    if (id === "react") return React;
    if (id === "react/jsx-runtime") return jsxRuntime;
    if (id === "@/lib/client/api") return h.api;
    if (id === "@/lib/client/drafts") return h.drafts;
    if (id === "@/lib/client/tripDraft") return h.tripDraft;
    if (id === "@/lib/client/tripHistory") return historyContext.exports;
    if (id === "@/lib/techniqueProfiles") return { TECHNIQUE_PROFILES: {} };
    if (id === "./TripMediaGallery") return { TripMediaGallery: ({ images }) => React.createElement("span", null, `${images.length} images`) };
    throw new Error(`Unexpected module: ${id}`);
  } };
  vm.runInNewContext(compiledJournal, context);
  const trip = { id: "selected", userId: "owner", username: "owner", locationName: "Selected reef", techniqueLabel: "Spinning", tripDate: "2025-06-01T10:00:00Z", endedAt: "2025-06-01T12:00:00Z", status: "completed", recordingMode: "historical", visibility: "public", publicLocationPrecision: "approximate", outcome: "recorded", notes: "Shared trip notes", fishingMinutes: 90, anglerCount: 2, images: [], fishRecords: [{ id: "fish", species: "Sea bass", count: 3, weightKg: 1.5, weightBasis: "total", released: true, notes: "Shared catch notes", images: [] }] };
  const render = (viewer, selected = trip) => renderToStaticMarkup(React.createElement(context.exports.TripJournal, {
    user: viewer, trips: [{ ...trip, id: "unrelated", locationName: "Unrelated reef" }, selected], selectedTripId: selected.id, activeTrip: null,
  }));
  for (const viewer of [undefined, { ...user, id: "other" }, user]) {
    const html = render(viewer);
    for (const text of ["Selected reef", "Shared trip notes", "Shared catch notes", "3x Sea bass", "1.5kg", "90", h.drafts.displayDate(trip.tripDate)]) assert.ok(html.includes(text), text);
    assert.ok(!html.includes("Unrelated reef"));
    assert.equal(html.includes("Επεξεργασία"), viewer?.id === trip.userId);
    assert.ok(!/πρόχειρ|προχείρ|Ιδιωτική/.test(html));
    assert.ok(!html.includes("datetime-local"), "Details do not mount the editor or create a draft");
    assert.ok(html.includes("Τοποθεσία στον χάρτη"));
    assert.ok(!html.includes("Διαγραφή"), "Read-only details have no delete action");
  }
  assert.ok(render(undefined, { ...trip, outcome: "zero", fishRecords: [] }).includes("0 ψάρια"));
  assert.ok(render(undefined, { ...trip, outcome: "not-recorded", fishRecords: [] }).includes("Αποτέλεσμα μη καταγεγραμμένο"));
  await h.login();
  const destination = { name: "Recovery cove", lat: 36.76, lon: 22.56, technique: "spinning" };
  const subject = "new:spinning:36.76:22.56";
  const draft = { ...h.tripDraft.initialDraft(undefined, destination), notes: "Unsaved recovery sentinel" };
  h.drafts.writeDraft(user.id, subject, draft);
  const journal = (props = {}) => renderToStaticMarkup(React.createElement(context.exports.TripJournal, { user, trips: [trip], activeTrip: null, ...props }));
  const history = journal();
  assert.ok(history.includes("Ενεργές") && history.includes("Ολοκληρωμένες"));
  assert.ok(!/πρόχειρ|προχείρ|Unsaved recovery sentinel/.test(history));
  const editor = journal({ destination });
  assert.ok(editor.includes(draft.notes), "Opening the same form recovers unsaved fields without a resume action");
  assert.ok(!/πρόχειρ|προχείρ|πάντα ιδιωτική/.test(editor));
  assert.ok(editor.includes("Έναρξη εξόρμησης"));
  assert.equal(h.drafts.readDraft(user.id, subject).notes, draft.notes);
  assert.equal(draft.outcome, "zero");
  assert.ok(editor.includes('<option value="zero" selected="">'));
  assert.ok(!editor.includes("Προσθήκη ψαριού / ομοιογενούς ομάδας"));
  for (const status of ["active", "completed"]) {
    for (const outcome of ["zero", "recorded", "not-recorded"]) {
      assert.equal(h.tripDraft.initialDraft({ ...trip, status, outcome }).outcome, outcome);
    }
  }
  for (const outcome of ["recorded", "zero", "not-recorded", "", "recorded"]) {
    const restored = { ...draft, outcome, fishRecords: trip.fishRecords, fish: { ...draft.fish, species: "Pending catch" } };
    h.drafts.writeDraft(user.id, subject, restored);
    const html = journal({ destination });
    assert.equal(html.includes("Προσθήκη ψαριού / ομοιογενούς ομάδας"), outcome !== "zero");
    assert.ok(html.includes("3x Sea bass"), "Existing records remain accessible for every outcome");
    assert.equal(h.drafts.readDraft(user.id, subject).fish.species, "Pending catch");
    assert.equal(h.drafts.readDraft(user.id, subject).outcome, outcome);
    if (outcome === "zero") {
      assert.ok(html.includes("Οι εγγραφές δεν διαγράφηκαν"));
      assert.throws(() => h.tripDraft.tripUpdateFromDraft(restored), /Υπάρχουν ψάρια/);
    }
  }
  const spot = { weather: { validAt: "2025-06-01T10:00:00Z", fetchedAt: "2025-06-01T09:00:00Z", sourceCoordinates: { lat: 36.123, lon: 22.456 }, temporalMode: "forecast" }, marine: { validAt: "2025-06-01T11:00:00Z", fetchedAt: "2025-06-01T09:30:00Z", sourceCoordinates: { lat: 36.789, lon: 22.987 }, temporalMode: "historical" } };
  h.drafts.writeDraft(user.id, subject, { ...draft, destination: { ...destination, spot } });
  const metadataHtml = journal({ destination });
  for (const text of ["Ήλιος και σύννεφο", "Θαλάσσια κύματα", "36.123, 22.456", "36.789, 22.987", ...Object.values(spot).flatMap((item) => [h.drafts.displayDate(item.validAt), h.drafts.displayDate(item.fetchedAt)])]) assert.ok(metadataHtml.includes(text), text);
  h.drafts.writeDraft(user.id, subject, { ...draft, destination: { ...destination, spot: { weather: { sourceSnapshot: spot.weather }, marine: {} } } });
  const legacyMetadata = journal({ destination });
  assert.ok(legacyMetadata.includes("36.123, 22.456"));
  assert.ok(legacyMetadata.includes("χωρίς χρονική αντιστοίχιση"));
  assert.ok(legacyMetadata.includes("Μη διαθέσιμες"));
});

test("trip layers are unclustered and all nearby photo fans render without zoom or source-feature gating", () => {
  const sources = {}, layers = [], handlers = [], effects = [], selected = [];
  let stateIndex = 0, refIndex = 0;
  const map = {
    addControl() {},
    addSource: (id, source) => { sources[id] = source; },
    addLayer: (layer) => layers.push(layer),
    getStyle: () => ({ layers }),
    on: (...args) => handlers.push(args),
  };
  const context = { exports: {}, require: (id) => {
    if (id === "react/jsx-runtime") return jsxRuntime;
    if (id === "react") return {
      useState: (value) => [stateIndex++ === 0 ? map : value, () => {}],
      useRef: (value) => ({ current: refIndex++ === 1 ? {} : value }),
      useEffect: (effect) => effects.push(effect),
    };
    if (id === "maplibre-gl") return { default: { Map: class { constructor() { return map; } }, NavigationControl: class {}, ScaleControl: class {} } };
    if (id === "./TripPhotoMarker") return { TripPhotoMarker: () => null, tripMapPhotos: (trip) => trip.images };
    if (id === "@/lib/geo") return {};
    throw new Error(`Unexpected module: ${id}`);
  } };
  vm.runInNewContext(compiledMap, context);
  const trips = Array.from({ length: 30 }, (_, i) => ({ id: `trip-${i}`, lat: 36.76, lon: 22.56 + i * 0.00001, images: [{ id: `photo-${i}` }] }));
  const tree = context.exports.FishingMap({ spots: [], radiusKm: 25, trips: [...trips, { ...trips[0], id: "invalid", lat: NaN }, { ...trips[0], id: "no-photo", images: [] }], selectedTripId: "trip-2", onSelectTrip: (id) => selected.push(id) });
  effects.slice(0, 4).forEach((effect) => effect());
  handlers.find(([event]) => event === "load")[1]();
  assert.equal(sources.trips.cluster, undefined);
  assert.equal(sources.trips.clusterRadius, undefined);
  assert.equal(sources.trips.clusterMaxZoom, undefined);
  assert.ok(!layers.some(({ id }) => id.includes("cluster")));
  assert.ok(!handlers.some(([, layer]) => typeof layer === "string" && layer.includes("cluster")));
  for (const layer of layers.filter(({ source }) => ["trips", "selected-trip"].includes(source))) {
    assert.equal(layer.filter, undefined);
    assert.equal(layer.minzoom, undefined);
    assert.equal(layer.maxzoom, undefined);
  }
  const fans = tree.props.children[1];
  assert.deepEqual(Array.from(fans, ({ props }) => props.trip.id), trips.map(({ id }) => id));
  assert.equal(fans.filter(({ props }) => props.selected).length, 1);
  fans[2].props.onSelect();
  handlers.find(([event, layer]) => event === "click" && layer === "trips-circle")[2]({ features: [{ properties: { id: "trip-4" } }] });
  assert.deepEqual(selected, ["trip-2", "trip-4"]);
});

test("map pins and cleared results preserve camera; selection and explicit recenter preserve zoom", () => {
  const refs = [], dependencies = [], pending = [], camera = [], data = [];
  let refIndex = 0, effectIndex = 0, stateIndex = 0, recenterKey = 0;
  const map = {
    getSource: (id) => ({ setData: (value) => data.push({ id, value }) }),
    getLayer: () => true,
    setLayoutProperty() {},
    setFeatureState() {},
    getCanvas: () => ({ style: {}, focus() {} }),
    doubleClickZoom: { enable() {} },
    getContainer: () => ({ clientWidth: 1440, clientHeight: 1200 }),
    easeTo: (options) => camera.push(options),
    flyTo: (options) => camera.push(options),
    fitBounds: (bounds, options) => camera.push(options),
    off() {},
    on() {},
  };
  const context = { exports: {}, require: (id) => {
    if (id === "react/jsx-runtime") return jsxRuntime;
    if (id === "react") return {
      useState: (value) => [stateIndex++ === 0 ? map : value, () => {}],
      useRef: (value) => {
        const index = refIndex++;
        return refs[index] ?? (refs[index] = { current: value });
      },
      useEffect: (effect, deps) => {
        const index = effectIndex++;
        if (!dependencies[index] || deps.some((value, i) => !Object.is(value, dependencies[index][i]))) pending.push(effect);
        dependencies[index] = deps;
      },
    };
    if (id === "maplibre-gl") return { default: { LngLatBounds: class { extend() {} } } };
    if (id === "./TripPhotoMarker") return { tripMapPhotos: () => [] };
    if (id === "@/lib/geo") return { round: (value, digits) => Number(value.toFixed(digits)) };
    throw new Error(`Unexpected module: ${id}`);
  } };
  vm.runInNewContext(compiledMap, context);
  const render = (props = {}) => {
    refIndex = 0; effectIndex = 0; stateIndex = 0;
    recenterKey = props.recenterKey ?? recenterKey;
    context.exports.FishingMap({ spots: [], radiusKm: 25, baseLayer: "street", recenterKey, ...props });
    refs[2].current = map; // Supply the map ref without mounting a WebGL canvas.
    pending.splice(0).forEach((effect) => effect());
  };
  render();
  render({ pickedPoint: { lat: 36.76, lon: 22.56 } });
  assert.equal(camera.length, 0);
  assert.equal(data.filter(({ id }) => id === "picked-point").at(-1).value.features.length, 1);
  render({ selectedSpotId: "spot", spots: [{ id: "spot", lat: 36.77, lon: 22.57 }] });
  assert.equal(camera.length, 1);
  render({ pickedPoint: { lat: 36.78, lon: 22.58 } });
  render();
  assert.equal(camera.length, 1, "clearing selection, results and pin must not move camera");
  render({ pickedPoint: { lat: 36.78, lon: 22.58 }, recenterKey: 1 });
  assert.equal(camera.length, 2);
  assert.deepEqual(Array.from(camera[1].center), [22.58, 36.78]);
  assert.ok(camera.every((options) => !("zoom" in options)));
  const point = { lat: 36.78, lon: 22.58 };
  const trips = [{ ...point, id: "trip", fishCaught: [] }];
  render({ pickedPoint: point, trips });
  render({ trips });
  assert.equal(camera.length, 2, "clearing the pin must not trigger a deferred trip fit");
  render({ mode: "point", pointAnalysis: { requestedPoint: point, analyzedPoint: point },
    selectedSpotId: "analysis", spots: [{ ...point, id: "analysis", depth: { hasNearbyWater: true, castingProfile: [] } }] });
  assert.equal(camera.length, 4);
  assert.equal(camera.at(-1).maxZoom, 16, "new analysis fitting must run after selection recentering");
  render();
  assert.equal(camera.length, 4, "clearing analysis must preserve the fitted camera");
  const tripFocus = { id: "trip", lat: 36.8, lon: 22.6, revision: 1 };
  render({ tripFocus });
  assert.deepEqual(Array.from(camera.at(-1).center), [22.6, 36.8]);
  assert.equal(camera.at(-1).zoom, 14);
  assert.deepEqual(Array.from(camera.at(-1).offset), [0, 0]);
  const focusedCount = camera.length;
  render({ tripFocus });
  assert.equal(camera.length, focusedCount, "unrelated renders must not refocus a trip");
  render({ tripFocus: { ...tripFocus, revision: 2 } });
  assert.equal(camera.length, focusedCount + 1, "the same trip can be explicitly focused again");
  const repeatedFocus = { ...tripFocus, revision: 3 };
  render({ tripFocus: repeatedFocus });
  const beforeRefresh = camera.length;
  render({ tripFocus: repeatedFocus, trips: [{ ...trips[0], id: "newly-loaded" }] });
  assert.equal(camera.length, beforeRefresh, "a delayed trip refresh must not override explicit trip focus");
  render({ tripFocus: repeatedFocus, trips, selectedTripId: "trip" });
  assert.equal(data.filter(({ id }) => id === "trips").at(-1).value.features.length, 0, "selected trip must not render a duplicate ordinary pin");
  assert.equal(data.filter(({ id }) => id === "selected-trip").at(-1).value.features[0].properties.id, "trip");
  assert.equal(camera.length, beforeRefresh, "trip selection alone must not change the camera");
  const nearbyTrips = Array.from({ length: 30 }, (_, i) => ({ ...trips[0], id: `nearby-${i}`, lon: point.lon + i * 0.00001 }));
  render({ tripFocus: repeatedFocus, trips: nearbyTrips, selectedTripId: "nearby-2" });
  const ordinary = data.filter(({ id }) => id === "trips").at(-1).value.features;
  const highlighted = data.filter(({ id }) => id === "selected-trip").at(-1).value.features;
  assert.equal(ordinary.length, 29);
  assert.equal(highlighted.length, 1);
  assert.deepEqual([...ordinary, ...highlighted].map(({ id }) => id).sort(), nearbyTrips.map(({ id }) => id).sort());
  assert.equal(camera.length, beforeRefresh);
});

test("map photos include trip and fish images only for owner or explicit public sharing", async () => {
  const code = ts.transpileModule(await readFile(new URL("../../components/TripPhotoMarker.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const context = { exports: {}, require: () => ({}) };
  vm.runInNewContext(code, context);
  const trip = { userId: "owner", visibility: "public", status: "completed", sharedMediaIds: ["fish"], images: [{ id: "trip" }], fishRecords: [{ images: [{ id: "fish" }, { id: "trip" }] }] };
  const ids = (value, viewer) => Array.from(context.exports.tripMapPhotos(value, viewer), (image) => image.id);
  assert.deepEqual(ids(trip, "owner"), ["trip", "fish"]);
  assert.deepEqual(ids(trip, "other"), ["fish"]);
  assert.deepEqual(ids(trip), ["fish"]);
  assert.deepEqual(ids({ ...trip, visibility: "private" }, "other"), []);
  assert.deepEqual(ids({ ...trip, status: "active" }), []);
  assert.deepEqual(ids({ ...trip, sharedMediaIds: [] }), []);
  const effects = [];
  let removed = false;
  const map = { getStyle: () => removed ? undefined : { sources: { trips: {} } }, setFeatureState: () => assert.ok(!removed) };
  const component = { exports: {}, document: { createElement: () => ({}) }, require: (id) => {
    if (id === "react") return { useState: (value) => [typeof value === "function" ? value() : value, () => {}], useEffect: (effect) => effects.push(effect) };
    if (id === "react-dom") return { createPortal: () => null };
    if (id === "react/jsx-runtime") return jsxRuntime;
    return {};
  } };
  vm.runInNewContext(code, component);
  component.exports.TripPhotoMarker({ map, trip: { ...trip, id: "trip" }, userId: "owner", onSelect() {} });
  const cleanup = effects[2]();
  removed = true;
  assert.doesNotThrow(cleanup, "logout may remove the parent map before photo marker cleanup");
});

test("photo fan fills three valid slots, keeps total count and revokes blobs on session end", async () => {
  const code = ts.transpileModule(await readFile(new URL("../../components/TripPhotoMarker.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const states = [], effects = [], requests = [], revoked = [], listeners = new Map();
  let cursor = 0, selected = 0, resolveLate;
  const context = { exports: {}, document: { createElement: () => ({}) },
    window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) },
    URL: { createObjectURL: (blob) => `blob:${blob}`, revokeObjectURL: (url) => revoked.push(url) },
    Image: class { async decode() { if (this.src === "blob:bad") throw Error("decode"); } },
    require: (id) => {
      if (id === "react") return { useState: (initial) => { const i = cursor++; if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial; return [states[i], (value) => { states[i] = value; }]; }, useEffect: (effect) => effects.push(effect) };
      if (id === "react-dom") return { createPortal: (node) => node };
      if (id === "react/jsx-runtime") return jsxRuntime;
      if (id === "@/lib/client/api") return { SESSION_ENDED_EVENT: "ended", fetchTripImage: async (url) => { requests.push(url); if (url === "fail") throw Error("fetch"); if (url === "late") return new Promise((resolve) => { resolveLate = resolve; }); return url; } };
      return {};
    },
  };
  vm.runInNewContext(code, context);
  let trip = { id: "trip", userId: "owner", locationName: "Coast", images: ["fail", "bad", "one", "two", "three", "unused"].map((id) => ({ id, thumbnailUrl: id })), fishRecords: [] };
  const render = () => { cursor = 0; effects.length = 0; return context.exports.TripPhotoMarker({ map: {}, trip, userId: "owner", selected: false, onSelect: () => selected++ }); };
  render();
  const cleanup = effects[1]();
  await new Promise(setImmediate);
  let button = render();
  assert.deepEqual(requests, ["fail", "bad", "one", "two", "three"]);
  assert.equal(button.props["data-cards"], 3);
  assert.match(button.props["aria-label"], /6 /);
  assert.equal(button.props.children[1].props.children, 6);
  button.props.onClick({ stopPropagation() {} });
  assert.equal(selected, 1);
  listeners.get("ended")();
  assert.equal(render().props["data-ready"], false);
  cleanup();
  assert.deepEqual(revoked.sort(), ["blob:bad", "blob:one", "blob:three", "blob:two"]);
  for (const count of [0, 1, 2, 3, 5]) {
    trip = { ...trip, images: Array.from({ length: count }, (_, i) => ({ id: `${i}`, thumbnailUrl: `${i}` })) };
    assert.equal(render().props["data-ready"], false, "changed media must not expose stale cards");
    const clear = effects[1]();
    await new Promise(setImmediate);
    assert.equal(render().props["data-cards"], Math.min(count, 3));
    clear();
  }
  trip = { ...trip, images: [{ id: "late", thumbnailUrl: "late" }] };
  render();
  const clear = effects[1]();
  clear();
  resolveLate("late");
  await new Promise(setImmediate);
  assert.equal(render().props["data-ready"], false);
  assert.ok(!revoked.includes("blob:late"), "cancelled fetch must not create an object URL");
});

test("password login and restoration use the bearer contract, not username restoration", async () => {
  const h = harness();
  h.reply(session);
  await h.api.authenticate({ username: "owner", password: "test-password" }, false);
  assert.equal(h.sessionStorage.getItem(h.api.TOKEN_KEY), session.token);
  assert.equal(h.localStorage.getItem(h.api.TOKEN_KEY), null);
  assert.deepEqual(JSON.parse(h.requests[0].body), { username: "owner", password: "test-password" });
  assert.equal(h.requests[0].url, "/api/session");
  assert.equal(h.requests[0].headers.has("Authorization"), false);
  h.reply({ user });
  await h.api.restoreSession();
  assert.equal(h.requests[1].url, "/api/session");
  assert.equal(h.requests[1].method ?? "GET", "GET");
  assert.equal(h.requests[1].body, undefined);
  assert.equal(h.requests[1].headers.get("Authorization"), `Bearer ${session.token}`);
});

test("activation, explicit remembered storage and legacy username-only rejection", async () => {
  const h = harness();
  h.reply({ user });
  await assert.rejects(h.api.authenticate({ username: "owner", password: "test-password" }, false));
  assert.equal(h.api.sessionToken(), undefined);
  h.reply(session);
  await h.api.authenticate({ username: "owner", invitationToken: "test-invitation", password: "test-password" }, true);
  assert.equal(h.requests[1].url, "/api/activate");
  assert.equal(h.localStorage.getItem(h.api.TOKEN_KEY), session.token);
  assert.equal(h.sessionStorage.getItem(h.api.TOKEN_KEY), null);
});

test("private API operations and media use headers only, with nested scan responses", async () => {
  const h = harness();
  h.sessionStorage.setItem(h.api.TOKEN_KEY, session.token);
  const scan = { id: "scan", response: { spots: [] }, request: { mode: "point", saveHistory: false } };
  const cases = [
    [() => h.api.fetchUsers(), { users: [] }],
    [() => h.api.createUser("new", "New"), { user, invitationToken: "invite", expiresAt: session.expiresAt }],
    [() => h.api.issueInvitation("owner"), { invitationToken: "invite", expiresAt: session.expiresAt }],
    [() => h.api.updateUser("owner", { active: false }), { user }],
    [() => h.api.fetchTrips("mine"), { trips: [] }],
    [() => h.api.fetchActiveTrip(), { trip: null }],
    [() => h.api.fetchTrip("trip"), { trip: {} }],
    [() => h.api.createTrip({ recordingMode: "live", visibility: "private" }), { trip: {} }],
    [() => h.api.updateTrip("trip", { endedAt: "2026-01-01T00:00:00Z", outcome: "zero", status: "completed" }), { trip: {} }],
    [() => h.api.deleteTrip("trip"), null, 204],
    [() => h.api.deleteTripImage("trip", "image"), { trip: {} }],
    [() => h.api.uploadTripImage("trip", new File(["image"], "fish.png", { type: "image/png" }), "fish-id"), { trip: {} }],
    [() => h.api.fetchSavedPlaces(), { places: [] }],
    [() => h.api.savePlace({ name: "Place", lat: 36, lon: 22, technique: "spinning", notes: "" }), { place: {} }],
    [() => h.api.deletePlace("place"), null, 204],
    [() => h.api.fetchScans(), { scans: [] }],
    [async () => assert.deepEqual(await h.api.fetchScan("scan"), scan), { scan }],
    [() => h.api.deleteScans("scan"), null, 204],
    [() => h.api.deleteScans(), null, 204],
    [() => h.api.fetchInsights(), { summary: {}, groups: [] }],
    [() => h.api.fetchTripImage("/api/trip-media/image"), {}],
  ];
  for (const [operation, payload, status] of cases) { h.reply(payload, status); await operation(); }
  for (const request of h.requests) {
    assert.equal(request.headers.get("Authorization"), `Bearer ${session.token}`);
    assert.equal(request.headers.has("X-Fishing-User"), false);
    assert.equal(request.url.includes(session.token), false);
    assert.equal(request.cache, "no-store");
    assert.equal(request.redirect, "error");
  }
  const upload = h.requests.find((request) => request.body instanceof FormData);
  assert.equal(upload.body.get("fishRecordId"), "fish-id");
  assert.equal(upload.headers.has("Content-Type"), false, "Fetch must supply the multipart boundary");
  await assert.rejects(h.api.fetchTripImage("https://external.invalid/image"));
  assert.equal(h.requests.length, cases.length);
});

test("structured searches preserve explicit privacy and forecast fields", async () => {
  const h = harness();
  const request = { technique: "spinning", location: "Test coast", targetSpecies: "test", fishingAt: "2026-09-06T05:00:00Z", mode: "point", coordinates: { lat: 36, lon: 22 }, radiusKm: 25, resultLimit: 24, saveHistory: false };
  h.reply({ spots: [] });
  await h.api.searchSpots(request);
  assert.deepEqual(JSON.parse(h.requests[0].body), request);
  assert.equal(h.requests[0].headers.has("Authorization"), false);
});

test("logout revokes the bearer and clears persisted per-user drafts even on failure", async () => {
  const h = harness();
  h.sessionStorage.setItem(h.api.TOKEN_KEY, session.token);
  h.localStorage.setItem(h.api.TOKEN_KEY, session.token);
  h.sessionStorage.setItem(`${h.api.DRAFT_PREFIX}owner:trip`, "private draft");
  h.sessionStorage.setItem("unrelated", "keep");
  h.reply({ error: "unavailable" }, 503);
  await assert.rejects(h.api.revokeSession());
  assert.equal(h.requests[0].method, "DELETE");
  assert.equal(h.requests[0].headers.get("Authorization"), `Bearer ${session.token}`);
  assert.equal(h.api.sessionToken(), undefined);
  assert.equal(h.sessionStorage.getItem(`${h.api.DRAFT_PREFIX}owner:trip`), null);
  assert.equal(h.sessionStorage.getItem("unrelated"), "keep");
  assert.ok(h.events.some((event) => event.type === h.api.SESSION_ENDED_EVENT && event.detail.reason === "logout"));
});

test("401 preserves scoped drafts and continuation but locks all reads until same-account verification", async () => {
  const h = harness();
  await h.login();
  const destination = { name: "Private origin", lat: 36, lon: 22, technique: "spinning" };
  h.drafts.writeDraft("owner", "new:point", { notes: "private draft", destination, fish: { species: "pending" } });
  h.drafts.writeContinuation("owner", { panel: "trips", panelOpen: true, destination });
  h.reply({ error: "expired" }, 401);
  await assert.rejects(h.api.fetchSavedPlaces());
  assert.equal(h.api.sessionToken(), undefined);
  assert.ok(h.localStorage.getItem(`${h.api.DRAFT_PREFIX}owner:new:point`));
  assert.equal(h.drafts.listDrafts("owner").length, 0);
  assert.equal(h.drafts.readDraft("owner", "new:point"), undefined);
  assert.equal(h.drafts.readContinuation("owner"), undefined);
  h.reply({ error: "invalid password" }, 401);
  await assert.rejects(h.api.authenticate({ username: "owner", password: "incorrect" }, false));
  assert.equal(h.drafts.listDrafts("owner").length, 0);
  await h.login();
  assert.equal(h.drafts.readDraft("owner", "new:point").notes, "private draft");
  assert.equal(h.drafts.readDraft("owner", "new:point").fish.species, "pending");
  assert.equal(h.drafts.readContinuation("owner").destination.name, "Private origin");
  assert.equal(h.drafts.listDrafts("owner")[0].subject, "new:point");
});

test("a delayed logout response cannot clear a replacement session", async () => {
  const h = harness();
  h.sessionStorage.setItem(h.api.TOKEN_KEY, session.token);
  h.reply(null, 204);
  const pending = h.api.revokeSession();
  h.sessionStorage.setItem(h.api.TOKEN_KEY, "replacement-test-token");
  await assert.rejects(pending);
  assert.equal(h.api.sessionToken(), "replacement-test-token");
});

test("draft persistence isolates users, preserves unrelated fields, resumes and clears on save/discard", async () => {
  const h = harness();
  await h.login();
  const { draftKey, usePersistentDraft, localDateTime } = h.drafts;
  const ownerKey = draftKey("owner", "trip");
  const otherKey = draftKey("other", "trip");
  const initial = () => ({ notes: "", date: "2026-09-01T12:34:56", effort: "", fish: { species: "" } });
  const draft = usePersistentDraft("owner", "trip", initial);
  draft.change((previous) => ({ ...previous, notes: "unsaved notes", date: "2026-09-02T12:34:56", effort: "90" }));
  draft.change((previous) => ({ ...previous, fish: { species: "pending fish", count: "2", weightBasis: "total" } }));
  const resumed = usePersistentDraft("owner", "trip", initial);
  assert.equal(resumed.value.notes, "unsaved notes");
  assert.equal(resumed.value.date, "2026-09-02T12:34:56");
  assert.equal(resumed.value.effort, "90");
  assert.equal(resumed.value.fish.species, "pending fish");
  assert.equal(usePersistentDraft("other", "trip", initial).value.notes, "");
  assert.equal(h.localStorage.getItem(otherKey), null);
  resumed.reset(initial());
  assert.equal(h.localStorage.getItem(ownerKey), null);
  assert.equal(usePersistentDraft("owner", "trip", initial).value.notes, "");
  assert.equal(localDateTime("2026-09-01T12:34:56Z", true).slice(-3), ":56");
  assert.equal(localDateTime("invalid"), "");
});

test("a new-point draft survives a browser restart and is rediscoverable only after verified login", async () => {
  const first = harness();
  await first.login();
  const destination = { name: "Private new point", lat: 36.12, lon: 22.34, technique: "spinning" };
  const subject = "new:spinning:36.12:22.34";
  const initial = () => first.tripDraft.initialDraft(undefined, destination);
  const draft = first.drafts.usePersistentDraft("owner", subject, initial);
  draft.change((previous) => ({ ...previous, notes: "Restart notes", fishingMinutes: "75", anglerCount: "2", fish: { ...previous.fish, species: "Pending fish", weightKg: "2", count: "3", weightBasis: "total" } }));
  first.drafts.writeContinuation("owner", { panel: "trips", panelOpen: true, destination });
  const restarted = harness(first.localStorage);
  assert.equal(await restarted.api.restoreSession(), undefined);
  assert.equal(restarted.drafts.listDrafts("owner").length, 0);
  assert.equal(restarted.drafts.readContinuation("owner"), undefined);
  await restarted.login();
  const entries = restarted.drafts.listDrafts("owner");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].subject, subject);
  assert.equal(entries[0].value.destination.name, destination.name);
  const resumed = restarted.drafts.usePersistentDraft("owner", subject, initial).value;
  assert.equal(resumed.notes, "Restart notes");
  assert.equal(resumed.fishingMinutes, "75");
  assert.equal(resumed.anglerCount, "2");
  assert.equal(resumed.fish.weightBasis, "total");
  assert.equal(restarted.drafts.readContinuation("owner").destination.lat, 36.12);
});

test("old tab-only drafts migrate without being disclosed to guests", async () => {
  const h = harness();
  const key = `${h.api.DRAFT_PREFIX}owner:new:point`;
  h.sessionStorage.setItem(key, JSON.stringify({ notes: "Existing draft", destination: { name: "Prior point" } }));
  assert.equal(h.drafts.readDraft("owner", "new:point"), undefined);
  await h.login();
  assert.equal(h.drafts.listDrafts("owner")[0].value.notes, "Existing draft");
  assert.equal(h.sessionStorage.getItem(key), null);
  assert.ok(h.localStorage.getItem(key));
});

test("same-account activation preserves drafts, account switching clears old private data", async () => {
  const h = harness();
  await h.login();
  h.drafts.writeDraft("owner", "trip", { notes: "private", destination: { name: "Owner coast" } });
  h.drafts.writeContinuation("owner", { destination: { name: "Owner origin" } });
  h.api.clearSession("expired");
  h.reply({ ...session, token: "activated-replacement" });
  await h.api.authenticate({ username: "owner", password: "new-password", invitationToken: "new-invitation" }, false);
  assert.equal(h.drafts.readDraft("owner", "trip").notes, "private");
  await h.login({ ...user, id: "other", username: "other" });
  assert.equal(h.drafts.readDraft("owner", "trip"), undefined);
  assert.equal(h.localStorage.getItem(`${h.api.DRAFT_PREFIX}owner:trip`), null);
  assert.equal(h.localStorage.getItem(`${h.api.CONTINUATION_PREFIX}owner`), null);
  assert.equal(h.drafts.listDrafts("other").length, 0);
  assert.ok(h.events.some((event) => event.detail?.reason === "account-switch"));
});

test("explicit logout clears local drafts and continuation even when DELETE returns expired", async () => {
  const h = harness();
  await h.login(user, true);
  h.drafts.writeDraft("owner", "trip", { notes: "private" });
  h.drafts.writeContinuation("owner", { destination: { name: "private" } });
  h.localStorage.setItem("unrelated", "keep");
  h.reply({ error: "expired" }, 401);
  await assert.rejects(h.api.revokeSession());
  assert.equal(h.localStorage.getItem(`${h.api.DRAFT_PREFIX}owner:trip`), null);
  assert.equal(h.localStorage.getItem(`${h.api.CONTINUATION_PREFIX}owner`), null);
  assert.equal(h.localStorage.getItem(h.api.ACCOUNT_KEY), null);
  assert.equal(h.localStorage.getItem("unrelated"), "keep");
});

test("expired media credentials preserve drafts, and a new guest intent takes priority over locked continuation", async () => {
  const h = harness();
  await h.login();
  h.drafts.writeDraft("owner", "trip", { notes: "photo upload must not discard this" });
  h.drafts.writeContinuation("owner", { destination: { name: "Private prior origin" } });
  h.reply({ error: "expired" }, 401);
  await assert.rejects(h.api.fetchTripImage("/api/trip-media/image"));
  assert.equal(h.drafts.readContinuation("owner"), undefined);
  await h.login();
  assert.equal(h.drafts.readDraft("owner", "trip").notes, "photo upload must not discard this");
  assert.equal(h.drafts.readContinuation("owner", true), undefined, "A new guest choice must not be replaced by the old private origin");
  h.drafts.writeContinuation("owner", { destination: { name: "Guest selected new origin" } });
  assert.equal(h.drafts.readContinuation("owner").destination.name, "Guest selected new origin");
});

test("an expiry notification can preserve the latest continuation before credentials lock it", async () => {
  const h = harness();
  await h.login();
  h.window.addEventListener(h.api.SESSION_ENDED_EVENT, (event) => {
    if (event.detail.reason === "expired") h.drafts.writeContinuation("owner", { selectedTripId: "active-outside-page", panel: "trips", panelOpen: true });
  });
  h.reply({ error: "expired" }, 401);
  await assert.rejects(h.api.fetchActiveTrip());
  assert.equal(h.drafts.readContinuation("owner"), undefined);
  await h.login();
  assert.equal(h.drafts.readContinuation("owner").selectedTripId, "active-outside-page");
});

test("cross-tab account switching removes old private data without deleting the replacement credential", async () => {
  const h = harness();
  await h.login();
  h.drafts.writeDraft("owner", "trip", { notes: "private owner draft" });
  h.localStorage.setItem(h.api.TOKEN_KEY, "other-account-token");
  h.localStorage.setItem(h.api.ACCOUNT_KEY, "other");
  h.api.syncStoredSession();
  assert.equal(h.sessionStorage.getItem(h.api.TOKEN_KEY), null);
  assert.equal(h.localStorage.getItem(h.api.TOKEN_KEY), "other-account-token");
  assert.equal(h.api.verifiedUserId(), undefined);
  assert.equal(h.drafts.readDraft("owner", "trip"), undefined);
  assert.equal(h.localStorage.getItem(`${h.api.DRAFT_PREFIX}owner:trip`), null);
  h.reply({ user: { ...user, id: "other", username: "other" } });
  await h.api.restoreSession();
  assert.equal(h.api.verifiedUserId(), "other");
});

test("cross-tab same-account credential replacement locks but preserves drafts", async () => {
  const h = harness();
  await h.login(user, true);
  h.drafts.writeDraft("owner", "trip", { notes: "preserve during token refresh" });
  h.localStorage.setItem(h.api.TOKEN_KEY, "same-account-replacement");
  h.api.syncStoredSession();
  assert.equal(h.api.verifiedUserId(), undefined);
  assert.equal(h.drafts.readDraft("owner", "trip"), undefined);
  assert.ok(h.localStorage.getItem(`${h.api.DRAFT_PREFIX}owner:trip`));
  h.reply({ user });
  await h.api.restoreSession();
  assert.equal(h.drafts.readDraft("owner", "trip").notes, "preserve during token refresh");
});

test("an unverified stored bearer cannot expose owner-exact fields through the guest public feed", async () => {
  const h = harness();
  h.localStorage.setItem(h.api.TOKEN_KEY, "stored-but-not-verified");
  h.reply({ trips: [] });
  await h.api.fetchTrips("public");
  assert.equal(h.requests[0].headers.has("Authorization"), false);
  h.reply({ user });
  await h.api.restoreSession();
  h.reply({ trips: [] });
  await h.api.fetchTrips("public");
  assert.equal(h.requests[2].headers.get("Authorization"), "Bearer stored-but-not-verified");
});

test("successful authentication replaces both browser credential stores before later explicit logout", async () => {
  const h = harness();
  await h.login();
  h.localStorage.setItem(h.api.TOKEN_KEY, "old-remembered-credential");
  await h.login({ ...user, id: "other", username: "other" });
  assert.equal(h.localStorage.getItem(h.api.TOKEN_KEY), null);
  h.reply(null, 204);
  await h.api.revokeSession();
  assert.equal(h.api.sessionToken(), undefined);
});

const legacyTrip = {
  id: "legacy", userId: "owner", username: "owner", locationName: "Legacy coast", lat: 36, lon: 22, technique: "spinning",
  tripDate: "2025-06-01T10:00:00.125Z", completedAt: "2025-06-02T18:00:00Z", endedAt: null,
  recordingMode: "historical", status: "completed", visibility: "private", outcome: "not-recorded",
  notes: "old notes", fishRecords: [], images: [], fishingMinutes: null, anglerCount: null, conditionsRecordedAt: null,
};

test("legacy completed trips allow note and fish corrections without inventing actual end", () => {
  const h = harness();
  const draft = h.tripDraft.initialDraft(legacyTrip);
  draft.notes = "corrected notes";
  let result = h.tripDraft.tripUpdateFromDraft(draft, legacyTrip);
  assert.equal(result.fields.endedAt, null);
  assert.equal(result.fields.tripDate, legacyTrip.tripDate);
  assert.equal(result.fields.notes, "corrected notes");
  assert.equal(result.fields.status, undefined);
  assert.equal(result.fields.completedAt, undefined);
  const photo = { id: "keep-photo" };
  const fish = { id: "keep-fish", species: "corrected fish", count: 2, weightKg: 1, weightBasis: "total", released: true, images: [] };
  draft.outcome = "recorded";
  draft.fishRecords = [fish];
  result = h.tripDraft.tripUpdateFromDraft(draft, { ...legacyTrip, fishRecords: [{ ...fish, images: [photo] }] });
  assert.equal(result.fields.endedAt, null);
  assert.equal(result.fields.fishRecords[0].id, "keep-fish");
  assert.equal(result.fields.fishRecords[0].images[0].id, "keep-photo");
});

test("only new historical/completion requires an actual end, and legacy public active completion is private", () => {
  const h = harness();
  const active = { ...legacyTrip, status: "active", visibility: "public", recordingMode: "live" };
  const draft = h.tripDraft.initialDraft(active);
  draft.completing = true; draft.outcome = "zero";
  assert.throws(() => h.tripDraft.tripUpdateFromDraft(draft, active));
  draft.endedAt = h.drafts.localDateTime("2025-06-01T12:00:00Z", true);
  const { fields } = h.tripDraft.tripUpdateFromDraft(draft, active);
  assert.equal(fields.visibility, "private");
  assert.equal(fields.status, "completed");
  assert.equal(fields.endedAt, "2025-06-01T12:00:00.000Z");
  assert.equal(fields.completedAt, undefined);
  const historical = { ...draft, recordingMode: "historical", completing: false, endedAt: "" };
  assert.throws(() => h.tripDraft.tripUpdateFromDraft(historical));
  historical.endedAt = draft.endedAt;
  assert.equal(h.tripDraft.tripUpdateFromDraft(historical).fields.outcome, "zero");
  historical.endedAt = h.drafts.localDateTime("2025-05-31T10:00:00Z", true);
  assert.throws(() => h.tripDraft.tripUpdateFromDraft(historical));
  historical.endedAt = h.drafts.localDateTime("2099-01-01T00:00:00Z", true);
  assert.throws(() => h.tripDraft.tripUpdateFromDraft(historical));
});

test("effort is positive, deferred during active saves, retained in drafts and submitted at actual completion", async () => {
  const h = harness();
  await h.login();
  const active = { ...legacyTrip, recordingMode: "live", status: "active" };
  const draft = h.tripDraft.initialDraft(active);
  draft.fishingMinutes = "0";
  assert.throws(() => h.tripDraft.tripUpdateFromDraft(draft, active));
  draft.fishingMinutes = "90"; draft.anglerCount = "2";
  const pending = h.tripDraft.tripUpdateFromDraft(draft, active);
  assert.equal(pending.deferredEffort, true);
  assert.equal(pending.fields.endedAt, null);
  assert.equal(pending.fields.fishingMinutes, null);
  assert.equal(pending.fields.anglerCount, null);
  const retained = h.tripDraft.draftAfterSave({ ...active, ...pending.fields }, draft, pending.deferredEffort);
  h.drafts.writeDraft("owner", active.id, retained);
  const resumed = h.drafts.readDraft("owner", active.id);
  assert.equal(resumed.fishingMinutes, "90");
  assert.equal(resumed.anglerCount, "2");
  resumed.completing = true; resumed.outcome = "zero"; resumed.endedAt = h.drafts.localDateTime("2025-06-01T12:00:00Z", true);
  const completed = h.tripDraft.tripUpdateFromDraft(resumed, active);
  assert.equal(completed.deferredEffort, false);
  assert.equal(completed.fields.fishingMinutes, 90);
  assert.equal(completed.fields.anglerCount, 2);
  resumed.fishingMinutes = "122";
  assert.throws(() => h.tripDraft.tripUpdateFromDraft(resumed, active));
  resumed.fishingMinutes = ""; resumed.anglerCount = "";
  assert.equal(h.tripDraft.tripUpdateFromDraft(resumed, active).fields.fishingMinutes, null);
});

test("new live saves transfer deferred effort to the persisted trip draft; legacy missing-end effort also waits", () => {
  const h = harness();
  const draft = h.tripDraft.initialDraft(undefined, { name: "New coast", lat: 36, lon: 22, technique: "spinning" });
  draft.fishingMinutes = "30"; draft.anglerCount = "1";
  const result = h.tripDraft.tripUpdateFromDraft(draft);
  assert.equal(result.fields.fishingMinutes, null);
  const saved = { ...legacyTrip, ...result.fields, id: "new-id", recordingMode: "live", status: "active" };
  const next = h.tripDraft.draftAfterSave(saved, draft, result.deferredEffort);
  assert.equal(next.fishingMinutes, "30");
  assert.equal(next.anglerCount, "1");
  const legacyDraft = { ...h.tripDraft.initialDraft(legacyTrip), fishingMinutes: "30" };
  assert.equal(h.tripDraft.tripUpdateFromDraft(legacyDraft, legacyTrip).deferredEffort, true);
});

test("active resume resolves the dedicated active object beyond a capped 500-item visible list", () => {
  const h = harness();
  const visible = Array.from({ length: 500 }, (_, index) => ({ ...legacyTrip, id: `visible-${index}` }));
  const active = { ...legacyTrip, id: "outside-capped-page", status: "active" };
  assert.equal(h.tripDraft.resolveSelectedTrip(active.id, visible, active), active);
  assert.equal(h.tripDraft.resolveSelectedTrip(undefined, visible, null), undefined);
  assert.equal(h.tripDraft.resolveSelectedTrip("visible-4", visible, active), visible[4]);
});

test("query-only scan rechecks use summary technique and coordinates without reparsing the legacy query", () => {
  const h = harness();
  const scan = { id: "legacy-scan", technique: "spinning", locationLabel: "Legacy coast", lat: 36.1, lon: 22.1, radiusKm: 25, resultLimit: 24, response: { mode: "nearby" }, request: { query: "legacy unstructured text" } };
  const request = h.scan.scanRecheckRequest(scan);
  assert.equal(request.technique, scan.technique);
  assert.equal(request.location, scan.locationLabel);
  assert.equal(request.coordinates.lat, scan.lat);
  assert.equal(request.coordinates.lon, scan.lon);
  assert.equal(request.query, undefined);
  assert.equal(request.saveHistory, false);
  assert.equal(request.fishingAt, undefined);
  const structured = h.scan.scanRecheckRequest({ ...scan, request: { technique: "eging", location: "New coast", mode: "point", coordinates: { lat: 37, lon: 23 }, fishingAt: "2025-01-01T00:00:00Z", gpsAccuracyM: 4, targetSpecies: "squid", saveHistory: true } });
  assert.equal(structured.technique, "eging");
  assert.equal(structured.coordinates.lat, 37);
  assert.equal(structured.targetSpecies, "squid");
  assert.equal(structured.fishingAt, undefined);
  assert.equal(structured.gpsAccuracyM, undefined, "An old GPS accuracy is not a new GPS observation");
});

test("the approximateZone API contract remains intact without manufacturing a map target", async () => {
  const h = harness();
  const zone = { actionable: false, label: "Coarse model zone; not a cast target", bearingDeg: 90, direction: "E", distanceRangeM: [60, 150], depthRangeM: [4, 12], confidence: "low" };
  h.reply({ mode: "point", pointAnalysis: { requestedPoint: { lat: 36, lon: 22 }, analyzedPoint: { lat: 36, lon: 22 }, adjustedToWater: false, waterDistanceM: 0, spatialResolutionM: 115, approximateZone: zone }, spots: [{ typicalSpecies: ["Backend typical species"], likelyFish: [] }] });
  const response = await h.api.searchSpots({ technique: "spinning", location: "Selected point", mode: "point", coordinates: { lat: 36, lon: 22 }, radiusKm: 25, resultLimit: 24, saveHistory: false });
  assert.deepEqual(response.pointAnalysis.approximateZone, zone);
  assert.equal(h.analysis.ApproximateZoneInfo, undefined);
  const point = response.pointAnalysis;
  const features = h.map.toPointAnalysisCollection(point).features;
  assert.equal(features.length, 1);
  assert.equal(features[0].geometry.coordinates[0], point.analyzedPoint.lon);
  assert.equal(features[0].geometry.coordinates[1], point.analyzedPoint.lat);
  assert.equal(features.some((feature) => ["target", "cast"].includes(feature.properties.kind)), false);
  const speciesHtml = renderToStaticMarkup(React.createElement(h.analysis.SpeciesProfile, { technique: "spinning", species: response.spots[0].typicalSpecies, target: "" }));
  assert.ok(speciesHtml.includes("Backend typical species"));
  assert.equal(speciesHtml.includes("profile fallback"), false);
});

test("analysis removes model zones and policy walls but retains conditions, provenance and fishing guidance", () => {
  const h = harness();
  const spot = {
    name: "Fixture coast", rank: 1, distanceKm: 0.4, score: 39, recommendationStatus: "unverified", conditionsStatus: "adverse",
    actionabilityLabel: "Check locally", recommendationReasons: ["Unique safety warning"], warnings: ["Unique safety warning", "Access warning"],
    access: { rating: "unknown", notes: ["Access warning"] },
    weather: { confidence: "low", pressureTrend: "rising", airTemperatureC: 23.4, windSpeedKmh: 17.8, validAt: "2026-09-07T10:00:00Z", fetchedAt: "2026-09-07T09:01:00Z", sourceCoordinates: { lat: 36.123, lon: 22.456 }, temporalMode: "forecast" },
    marine: { confidence: "low", waveHeightM: 1.2, validAt: "2026-09-07T11:00:00Z", fetchedAt: "2026-09-07T09:02:00Z", sourceCoordinates: { lat: 36.789, lon: 22.987 }, temporalMode: "forecast" },
    depth: { confidence: "low", hasNearbyWater: true, closestFishableDepthM: 4, maxDepthM: 12, sampleCount: 3, castingProfile: [{ distanceM: 60, depthM: 4 }, { distanceM: 100, depthM: 8 }, { distanceM: 150, depthM: 12 }] },
    techniqueDepthRange: { label: "Unique technique depth range" }, depthStyle: "Gentle slope", seabedLabel: "Unknown seabed", snagRiskLabel: "Unknown snags", depthSourceLabel: "Depth provider", confidenceLabel: "Coarse coverage", typicalSpecies: ["Backend species"], conditionsLabel: "Repeated full conditions summary",
    breakdown: [{ key: "conditions", label: "Conditions factor", score: 20, weight: 30, explanation: "Repeated full conditions summary" }, { key: "depth", label: "Depth factor", score: 40, weight: 50, explanation: "Unique technique depth range" }, { key: "technique", label: "Technique factor", score: 60, weight: 20, explanation: "Unique scoring rationale" }, { key: "access", label: "Access factor", score: 10, weight: 5, explanation: "Access warning" }],
  };
  const response = { mode: "nearby", intent: { technique: "spinning" }, spots: [spot], warnings: ["Unique safety warning", "Response-only warning"], attributions: ["Provider attribution"], conditionsScope: "regional", conditionsAt: "2026-09-07T12:00:00Z", generatedAt: "2026-09-07T09:03:00Z" };
  const original = JSON.stringify(response);
  const render = () => renderToStaticMarkup(React.createElement(h.analysis.SpotAnalysis, { spot, response, snapshot: true }));
  for (const mode of ["nearby", "point"]) {
    response.mode = mode;
    if (mode === "point") response.pointAnalysis = { requestedPoint: { lat: 36, lon: 22 }, analyzedPoint: { lat: 36.001, lon: 22.001 }, adjustedToWater: true, waterDistanceM: 120, gpsAccuracyM: 8, approximateZone: { label: "Removed model zone", distanceRangeM: [60, 150], depthRangeM: [4, 12] } };
    const html = render();
    for (const text of ["Unique technique depth range", "23.4°C", "17.8km/h", "1.2μ", "Profile bait", "Profile rig", "Profile time", "Profile casting guidance", "Backend species", "Ιστορικό στιγμιότυπο,", "Depth provider", "Πηγές δεδομένων", "Δυσμενείς καιρικές ή θαλάσσιες συνθήκες", "Καιρός", "Θάλασσα"]) assert.equal(html.split(text).length - 1, 1, text);
    for (const text of ["Removed model zone", "Ζώνη μοντέλου", "χονδρική ζώνη", "Προειδοποιήσεις", "Μη επαληθευμένο", "Check locally", "Unique safety warning", "Access warning", "Response-only warning", "Unique scoring rationale"]) assert.ok(!html.includes(text), text);
    assert.ok(html.includes("Μη διαθέσιμο"));
    assert.ok(!html.includes(spot.conditionsLabel));
    for (const date of [spot.weather.validAt, spot.weather.fetchedAt, spot.marine.validAt, spot.marine.fetchedAt, response.conditionsAt, response.generatedAt]) assert.ok(html.includes(h.drafts.displayDate(date)), date);
    for (const text of ["36.123, 22.456", "36.789, 22.987", 'role="img"', '<summary class="cursor-pointer py-2 font-bold">Τιμές δειγμάτων</summary>', 'scope="col"']) assert.ok(html.includes(text), text);
    assert.ok(!html.includes("<details open"));
  }
  response.mode = "nearby"; delete response.pointAnalysis;
  assert.equal(JSON.stringify(response), original, "Rendering must not mutate data used for trip snapshots");
  spot.breakdown[0].explanation = "Distinct conditions rationale";
  spot.depth.castingProfile = []; spot.depth.confidence = "none";
  assert.ok(!render().includes("Distinct conditions rationale"));
  assert.ok(render().includes("Δεν υπάρχει διαθέσιμο προφίλ βάθους."));
  assert.ok(render().includes("Μερική κάλυψη δεδομένων"));
  const limitation = "Το DTM δεν μετρά σύσταση βυθού ή σκαλώματα και δεν είναι κατάλληλο για ναυσιπλοΐα.";
  spot.warnings.push(limitation); response.warnings.push(limitation);
  assert.equal(render().split(limitation).length - 1, 0);
  const warnings = renderToStaticMarkup(React.createElement(h.analysis.ResultNotices, { spot, response }));
  assert.ok(!warnings.includes(limitation));
  assert.ok(!warnings.includes("Unique safety warning"));
  spot.conditionsStatus = "unknown";
  assert.ok(!render().includes("Δυσμενείς καιρικές"));
  spot.conditionsStatus = "no-adverse-signal";
  assert.ok(!render().includes("Δυσμενείς καιρικές"));
  const failure = "Η υπηρεσία marine δεν είναι προσωρινά διαθέσιμη.";
  response.warnings.push(failure, failure); spot.warnings.push(failure);
  assert.equal(render().split(failure).length - 1, 1);
  const empty = renderToStaticMarkup(React.createElement(h.analysis.ResultNotices, { response: { ...response, spots: [] } }));
  assert.ok(empty.includes("Δεν επιστράφηκαν σημεία"));
  assert.ok(empty.includes(failure));
  assert.ok(!empty.includes("Response-only warning"));
});

test("duplicate bookmark responses preserve the existing server notes rather than replacing them with the form", async () => {
  const h = harness();
  await h.login();
  h.reply({ place: { id: "existing", name: "Existing point", lat: 36, lon: 22, technique: "spinning", notes: "Keep these private notes" } });
  const place = await h.api.savePlace({ name: "New label", lat: 36, lon: 22, technique: "spinning", notes: "" });
  assert.equal(place.id, "existing");
  assert.equal(place.notes, "Keep these private notes");
});
