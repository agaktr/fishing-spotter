// Browser-only, synthetic web account. No database fixtures or real API writes.
(() => {
  if (location.origin !== "https://fishing.ddev.site" || !new URLSearchParams(location.search).has("web-qa")) return;
  const scenario = new URLSearchParams(location.search).get("web-qa");
  const user = { id: "qa-web-workflow-owner", username: "web-fishing-qa", displayName: "Web fixture", role: "user", active: true };
  const now = new Date().toISOString();
  const metadata = { validAt: now, fetchedAt: now, temporalMode: "current", confidence: "high", sourceCoordinates: { lat: 36.76, lon: 22.56 } };
  const weather = { ...metadata, airTemperatureC: 24.6, apparentTemperatureC: 25.8, windSpeedKmh: 12.4, windDirectionDeg: 315, gustKmh: 19.2, relativeHumidityPct: 68, pressureHpa: 1014, pressureTrend: "stable", precipitationMm: 0, cloudCoverPct: 25, visibilityM: 18000 };
  const marine = { ...metadata, seaSurfaceTemperatureC: 23.1, waveHeightM: 0.65, waveDirectionDeg: 315, wavePeriodS: 4.8, swellHeightM: 0.3, swellDirectionDeg: 300, swellPeriodS: 7.2, currentSpeedKmh: 0.8, currentDirectionDeg: 90, seaLevelMslM: -0.12 };
  const photo = (id) => ({ id, fishRecordId: null, originalName: `Web coast ${id}`, url: `/api/trips/qa-web-history/media/${id}`, thumbnailUrl: `/api/trips/qa-web-history/media/${id}/thumbnail`, width: 640, height: 480, mimeType: "image/svg+xml", createdAt: now });
  const fish = (id, species, count = 1) => ({ id, species, count, bait: "", notes: "", released: false, weightBasis: "individual", lengthBasis: "individual", images: [] });
  const base = { id: "qa-web-history", userId: user.id, username: user.username, status: "completed", recordingMode: "historical", visibility: "private", publicLocationPrecision: "approximate", shareNotes: false, sharedMediaIds: [], technique: "spinning", techniqueLabel: "Spinning", locationName: "Μαυροβούνι", lat: 36.735, lon: 22.57, tripDate: "2026-08-28T05:30:00Z", endedAt: null, completedAt: "2026-08-28T09:00:00Z", outcome: "recorded", fishingMinutes: null, anglerCount: null, conditionsRecordedAt: now, notes: "", fishRecords: [fish("qa-web-bass", "Λαβράκι", 2)], images: [photo("qa-web-photo-1"), photo("qa-web-photo-2"), photo("qa-web-photo-3")], fishCaught: [], weather, marine, conditionsLabel: "Synthetic web conditions", createdAt: now, updatedAt: now };
  const initial = [base,
    { ...base, id: "qa-web-zero", locationName: "Σκουτάρι", lat: 36.68, lon: 22.5, technique: "eging", techniqueLabel: "Eging", outcome: "zero", fishRecords: [], images: [], tripDate: "2026-08-23T16:30:00Z" },
    { ...base, id: "qa-web-unknown", locationName: "Γύθειο", outcome: "not-recorded", fishRecords: [], images: [], tripDate: "2026-08-20T04:30:00Z" },
    { ...base, id: "qa-web-public", userId: "qa-web-other-owner", username: "", locationName: "Κοινοποιημένη περιοχή", visibility: "public", images: [], fishRecords: [], outcome: "zero", tripDate: "2026-08-18T08:00:00Z" },
  ];
  if (scenario === "active") initial.unshift({ ...base, id: "qa-web-active", status: "active", recordingMode: "live", tripDate: new Date(Date.now() - 7200000).toISOString(), completedAt: null, images: [], fishRecords: [], outcome: "zero" });
  if (scenario === "active" && new URLSearchParams(location.search).has("catch")) Object.assign(initial[0], { outcome: "recorded", fishRecords: [{ ...fish("qa-web-catch", "Λαβράκι"), images: [photo("qa-web-catch-photo")] }] });
  if (sessionStorage.getItem("qa-web-workflow-scenario") !== location.search) {
    for (const key of Object.keys(localStorage)) if (key.startsWith(`fishing-draft:${user.id}:`) || key === "fishing-last-technique") localStorage.removeItem(key);
    sessionStorage.setItem("qa-web-workflow-db", JSON.stringify(initial));
    sessionStorage.setItem("qa-web-workflow-scenario", location.search);
    sessionStorage.setItem("fishing-session-token", "synthetic-web-token");
    localStorage.setItem(`fishing-continuation:${user.id}`, JSON.stringify({ panel: "trips", panelOpen: scenario === "history", pickedPoint: scenario === "quick" ? { lat: 36.76, lon: 22.56 } : undefined, technique: "spinning", location: "Μαυροβούνι", targetSpecies: "", fishingAt: "", radiusKm: 25, resultLimit: 24 }));
  }
  const db = JSON.parse(sessionStorage.getItem("qa-web-workflow-db"));
  const persist = () => sessionStorage.setItem("qa-web-workflow-db", JSON.stringify(db));
  const revision = async (trip) => {
    const raw = JSON.stringify(trip.fishRecords.map(({ images, ...record }) => record));
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  const dto = async (trip) => trip ? { ...trip, ...(trip.userId === user.id && !new URLSearchParams(location.search).has("legacy") ? { fishRevision: await revision(trip) } : {}) } : null;
  const qa = window.webQA = { db, revision, requests: [], failNextPatch: "", delayPatch: false, beforePatch: null, release: () => {}, confirmations: [], confirm: true };
  window.confirm = (message) => { qa.confirmations.push(message); return qa.confirm; };
  const original = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url ?? String(input), location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return original(input, init);
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    qa.requests.push({ path: url.pathname, method, body });
    const reply = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/api/session") return reply(method === "POST" ? { user, token: "synthetic-web-token", expiresAt: "2099-01-01T00:00:00Z" } : { user });
    if (url.pathname === "/api/trips/active") return reply({ trip: await dto(db.find((trip) => trip.status === "active")) });
    if (url.pathname === "/api/trips" && method === "GET") return reply({ trips: await Promise.all(db.map(dto)) });
    if (url.pathname === "/api/trips" && method === "POST") {
      if (body.recordingMode === "live" && db.some((trip) => trip.status === "active")) return reply({ error: "An active trip already exists" }, 409);
      const trip = { ...base, ...body, id: `qa-web-created-${db.length}`, status: body.recordingMode === "live" ? "active" : "completed", images: [], weather: body.weather ?? {}, marine: body.marine ?? {}, completedAt: body.recordingMode === "live" ? null : new Date().toISOString() };
      db.unshift(trip); persist(); return reply({ trip: await dto(trip) });
    }
    if (/\/media\//.test(url.pathname) && method === "GET") return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#b9d9d9"/><path d="M0 200Q160 100 320 240T640 200V480H0Z" fill="#0b5f6f"/><path d="M0 260Q160 160 320 300T640 260" fill="none" stroke="#fff" stroke-width="8"/><circle cx="490" cy="90" r="40" fill="#ffedb5"/></svg>', { headers: { "Content-Type": "image/svg+xml" } });
    const id = url.pathname.split("/")[3];
    const trip = db.find((item) => item.id === id);
    if (trip && method === "GET") return reply({ trip: await dto(trip) });
    if (trip && method === "POST" && url.pathname.endsWith("/media")) {
      const image = photo(`qa-web-upload-${trip.images.length}`);
      const fishId = body.get("fishRecordId");
      if (fishId) trip.fishRecords.find((fish) => fish.id === fishId).images.push({ ...image, fishRecordId: fishId }); else trip.images.push(image);
      persist(); return reply({ trip: await dto(trip) });
    }
    if (trip && method === "PATCH") {
      if (qa.delayPatch) await new Promise((resolve) => { qa.release = resolve; });
      const failure = qa.failNextPatch; qa.failNextPatch = "";
      if (failure === "before") throw new TypeError("Synthetic network failure; draft retained");
      if (failure === "401") return reply({ error: "Synthetic session expiry" }, 401);
      if (qa.beforePatch) { const change = qa.beforePatch; qa.beforePatch = null; change(trip); persist(); }
      if (Object.hasOwn(body, "expectedFishRevision")) {
        if (!/^[a-f0-9]{64}$/.test(body.expectedFishRevision)) return reply({ error: "expectedFishRevision must be a 64-character lowercase SHA-256 string." }, 400);
        if (Object.hasOwn(body, "fishRecords") && body.expectedFishRevision !== await revision(trip)) return reply({ error: "Catch records have changed. Reload the trip before saving catches." }, 409);
      }
      const { expectedFishRevision, fishRecords, ...fields } = body;
      const end = Object.hasOwn(fields, "endedAt") ? fields.endedAt : trip.endedAt;
      const minutes = Object.hasOwn(fields, "fishingMinutes") ? fields.fishingMinutes : trip.fishingMinutes;
      if (minutes != null && !end) return reply({ error: "Fishing minutes require an actual end." }, 400);
      if (fishRecords) trip.fishRecords = fishRecords.map((fish) => ({ ...fish, images: trip.fishRecords.find((old) => old.id === fish.id)?.images ?? [] }));
      Object.assign(trip, fields, { updatedAt: new Date().toISOString() });
      if (body.status === "completed") trip.completedAt = new Date().toISOString();
      persist();
      if (failure === "after") throw new TypeError("Synthetic lost response; retry safely");
      return reply({ trip: await dto(trip) });
    }
    if (url.pathname === "/api/spots" && method === "POST") {
      const spot = { id: "qa-web-spot", name: "Μαυροβούνι", lat: 36.76, lon: 22.56, rank: 1, distanceKm: 0.4, score: 59, recommendationStatus: "unverified", conditionsStatus: "no-adverse-signal", warnings: [], access: { rating: "unknown", notes: [] }, weather: { ...weather, ...(body.fishingAt ? { validAt: body.fishingAt, temporalMode: "forecast" } : {}) }, marine: { ...marine, ...(body.fishingAt ? { validAt: body.fishingAt, temporalMode: "forecast" } : {}) }, depth: { confidence: "low", hasNearbyWater: true, closestFishableDepthM: 4, maxDepthM: 12, sampleCount: 3, castingProfile: [{ distanceM: 60, depthM: 4 }, { distanceM: 100, depthM: 8 }, { distanceM: 150, depthM: 12 }] }, techniqueDepthRange: { label: "Ενδεικτικό βάθος 4-12 μ" }, depthStyle: "Ήπια κλίση", seabedLabel: "Άγνωστος βυθός", snagRiskLabel: "Άγνωστα", depthSourceLabel: "EMODnet DTM ~115 μ", confidenceLabel: "Χονδρική κάλυψη", typicalSpecies: ["Λαβράκι"], conditionsLabel: "Synthetic web search conditions" };
      return reply({ mode: body.mode, intent: { ...body, techniqueLabel: "Spinning" }, location: { lat: 36.76, lon: 22.56, displayName: "Μαυροβούνι, Λακωνία" }, resultLimit: 24, cache: { hit: false }, spots: [spot], warnings: [], attributions: ["Open-Meteo", "EMODnet", "OpenStreetMap"], conditionsScope: "regional", conditionsAt: body.fishingAt ?? now, generatedAt: now });
    }
    return reply({ error: `Blocked unmocked web fixture request: ${method} ${url.pathname}` }, 403);
  };
})();
