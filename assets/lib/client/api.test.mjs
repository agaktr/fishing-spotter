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
    if (id === "@/lib/techniqueProfiles") return { TECHNIQUE_PROFILES: { spinning: { label: "Spinning", species: ["profile fallback"] } } };
    if (id === "@/lib/geo") return { round: (value, digits) => Number(value.toFixed(digits)) };
    if (id === "maplibre-gl") return {};
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

test("the actual approximateZone contract renders as non-actionable ranges without manufacturing a map target", async () => {
  const h = harness();
  const zone = { actionable: false, label: "Coarse model zone; not a cast target", bearingDeg: 90, direction: "E", distanceRangeM: [60, 150], depthRangeM: [4, 12], confidence: "low" };
  h.reply({ mode: "point", pointAnalysis: { requestedPoint: { lat: 36, lon: 22 }, analyzedPoint: { lat: 36, lon: 22 }, adjustedToWater: false, waterDistanceM: 0, spatialResolutionM: 115, approximateZone: zone }, spots: [{ typicalSpecies: ["Backend typical species"], likelyFish: [] }] });
  const response = await h.api.searchSpots({ technique: "spinning", location: "Selected point", mode: "point", coordinates: { lat: 36, lon: 22 }, radiusKm: 25, resultLimit: 24, saveHistory: false });
  const html = renderToStaticMarkup(React.createElement(h.analysis.ApproximateZoneInfo, { zone: response.pointAnalysis.approximateZone, resolutionM: response.pointAnalysis.spatialResolutionM }));
  assert.ok(html.includes(zone.label));
  assert.ok(html.includes('data-actionable="false"'));
  assert.ok(html.includes("60 - 150"));
  assert.ok(html.includes("4.0 - 12.0"));
  assert.ok(html.includes("115"));
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

test("duplicate bookmark responses preserve the existing server notes rather than replacing them with the form", async () => {
  const h = harness();
  await h.login();
  h.reply({ place: { id: "existing", name: "Existing point", lat: 36, lon: 22, technique: "spinning", notes: "Keep these private notes" } });
  const place = await h.api.savePlace({ name: "New label", lat: 36, lon: 22, technique: "spinning", notes: "" });
  assert.equal(place.id, "existing");
  assert.equal(place.notes, "Keep these private notes");
});
