"use client";

import { FormEvent, type ReactNode, useEffect, useState, useTransition } from "react";
import { FishingMap, type MapBaseLayer } from "./FishingMap";
import { UserConnectPanel } from "./UserConnectPanel";
import type { ApiUser, Coordinates, CreateTripInput, PointAnalysis, RankedSpot, SavedFishingTrip, SpotsApiRequest, SpotsApiResponse, SpotSearchMode, TechniqueId, TripFishRecord, TripMedia, TripVisibility } from "@/lib/types";
import { TECHNIQUE_PROFILES } from "@/lib/techniqueProfiles";
import { connectUsername, createTrip as createTripApi, deleteTrip as deleteTripApi, deleteTripImage as deleteTripImageApi, fetchActiveTrip, fetchTripImage, fetchTrips, setTripVisibility as setTripVisibilityApi, updateTrip as updateTripApi, uploadTripImage } from "@/lib/client/api";

const DEFAULT_RESULT_LIMIT = 24;
const DEFAULT_RADIUS_KM = 25;
const USER_STORAGE_KEY = "fishing-spotter-username";
const LEGACY_TRIPS_STORAGE_KEY = "fishing-spotter-trips";
const RESULT_LIMIT_OPTIONS = [12, 24, 36, 48];
const POPULAR_TARGET_FISH = ["λαβράκι", "τσιπούρα", "σαργός", "καλαμάρι", "σουπιά", "λούτσος", "γοφάρι", "συναγρίδα", "μαγιάτικο"];
const TIME_HINT_OPTIONS = [
  { value: "", label: "Τώρα / επόμενο καλό παράθυρο" },
  { value: "σήμερα", label: "Σήμερα" },
  { value: "αύριο πρωί", label: "Αύριο πρωί" },
  { value: "αύριο βράδυ", label: "Αύριο βράδυ" },
  { value: "ξημέρωμα", label: "Ξημέρωμα" },
  { value: "σούρουπο", label: "Σούρουπο" },
  { value: "νύχτα", label: "Νύχτα" },
];
const clientCache = new Map<string, SpotsApiResponse>();

interface TripFishDraft {
  species: string;
  count: string;
  weightKg: string;
  lengthCm: string;
  bait: string;
  released: boolean;
  notes: string;
}

const EMPTY_TRIP_FISH_DRAFT: TripFishDraft = {
  species: "",
  count: "1",
  weightKg: "",
  lengthCm: "",
  bait: "",
  released: false,
  notes: "",
};

export function SearchExperience() {
  const [technique, setTechnique] = useState<TechniqueId>("surfcasting");
  const [locationInput, setLocationInput] = useState("Γύθειο");
  const [resultLimit, setResultLimit] = useState(DEFAULT_RESULT_LIMIT);
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM);
  const [targetFish, setTargetFish] = useState("");
  const [timeHint, setTimeHint] = useState("");
  const [baseLayer, setBaseLayer] = useState<MapBaseLayer>("terrain");
  const [selectedSpotId, setSelectedSpotId] = useState<string | undefined>();
  const [infoSpotId, setInfoSpotId] = useState<string | undefined>();
  const [pickedPoint, setPickedPoint] = useState<Coordinates | undefined>();
  const [gpsAccuracyM, setGpsAccuracyM] = useState<number | undefined>();
  const [customTripPoint, setCustomTripPoint] = useState<Coordinates | undefined>();
  const [tripPanelOpen, setTripPanelOpen] = useState(false);
  const [userPanelOpen, setUserPanelOpen] = useState(false);
  const [activeUser, setActiveUser] = useState<ApiUser | undefined>();
  const [trips, setTrips] = useState<SavedFishingTrip[]>([]);
  const [activeTrip, setActiveTrip] = useState<SavedFishingTrip | null>(null);
  const [editingTripId, setEditingTripId] = useState<string | undefined>();
  const [tripDate, setTripDate] = useState("");
  const [tripVisibility, setTripVisibility] = useState<TripVisibility>("private");
  const [tripFishRecords, setTripFishRecords] = useState<TripFishRecord[]>([]);
  const [tripFishDraft, setTripFishDraft] = useState<TripFishDraft>(EMPTY_TRIP_FISH_DRAFT);
  const [tripNotes, setTripNotes] = useState("");
  const [response, setResponse] = useState<SpotsApiResponse | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [cacheMessage, setCacheMessage] = useState<string | undefined>();
  const [gpsLoading, setGpsLoading] = useState(false);
  const [tripSaving, setTripSaving] = useState(false);
  const [mediaSavingKey, setMediaSavingKey] = useState<string | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [isPending, startTransition] = useTransition();

  const selectedSpot = response?.spots.find((spot) => spot.id === selectedSpotId) ?? response?.spots[0];
  const infoSpot = response?.spots.find((spot) => spot.id === infoSpotId);
  const editingTrip = trips.find((trip) => trip.id === editingTripId);

  function applyUpdatedTrip(trip: SavedFishingTrip) {
    setTrips((current) => [trip, ...current.filter((item) => item.id !== trip.id)]);
    setActiveTrip(trip.status === "active" ? trip : (current) => current?.id === trip.id ? null : current);
    if (editingTripId === trip.id) {
      setTripFishRecords(trip.fishRecords);
    }
  }

  async function runSearch(
    searchQuery = searchQueryFromState(technique, locationInput, targetFish, timeHint),
    options: {
      locationOnly?: boolean;
      coordinates?: { lat: number; lon: number };
      locationLabel?: string;
      mode?: SpotSearchMode;
      gpsAccuracyM?: number;
    } = {},
  ) {
    setError(undefined);
    setCacheMessage(undefined);
    setTripPanelOpen(false);
    const normalizedLimit = normalizeResultLimit(resultLimit);
    const normalizedRadiusKm = normalizeRadiusKm(radiusKm);
    const locationOnly = options.locationOnly === true;
    const mode = options.mode ?? "nearby";
    const cacheKey = searchCacheKey(searchQuery, normalizedLimit, normalizedRadiusKm, locationOnly, mode, options.coordinates, options.gpsAccuracyM);

    startTransition(async () => {
      try {
        const requestBody: SpotsApiRequest = {
          mode,
          query: searchQuery,
          resultLimit: normalizedLimit,
          radiusKm: normalizedRadiusKm,
          locationOnly,
          coordinates: options.coordinates,
          locationLabel: options.locationLabel,
          gpsAccuracyM: mode === "point" ? options.gpsAccuracyM : undefined,
        };
        const result = await fetch("/api/spots", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(activeUser ? { "X-Fishing-User": activeUser.username } : {}),
          },
          body: JSON.stringify(requestBody),
        });

        const payload = (await result.json()) as SpotsApiResponse | { error: string };
        if (!result.ok) {
          throw new Error("error" in payload ? payload.error : "Η αναζήτηση απέτυχε");
        }

        const spotsPayload = payload as SpotsApiResponse;
        const firstSpot = spotsPayload.spots[0];
        const fallbackTripPoint = options.coordinates ?? pickedPoint;
        clientCache.set(cacheKey, spotsPayload);
        setResponse(spotsPayload);
        setSelectedSpotId(firstSpot?.id);
        setInfoSpotId(undefined);
        setCustomTripPoint(firstSpot ? undefined : fallbackTripPoint);
        setSettingsOpen(false);
        setCacheMessage(
          spotsPayload.cache.hit
            ? `Server cache (${mode === "point" ? "ανάλυση σημείου" : `${spotsPayload.spots.length} σημεία`}, ${spotsPayload.cache.ageSeconds ?? 0}s).`
            : mode === "point" ? "Νέα ανάλυση σημείου." : `Νέα σάρωση (${spotsPayload.spots.length} σημεία).`,
        );
      } catch (searchError) {
        setError(searchError instanceof Error ? searchError.message : "Η αναζήτηση απέτυχε");
      }
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pickedPoint) {
      searchNearbyPickedPoint();
      return;
    }

    setPickedPoint(undefined);
    setCustomTripPoint(undefined);
    void runSearch(searchQueryFromState(technique, locationInput, targetFish, timeHint));
  }

  async function searchGpsLocation() {
    setError(undefined);
    setCacheMessage(undefined);

    if (!navigator.geolocation) {
      setError("Η συσκευή ή ο browser δεν υποστηρίζει GPS/geolocation.");
      return;
    }

    setGpsLoading(true);
    try {
      const position = await getCurrentPosition();
      const coordinates = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
      };
      const label = "Η θέση μου";
      setPickedPoint(coordinates);
      setGpsAccuracyM(Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : undefined);
      setCustomTripPoint(coordinates);
      setLocationInput(label);
      setResponse(undefined);
      setSelectedSpotId(undefined);
      setInfoSpotId(undefined);
      setTripPanelOpen(false);
      setSettingsOpen(true);
      setCacheMessage("Η θέση GPS επιλέχθηκε. Διάλεξε ανάλυση ακριβώς εδώ ή αναζήτηση κοντινών σημείων.");
    } catch (gpsError) {
      setError(gpsError instanceof Error ? gpsError.message : "Δεν μπορέσαμε να πάρουμε την τρέχουσα τοποθεσία.");
    } finally {
      setGpsLoading(false);
    }
  }

  function handleMapPoint(coordinates: Coordinates) {
    setPickedPoint(coordinates);
    setGpsAccuracyM(undefined);
    setCustomTripPoint(coordinates);
    setLocationInput(mapPointLocationLabel(coordinates));
    setResponse(undefined);
    setSelectedSpotId(undefined);
    setInfoSpotId(undefined);
    setTripPanelOpen(false);
    setSettingsOpen(true);
    setCacheMessage("Διαλέχτηκε σημείο στον χάρτη. Διάλεξε ανάλυση ακριβώς εδώ ή αναζήτηση κοντινών σημείων.");
  }

  function analyzePickedPoint() {
    if (!pickedPoint) {
      return;
    }

    const label = locationInput === "Η θέση μου" ? locationInput : mapPointLocationLabel(pickedPoint);
    setCustomTripPoint(pickedPoint);
    setLocationInput(label);
    void runSearch(searchQueryFromState(technique, label, targetFish, timeHint), {
      coordinates: pickedPoint,
      locationLabel: label,
      mode: "point",
      gpsAccuracyM,
    });
  }

  function searchNearbyPickedPoint() {
    if (!pickedPoint) {
      return;
    }

    const label = locationInput === "Η θέση μου" ? locationInput : mapPointLocationLabel(pickedPoint);
    setCustomTripPoint(pickedPoint);
    setLocationInput(label);
    void runSearch(searchQueryFromState(technique, label, targetFish, timeHint), {
      coordinates: pickedPoint,
      locationLabel: label,
      mode: "nearby",
    });
  }

  function clearPickedPoint() {
    setPickedPoint(undefined);
    setGpsAccuracyM(undefined);
    setCustomTripPoint(undefined);
    setCacheMessage(undefined);
    if (response?.mode === "point") {
      setResponse(undefined);
      setSelectedSpotId(undefined);
      setInfoSpotId(undefined);
    }
    if (locationInput.startsWith("Σημείο χάρτη") || locationInput === "Η θέση μου") {
      setLocationInput(response?.mode === "point" ? "Γύθειο" : response?.intent.locationText ?? "Γύθειο");
    }
  }

  function openTripPanel(spot?: RankedSpot) {
    const targetSpot = spot ?? (response?.mode === "point" || !pickedPoint ? selectedSpot : undefined);

    if (targetSpot) {
      setSelectedSpotId(targetSpot.id);
      setInfoSpotId(undefined);
      setCustomTripPoint(undefined);
    } else if (pickedPoint) {
      setSelectedSpotId(undefined);
      setInfoSpotId(undefined);
      setCustomTripPoint(pickedPoint);
    }
    if (editingTripId) {
      setTripDate("");
      setTripVisibility("private");
      setTripFishRecords([]);
      setTripFishDraft({ ...EMPTY_TRIP_FISH_DRAFT });
      setTripNotes("");
    }
    setEditingTripId(undefined);
    setSettingsOpen(false);
    setTripPanelOpen(true);
  }

  function editTrip(trip: SavedFishingTrip) {
    if (activeUser?.id !== trip.userId) {
      return;
    }
    setEditingTripId(trip.id);
    setTripDate(toDatetimeLocal(trip.tripDate));
    setTripVisibility(trip.visibility);
    setTripFishRecords(trip.fishRecords);
    setTripFishDraft({ ...EMPTY_TRIP_FISH_DRAFT });
    setTripNotes(trip.notes);
    setSettingsOpen(false);
    setUserPanelOpen(false);
    setTripPanelOpen(true);
    setError(undefined);
  }

  function selectTripFishSpecies(fish: string) {
    setTripFishDraft((draft) => ({ ...draft, species: fish }));
  }

  function updateTripFishDraft(field: keyof TripFishDraft, value: string | boolean) {
    setTripFishDraft((draft) => ({ ...draft, [field]: value }));
  }

  async function addTripFish() {
    const species = tripFishDraft.species.trim();
    if (!species) {
      setError("Γράψε είδος ψαριού πριν πατήσεις Add fish.");
      return;
    }

    const count = normalizeFishCount(tripFishDraft.count);
    const record: TripFishRecord = {
      id: crypto.randomUUID(),
      species,
      count,
      weightKg: optionalPositiveNumber(tripFishDraft.weightKg),
      lengthCm: optionalPositiveNumber(tripFishDraft.lengthCm),
      bait: tripFishDraft.bait.trim() || undefined,
      released: tripFishDraft.released,
      notes: tripFishDraft.notes.trim() || undefined,
      images: [],
    };

    const records = [...tripFishRecords, record];
    if (editingTrip && activeUser) {
      setTripSaving(true);
      try {
        const updated = await updateTripApi(activeUser.username, editingTrip.id, { fishRecords: records });
        applyUpdatedTrip(updated);
        setTripFishDraft({ ...EMPTY_TRIP_FISH_DRAFT });
        setError(undefined);
      } catch (fishError) {
        setError(fishError instanceof Error ? fishError.message : "Το ψάρι δεν αποθηκεύτηκε.");
      } finally {
        setTripSaving(false);
      }
      return;
    }

    setTripFishRecords(records);
    setTripFishDraft({ ...EMPTY_TRIP_FISH_DRAFT });
    setError(undefined);
  }

  async function removeTripFishRecord(id: string) {
    const records = tripFishRecords.filter((record) => record.id !== id);
    if (editingTrip && activeUser) {
      setTripSaving(true);
      try {
        const updated = await updateTripApi(activeUser.username, editingTrip.id, { fishRecords: records });
        applyUpdatedTrip(updated);
        setError(undefined);
      } catch (fishError) {
        setError(fishError instanceof Error ? fishError.message : "Το ψάρι δεν αφαιρέθηκε.");
      } finally {
        setTripSaving(false);
      }
      return;
    }
    setTripFishRecords(records);
  }

  async function saveTrip() {
    let tripResponse = response;
    let tripSpot = customTripPoint ? undefined : selectedSpot;
    let pointAnalysis = response?.mode === "point" ? response.pointAnalysis : undefined;
    let tripPoint = customTripPoint ?? pointAnalysis?.requestedPoint ?? (tripSpot ? { lat: tripSpot.lat, lon: tripSpot.lon } : undefined);

    if (!activeUser) {
      setError("Συνδέσου με username πριν αποθηκεύσεις εξόρμηση.");
      setUserPanelOpen(true);
      return;
    }

    if (!tripPoint) {
      setError("Διάλεξε πρώτα σημείο από τα αποτελέσματα ή πάτα σημείο στον χάρτη για να αποθηκεύσεις εξόρμηση.");
      return;
    }

    setTripSaving(true);
    try {
      if (customTripPoint && !tripSpot) {
        try {
          const analysisResult = await fetch("/api/spots", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Fishing-User": activeUser.username,
            },
            body: JSON.stringify({
              mode: "point",
              query: searchQueryFromState(technique, locationInput, targetFish, timeHint),
              coordinates: customTripPoint,
              locationLabel: mapPointLocationLabel(customTripPoint),
              gpsAccuracyM,
            } satisfies SpotsApiRequest),
          });
          const analysisPayload = (await analysisResult.json()) as SpotsApiResponse | { error: string };
          if (analysisResult.ok && "spots" in analysisPayload && analysisPayload.spots[0]) {
            tripResponse = analysisPayload;
            tripSpot = analysisPayload.spots[0];
            pointAnalysis = analysisPayload.mode === "point" ? analysisPayload.pointAnalysis : undefined;
            tripPoint = pointAnalysis?.requestedPoint ?? customTripPoint;
          }
        } catch {
          // Starting a trip should remain possible when live condition providers are unavailable.
        }
      }

      const input: CreateTripInput = {
        tripDate: tripDate ? new Date(tripDate).toISOString() : new Date().toISOString(),
        technique: tripSpot ? tripResponse?.intent.technique ?? technique : technique,
        techniqueLabel: tripSpot ? tripResponse?.intent.techniqueLabel ?? TECHNIQUE_PROFILES[technique].label : TECHNIQUE_PROFILES[technique].label,
        locationName: pointAnalysis ? tripResponse?.location.displayName ?? mapPointLocationLabel(tripPoint) : tripSpot?.name ?? mapPointLocationLabel(tripPoint),
        lat: tripPoint.lat,
        lon: tripPoint.lon,
        spotId: tripSpot?.id,
        score: tripSpot?.score ?? 0,
        visibility: tripVisibility,
        fishRecords: tripFishRecords.map((record) => ({ ...record })),
        notes: tripNotes.trim(),
        conditionsLabel: tripSpot?.conditionsLabel ?? "Χειροκίνητο σημείο χάρτη χωρίς snapshot καιρού/θάλασσας.",
        depthLabel: tripSpot?.techniqueDepthRange.label ?? "Χειροκίνητο σημείο χωρίς snapshot βάθους.",
        seabedLabel: tripSpot?.seabedLabel ?? "άγνωστος βυθός",
        weather: tripSpot?.weather ?? { confidence: "none", pressureTrend: "unknown" },
        marine: tripSpot?.marine ?? { confidence: "none" },
      };
      const trip = await createTripApi(activeUser.username, input);
      setEditingTripId(trip.id);
      applyUpdatedTrip(trip);
      setError(undefined);
      setTripDate(toDatetimeLocal(trip.tripDate));
      setTripVisibility(trip.visibility);
      setTripFishRecords(trip.fishRecords);
      setTripFishDraft({ ...EMPTY_TRIP_FISH_DRAFT });
      setTripNotes(trip.notes);
      if (customTripPoint) {
        setPickedPoint(undefined);
        setGpsAccuracyM(undefined);
        setCustomTripPoint(undefined);
      }
      setCacheMessage(`Ξεκίνησε ενεργή ${trip.visibility === "public" ? "δημόσια" : "ιδιωτική"} εξόρμηση στο ${trip.locationName}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Η εξόρμηση δεν αποθηκεύτηκε.");
    } finally {
      setTripSaving(false);
    }
  }

  async function saveTripEdits() {
    if (!activeUser || !editingTrip) {
      return;
    }
    setTripSaving(true);
    try {
      const updated = await updateTripApi(activeUser.username, editingTrip.id, {
        tripDate: tripDate ? new Date(tripDate).toISOString() : editingTrip.tripDate,
        visibility: tripVisibility,
        notes: tripNotes.trim(),
      });
      applyUpdatedTrip(updated);
      setCacheMessage("Οι αλλαγές της εξόρμησης αποθηκεύτηκαν.");
      setError(undefined);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Οι αλλαγές δεν αποθηκεύτηκαν.");
    } finally {
      setTripSaving(false);
    }
  }

  async function finishTrip() {
    if (!activeUser || !editingTrip || editingTrip.status !== "active") {
      return;
    }
    setTripSaving(true);
    try {
      const updated = await updateTripApi(activeUser.username, editingTrip.id, {
        status: "completed",
        tripDate: tripDate ? new Date(tripDate).toISOString() : editingTrip.tripDate,
        visibility: tripVisibility,
        notes: tripNotes.trim(),
      });
      applyUpdatedTrip(updated);
      setCacheMessage(`Ολοκληρώθηκε η εξόρμηση στο ${updated.locationName}.`);
      setError(undefined);
    } catch (finishError) {
      setError(finishError instanceof Error ? finishError.message : "Η εξόρμηση δεν ολοκληρώθηκε.");
    } finally {
      setTripSaving(false);
    }
  }

  async function addTripImages(tripId: string, files: File[], fishRecordId?: string) {
    if (!activeUser || files.length === 0) {
      return;
    }
    const key = fishRecordId ?? "trip";
    setMediaSavingKey(key);
    try {
      let updated: SavedFishingTrip | undefined;
      for (const file of files) {
        updated = await uploadTripImage(activeUser.username, tripId, file, fishRecordId);
        applyUpdatedTrip(updated);
      }
      setError(undefined);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Η μεταφόρτωση εικόνας απέτυχε.");
    } finally {
      setMediaSavingKey(undefined);
    }
  }

  async function removeTripImage(tripId: string, mediaId: string) {
    if (!activeUser) {
      return;
    }
    setMediaSavingKey(mediaId);
    try {
      applyUpdatedTrip(await deleteTripImageApi(activeUser.username, tripId, mediaId));
      setError(undefined);
    } catch (mediaError) {
      setError(mediaError instanceof Error ? mediaError.message : "Η διαγραφή εικόνας απέτυχε.");
    } finally {
      setMediaSavingKey(undefined);
    }
  }

  async function removeTrip(id: string) {
    if (!activeUser) {
      setError("Συνδέσου για να διαγράψεις εξόρμηση.");
      return;
    }
    try {
      await deleteTripApi(activeUser.username, id);
      setTrips((current) => current.filter((trip) => trip.id !== id));
      setActiveTrip((current) => current?.id === id ? null : current);
      setEditingTripId((current) => current === id ? undefined : current);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Η διαγραφή απέτυχε.");
    }
  }

  async function changeTripVisibility(id: string, visibility: TripVisibility) {
    if (!activeUser) {
      return;
    }
    try {
      const updated = await setTripVisibilityApi(activeUser.username, id, visibility);
      applyUpdatedTrip(updated);
      if (editingTripId === updated.id) {
        setTripVisibility(updated.visibility);
      }
    } catch (visibilityError) {
      setError(visibilityError instanceof Error ? visibilityError.message : "Η αλλαγή ορατότητας απέτυχε.");
    }
  }

  async function connectUser(user: ApiUser) {
    setActiveUser(user);
    setUserPanelOpen(false);
    window.localStorage.setItem(USER_STORAGE_KEY, user.username);
    const [visibleTrips, currentTrip] = await Promise.all([fetchTrips(user.username), fetchActiveTrip(user.username)]);
    setTrips(visibleTrips);
    setActiveTrip(currentTrip);
    setError(undefined);
  }

  async function disconnectUser() {
    window.localStorage.removeItem(USER_STORAGE_KEY);
    setActiveUser(undefined);
    setActiveTrip(null);
    setEditingTripId(undefined);
    setTrips(await fetchTrips(undefined, "public"));
  }

  async function flushCache() {
    setError(undefined);
    setCacheMessage(undefined);
    startTransition(async () => {
      try {
        const result = await fetch("/api/spots", { method: "DELETE" });
        const payload = (await result.json()) as { cleared?: number; error?: string };
        if (!result.ok) {
          throw new Error(payload.error ?? "Ο καθαρισμός cache απέτυχε");
        }

        const clientEntries = clientCache.size;
        clientCache.clear();
        setCacheMessage(`Καθαρίστηκε cache: ${payload.cleared ?? 0} server, ${clientEntries} browser.`);
      } catch (flushError) {
        setError(flushError instanceof Error ? flushError.message : "Ο καθαρισμός cache απέτυχε");
      }
    });
  }

  useEffect(() => {
    async function hydrateUserAndTrips() {
      window.localStorage.removeItem(LEGACY_TRIPS_STORAGE_KEY);
      const storedUsername = window.localStorage.getItem(USER_STORAGE_KEY);
      try {
        if (storedUsername) {
          const user = await connectUsername(storedUsername);
          setActiveUser(user);
          const [visibleTrips, currentTrip] = await Promise.all([fetchTrips(user.username), fetchActiveTrip(user.username)]);
          setTrips(visibleTrips);
          setActiveTrip(currentTrip);
        } else {
          setTrips(await fetchTrips(undefined, "public"));
        }
      } catch {
        window.localStorage.removeItem(USER_STORAGE_KEY);
        setActiveUser(undefined);
        setTrips(await fetchTrips(undefined, "public").catch(() => []));
      }
    }

    void hydrateUserAndTrips();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "/" && event.target instanceof HTMLElement && event.target.tagName !== "INPUT") {
        event.preventDefault();
        setSettingsOpen(true);
        document.getElementById("spot-location")?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <main className="relative h-[100svh] w-screen overflow-hidden bg-ink text-ink">
      <FishingMap
        location={response?.location}
        radiusKm={response?.intent.radiusKm ?? radiusKm}
        spots={response?.spots ?? []}
        selectedSpotId={selectedSpot?.id}
        onSelectSpot={(spotId) => {
          setSelectedSpotId(spotId);
          setInfoSpotId(spotId);
        }}
        loading={isPending || gpsLoading}
        baseLayer={baseLayer}
        pickedPoint={pickedPoint}
        mode={response?.mode}
        pointAnalysis={response?.pointAnalysis}
        trips={trips}
        onSelectTrip={(tripId) => {
          const trip = trips.find((item) => item.id === tripId);
          if (trip && activeUser?.id === trip.userId) {
            editTrip(trip);
          }
        }}
        onPickPoint={handleMapPoint}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 p-3 sm:p-4">
        <div className="pointer-events-auto mx-auto flex max-w-[1560px] flex-wrap items-start gap-1 sm:gap-3">
          <button
            type="button"
            onClick={() => {
              setTripPanelOpen(false);
              setUserPanelOpen(false);
              setSettingsOpen((open) => !open);
            }}
            className="rounded-2xl border border-white/70 bg-white/95 px-3 py-3 text-sm font-black text-lagoon shadow-glow backdrop-blur transition hover:bg-white sm:px-4"
          >
            {settingsOpen ? "Κλείσιμο" : "Αναζήτηση"}
          </button>

          <button
            type="button"
            onClick={() => {
              setUserPanelOpen(false);
              openTripPanel();
            }}
            className="rounded-2xl border border-white/70 bg-white/95 px-3 py-3 text-sm font-black text-lagoon shadow-glow backdrop-blur transition hover:bg-white sm:px-4"
          >
            Trips {trips.length > 0 ? `(${trips.length})` : ""}
          </button>

          {activeTrip && activeUser && (
            <button
              type="button"
              onClick={() => editTrip(activeTrip)}
              className="rounded-2xl border border-kelp/30 bg-kelp px-3 py-3 text-sm font-black text-white shadow-glow transition hover:bg-ink sm:px-4"
            >
              <span className="sm:hidden">Ενεργό trip</span>
              <span className="hidden sm:inline">Συνέχεια ενεργής εξόρμησης</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setSettingsOpen(false);
              setTripPanelOpen(false);
              setUserPanelOpen((open) => !open);
            }}
            className={`rounded-2xl border px-3 py-3 text-sm font-black shadow-glow backdrop-blur transition sm:px-4 ${activeUser ? "border-kelp/30 bg-kelp text-white" : "border-white/70 bg-white/95 text-lagoon hover:bg-white"}`}
          >
            {activeUser ? `@${activeUser.username}` : "Connect"}
          </button>

          {pickedPoint && !settingsOpen && !tripPanelOpen && !infoSpot && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={analyzePickedPoint} disabled={isPending || gpsLoading} className="rounded-2xl bg-kelp px-4 py-3 text-sm font-black text-white shadow-glow transition hover:bg-ink disabled:cursor-wait disabled:opacity-60">
                Ανάλυση εδώ
              </button>
              <button type="button" onClick={searchNearbyPickedPoint} disabled={isPending || gpsLoading} className="rounded-2xl bg-lagoon px-4 py-3 text-sm font-black text-white shadow-glow transition hover:bg-ink disabled:cursor-wait disabled:opacity-60">
                Σημεία κοντά
              </button>
            </div>
          )}

        </div>
      </div>

      {userPanelOpen && (
        <UserConnectPanel
          activeUser={activeUser}
          onConnected={(user) => void connectUser(user)}
          onDisconnect={() => void disconnectUser()}
          onClose={() => setUserPanelOpen(false)}
        />
      )}

      {settingsOpen && (
        <section className="absolute left-3 right-3 top-[4.6rem] z-30 max-h-[calc(100svh-9rem)] overflow-y-auto rounded-[1.5rem] border border-white/80 bg-white/95 p-3 shadow-glow backdrop-blur sm:left-4 sm:right-auto sm:w-[25rem] sm:p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.25em] text-lagoon">Ρυθμίσεις χάρτη</p>
              <h1 className="mt-1 text-xl font-black text-ink">Αναζήτηση</h1>
            </div>
            <button type="button" onClick={() => setSettingsOpen(false)} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600">
              x
            </button>
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-black uppercase tracking-[0.16em] text-slate-500">Τύπος ψαρέματος</span>
              <select
                value={technique}
                onChange={(event) => setTechnique(event.target.value as TechniqueId)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-tide focus:bg-white focus:ring-4 focus:ring-tide/15"
              >
                {Object.values(TECHNIQUE_PROFILES).map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-black uppercase tracking-[0.16em] text-slate-500">Περιοχή</span>
                <input
                  id="spot-location"
                  value={locationInput}
                  onChange={(event) => setLocationInput(event.target.value)}
                  placeholder="π.χ. Γύθειο"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-tide focus:bg-white focus:ring-4 focus:ring-tide/15"
                />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-black uppercase tracking-[0.16em] text-slate-500">Αποτελέσματα</span>
                <select
                  value={resultLimit}
                  onChange={(event) => setResultLimit(Number(event.target.value))}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-tide focus:bg-white focus:ring-4 focus:ring-tide/15"
                >
                  {RESULT_LIMIT_OPTIONS.map((limit) => (
                    <option key={limit} value={limit}>{limit} σημεία</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-black uppercase tracking-[0.16em] text-slate-500">Ακτίνα</span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={radiusKm}
                  onChange={(event) => setRadiusKm(Number(event.target.value))}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-tide focus:bg-white focus:ring-4 focus:ring-tide/15"
                />
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-black uppercase tracking-[0.16em] text-slate-500">Στόχος ψαριού</span>
              <input
                list="target-fish-options"
                value={targetFish}
                onChange={(event) => setTargetFish(event.target.value)}
                placeholder="π.χ. λαβράκι, τσιπούρα"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-tide focus:bg-white focus:ring-4 focus:ring-tide/15"
              />
              <datalist id="target-fish-options">
                {POPULAR_TARGET_FISH.map((fish) => (
                  <option key={fish} value={fish} />
                ))}
              </datalist>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-black uppercase tracking-[0.16em] text-slate-500">Χρονικό παράθυρο</span>
              <select
                value={timeHint}
                onChange={(event) => setTimeHint(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-tide focus:bg-white focus:ring-4 focus:ring-tide/15"
              >
                {TIME_HINT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            {pickedPoint && (
              <div className="rounded-2xl border border-kelp/20 bg-kelp/10 p-3 text-xs font-bold leading-5 text-kelp">
                <p className="font-black uppercase tracking-[0.16em]">Σημείο χάρτη</p>
                <p className="mt-1">{pickedPoint.lat.toFixed(5)}, {pickedPoint.lon.toFixed(5)}</p>
                {typeof gpsAccuracyM === "number" && <p>Ακρίβεια GPS ±{Math.round(gpsAccuracyM)}μ</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={analyzePickedPoint} disabled={isPending || gpsLoading} className="rounded-xl bg-kelp px-3 py-2 text-white disabled:opacity-60">
                    Ανάλυση εδώ
                  </button>
                  <button type="button" onClick={searchNearbyPickedPoint} disabled={isPending || gpsLoading} className="rounded-xl bg-lagoon px-3 py-2 text-white disabled:opacity-60">
                    Σημεία κοντά
                  </button>
                  <button type="button" onClick={() => openTripPanel(undefined)} className="rounded-xl border border-kelp/30 bg-white px-3 py-2 text-kelp">
                    Trip εδώ
                  </button>
                  <button type="button" onClick={clearPickedPoint} className="rounded-xl border border-kelp/30 bg-white px-3 py-2 text-kelp">
                    Καθαρισμός
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button type="submit" disabled={isPending || gpsLoading} className="rounded-2xl bg-lagoon px-3 py-3 text-sm font-black text-white transition hover:bg-ink disabled:cursor-wait disabled:opacity-60">
                {isPending ? "Σάρωση" : pickedPoint ? "Σημεία κοντά" : "Αναζήτηση"}
              </button>
              <button type="button" onClick={() => void searchGpsLocation()} disabled={isPending || gpsLoading} className="rounded-2xl border border-tide/40 bg-tide/10 px-4 py-3 text-sm font-black text-lagoon transition hover:bg-lagoon hover:text-white disabled:cursor-wait disabled:opacity-60">
                {gpsLoading ? "GPS..." : "GPS"}
              </button>
            </div>
          </form>

          {cacheMessage && <div className="mt-3 rounded-2xl border border-tide/30 bg-tide/10 p-3 text-xs font-bold leading-5 text-lagoon">{cacheMessage} <button type="button" onClick={() => void flushCache()} className="ml-2 underline">clear</button></div>}
          {error && <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</div>}
        </section>
      )}

      {!infoSpot && !tripPanelOpen && (
        <div className="absolute right-3 top-[4.6rem] z-20 grid gap-2 rounded-2xl border border-white/70 bg-white/95 p-2 shadow-glow backdrop-blur sm:right-4">
          {(["terrain", "satellite", "street"] as const).map((layer) => (
            <button
              key={layer}
              type="button"
              onClick={() => setBaseLayer(layer)}
              className={`rounded-xl px-3 py-2 text-xs font-black transition ${baseLayer === layer ? "bg-ink text-white" : "bg-white text-lagoon hover:bg-slate-50"}`}
            >
              {baseLayerLabel(layer)}
            </button>
          ))}
        </div>
      )}

      {response && response.mode !== "point" && !infoSpot && !tripPanelOpen && !settingsOpen && (
        <section className="absolute bottom-3 left-3 right-3 z-20 max-h-[37svh] overflow-hidden rounded-[1.4rem] border border-white/80 bg-white/95 p-3 shadow-glow backdrop-blur sm:bottom-4 sm:left-4 sm:right-auto sm:max-h-none sm:max-w-[34rem]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-lagoon">{response.intent.techniqueLabel} · {response.spots.length}/{response.resultLimit}</p>
              <h2 className="mt-1 line-clamp-1 text-lg font-black text-ink">{selectedSpot ? `#${selectedSpot.rank} ${selectedSpot.name}` : response.intent.locationText}</h2>
              {selectedSpot ? <SelectedSpotSummary spot={selectedSpot} /> : <p className="mt-1 text-sm text-slate-600">Διάλεξε marker στον χάρτη.</p>}
            </div>
            <div className="grid shrink-0 gap-2">
              {selectedSpot && (
                <button type="button" onClick={() => setInfoSpotId(selectedSpot.id)} className="rounded-2xl bg-lagoon px-3 py-2 text-xs font-black text-white">
                  Info
                </button>
              )}
              {selectedSpot && (
                <button type="button" onClick={() => openTripPanel(selectedSpot)} className="rounded-2xl bg-kelp px-3 py-2 text-xs font-black text-white">
                  Trip
                </button>
              )}
              <button type="button" onClick={() => setSettingsOpen(true)} className="rounded-2xl bg-ink px-3 py-2 text-xs font-black text-white">
                Search
              </button>
            </div>
          </div>
          {response.spots.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {response.spots.slice(0, 12).map((spot) => (
                <button
                  key={spot.id}
                  type="button"
                  onClick={() => setSelectedSpotId(spot.id)}
                  className={`min-w-[9rem] rounded-2xl border px-3 py-2 text-left transition ${selectedSpot?.id === spot.id ? "border-lagoon bg-lagoon text-white" : "border-slate-200 bg-white text-ink hover:border-lagoon/50"}`}
                >
                  <span className="block text-[10px] font-black uppercase tracking-[0.16em]">#{spot.rank} · {spot.score}/100</span>
                  <span className="mt-1 block line-clamp-2 text-xs font-black leading-4">{spot.name}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {response?.mode === "point" && response.pointAnalysis && selectedSpot && !tripPanelOpen && !settingsOpen && (
        <PointAnalysisSheet
          analysis={response.pointAnalysis}
          response={response}
          spot={selectedSpot}
          gpsAccuracyM={gpsAccuracyM}
          onSaveTrip={() => openTripPanel(selectedSpot)}
          onClose={() => setSettingsOpen(true)}
        />
      )}

      {response?.mode !== "point" && infoSpot && <SpotInfoSheet spot={infoSpot} onSaveTrip={() => openTripPanel(infoSpot)} onClose={() => setInfoSpotId(undefined)} />}
      {tripPanelOpen && (
        <TripLogSheet
          response={response}
          selectedSpot={selectedSpot}
          customTripPoint={customTripPoint}
          trips={trips}
          tripDate={tripDate}
          tripFishRecords={tripFishRecords}
          tripFishDraft={tripFishDraft}
          tripNotes={tripNotes}
          activeUser={activeUser}
          tripVisibility={tripVisibility}
          tripSaving={tripSaving}
          mediaSavingKey={mediaSavingKey}
          editingTrip={editingTrip}
          activeTrip={activeTrip}
          error={error}
          onClose={() => setTripPanelOpen(false)}
          onSelectSpot={(spotId) => {
            setCustomTripPoint(undefined);
            setSelectedSpotId(spotId);
            setInfoSpotId(undefined);
          }}
          onTripDateChange={setTripDate}
          onSelectFishSpecies={selectTripFishSpecies}
          onTripFishDraftChange={updateTripFishDraft}
          onAddTripFish={addTripFish}
          onRemoveTripFish={removeTripFishRecord}
          onTripNotesChange={setTripNotes}
          onTripVisibilityChange={setTripVisibility}
          onSaveTrip={() => void saveTrip()}
          onSaveTripEdits={() => void saveTripEdits()}
          onFinishTrip={() => void finishTrip()}
          onRemoveTrip={(id) => void removeTrip(id)}
          onChangeTripVisibility={(id, visibility) => void changeTripVisibility(id, visibility)}
          onEditTrip={editTrip}
          onAddImages={(tripId, files, fishRecordId) => void addTripImages(tripId, files, fishRecordId)}
          onRemoveImage={(tripId, mediaId) => void removeTripImage(tripId, mediaId)}
        />
      )}
    </main>
  );
}

function PointAnalysisSheet({
  analysis,
  response,
  spot,
  gpsAccuracyM,
  onSaveTrip,
  onClose,
}: {
  analysis: PointAnalysis;
  response: SpotsApiResponse;
  spot: RankedSpot;
  gpsAccuracyM?: number;
  onSaveTrip: () => void;
  onClose: () => void;
}) {
  const accuracy = analysis.gpsAccuracyM ?? gpsAccuracyM;
  const cast = analysis.castRecommendation;
  const hasWater = spot.depth.hasNearbyWater;
  const warnings = uniqueValues([...response.warnings, ...spot.warnings]);

  return (
    <section className="absolute bottom-0 left-0 right-0 z-40 max-h-[70svh] overflow-y-auto rounded-t-[1.8rem] border border-white/80 bg-white p-4 shadow-glow sm:bottom-4 sm:left-4 sm:right-auto sm:max-h-[78svh] sm:w-[31rem] sm:rounded-[1.8rem]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-kelp">Ανάλυση σημείου</p>
          <h2 className="mt-1 text-xl font-black text-ink">{spot.name}</h2>
          <p className={`mt-2 rounded-2xl px-3 py-2 text-sm font-black leading-5 ${!hasWater ? "border border-red-200 bg-red-50 text-red-800" : analysis.adjustedToWater ? "border border-amber-200 bg-amber-50 text-amber-900" : "border border-tide/25 bg-tide/10 text-lagoon"}`}>
            {!hasWater
              ? "Δεν εντοπίστηκε μετρημένο νερό έως 1,2χλμ από το επιλεγμένο σημείο."
              : analysis.adjustedToWater
              ? `Κοντινότερο δειγματοληπτικό σημείο νερού στα ${formatMetric(analysis.waterDistanceM, "μ", 0)}${typeof analysis.waterBearingDeg === "number" ? ` προς ${formatBearing(analysis.waterBearingDeg)}` : ""}.`
              : "Το επιλεγμένο στίγμα αναλύθηκε ακριβώς στο νερό."}
          </p>
        </div>
        <div className="grid shrink-0 gap-2">
          <button type="button" onClick={onSaveTrip} className="rounded-full bg-kelp px-3 py-1.5 text-xs font-black text-white">Trip</button>
          <button type="button" onClick={onClose} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600">x</button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-ink">
        <InfoRow label="Ζητήθηκε" value={formatCoordinates(analysis.requestedPoint)} />
        <InfoRow label="Αναλύθηκε" value={formatCoordinates(analysis.analyzedPoint)} />
        <InfoRow label="Απόσταση νερού" value={hasWater ? formatMetric(analysis.waterDistanceM, "μ", 0) : unavailable()} />
        <InfoRow label="Ακρίβεια GPS" value={typeof accuracy === "number" ? `±${formatMetric(accuracy, "μ", 0)}` : unavailable()} />
      </div>

      <AnalysisSection title="Τρέχων καιρός">
        <div className="grid grid-cols-2 gap-2 text-xs font-bold sm:grid-cols-3">
          <AnalysisMetric label="Θερμοκρασία" value={formatMetric(spot.weather.airTemperatureC, "°C")} />
          <AnalysisMetric label="Αισθητή" value={formatMetric(spot.weather.apparentTemperatureC, "°C")} />
          <AnalysisMetric label="Άνεμος" value={formatWind(spot.weather.windSpeedKmh, spot.weather.windDirectionDeg)} />
          <AnalysisMetric label="Ριπές" value={formatMetric(spot.weather.gustKmh, "km/h")} />
          <AnalysisMetric label="Υγρασία" value={formatMetric(spot.weather.relativeHumidityPct, "%", 0)} />
          <AnalysisMetric label="Πίεση" value={formatPressure(spot.weather.pressureHpa, spot.weather.pressureTrend)} />
          <AnalysisMetric label="Βροχή" value={formatMetric(spot.weather.precipitationMm, "mm")} />
          <AnalysisMetric label="Νέφωση" value={formatMetric(spot.weather.cloudCoverPct, "%", 0)} />
          <AnalysisMetric label="Ορατότητα" value={formatVisibility(spot.weather.visibilityM)} />
        </div>
      </AnalysisSection>

      <AnalysisSection title="Θάλασσα">
        <div className="grid grid-cols-2 gap-2 text-xs font-bold sm:grid-cols-3">
          <AnalysisMetric label="Κύμα" value={formatSeaState(spot.marine.waveHeightM, spot.marine.waveDirectionDeg, spot.marine.wavePeriodS)} />
          <AnalysisMetric label="Swell" value={formatSeaState(spot.marine.swellHeightM, spot.marine.swellDirectionDeg, spot.marine.swellPeriodS)} />
          <AnalysisMetric label="Θερμ. νερού" value={formatMetric(spot.marine.seaSurfaceTemperatureC, "°C")} />
          <AnalysisMetric label="Ρεύμα" value={formatWind(spot.marine.currentSpeedKmh, spot.marine.currentDirectionDeg)} />
          <AnalysisMetric label="Στάθμη MSL" value={formatMetric(spot.marine.seaLevelMslM, "μ")} />
          <AnalysisMetric label="Βεβαιότητα" value={confidenceLabel(spot.marine.confidence)} />
        </div>
      </AnalysisSection>

      <AnalysisSection title="Βάθος και βυθός">
        <div className="grid grid-cols-2 gap-2 text-xs font-bold">
          <InfoRow label="Βάθος βολής" value={formatMetric(spot.depth.castingDepthM, "μ")} />
          <InfoRow label="Κοντινό ψαρεύσιμο" value={formatMetric(spot.depth.closestFishableDepthM, "μ")} />
          <InfoRow label="Μέγιστο δείγμα" value={formatMetric(spot.depth.maxDepthM, "μ")} />
          <InfoRow label="Κλίση" value={spot.depthStyle || unavailable()} />
          <InfoRow label="Πηγή" value={spot.depthSourceLabel || unavailable()} />
          <InfoRow label="Βεβαιότητα" value={confidenceLabel(spot.depth.confidence)} />
          <InfoRow label="Βυθός" value={spot.seabedLabel || unavailable()} />
          <InfoRow label="Σκαλώματα" value={spot.snagRiskLabel || unavailable()} />
        </div>
        <DepthProfileGraphic spot={spot} />
      </AnalysisSection>

      <AnalysisSection title="Πρόταση βολής">
        {cast ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 text-xs font-bold">
              <InfoRow label="Κατεύθυνση" value={`${formatBearing(cast.bearingDeg)}${cast.direction ? ` · ${cast.direction}` : ""}`} />
              <InfoRow label="Απόσταση" value={formatMetric(cast.distanceM, "μ", 0)} />
              <InfoRow label="Στόχος" value={formatCoordinates(cast.target)} />
              <InfoRow label="Βάθος στόχου" value={formatMetric(cast.targetDepthM, "μ")} />
              <InfoRow label="Βεβαιότητα" value={confidenceLabel(cast.confidence)} />
            </div>
            <p className="rounded-2xl bg-slate-50 p-3 text-sm font-semibold leading-6 text-slate-700">{cast.rationale || unavailable()}</p>
          </div>
        ) : (
          <p className="rounded-2xl bg-slate-50 p-3 text-sm font-semibold text-slate-600">Δεν υπάρχει διαθέσιμη πρόταση βολής.</p>
        )}
      </AnalysisSection>

      {warnings.length > 0 && (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-900">
          <p className="text-[10px] font-black uppercase tracking-[0.18em]">Προειδοποιήσεις</p>
          <p className="mt-1">{warnings.join(" ")}</p>
        </div>
      )}
    </section>
  );
}

function AnalysisSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-lagoon">{title}</p>
      {children}
    </div>
  );
}

function AnalysisMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-1 leading-5 text-ink">{value}</p>
    </div>
  );
}

function SpotInfoSheet({ spot, onSaveTrip, onClose }: { spot: RankedSpot; onSaveTrip: () => void; onClose: () => void }) {
  return (
    <section className="absolute bottom-0 left-0 right-0 z-40 max-h-[82svh] overflow-y-auto rounded-t-[1.8rem] border border-white/80 bg-white p-4 shadow-glow sm:bottom-4 sm:left-auto sm:right-4 sm:w-[28rem] sm:rounded-[1.8rem]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-lagoon">#{spot.rank} · {spot.score}/100 · {categoryLabel(spot.category)}</p>
          <h2 className="mt-1 text-xl font-black text-ink">{spot.name}</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">{spot.distanceKm.toFixed(1)}χλμ από το κέντρο</p>
        </div>
        <div className="grid shrink-0 gap-2">
          <button type="button" onClick={onSaveTrip} className="rounded-full bg-kelp px-3 py-1.5 text-xs font-black text-white">Trip</button>
          <button type="button" onClick={onClose} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600">x</button>
        </div>
      </div>

      <p className="mt-3 text-sm font-bold leading-6 text-slate-700">{spot.summary}</p>

      <div className="mt-3 grid gap-2 text-xs font-bold text-ink">
        <InfoRow label="Συνθήκες" value={spot.conditionsLabel} />
        <InfoRow label="Βάθος" value={spot.techniqueDepthRange.label} />
        <InfoRow label="Προφίλ βολής" value={depthProfileText(spot)} />
        <InfoRow label="Βυθός" value={`${spot.seabedLabel} · σκαλώματα ${spot.snagRiskLabel}`} />
        <InfoRow label="Ψάρια" value={spot.likelyFish.slice(0, 6).join(", ")} />
        <InfoRow label="Δολώματα" value={spot.bait.slice(0, 4).join(", ")} />
        <InfoRow label="Ώρα" value={spot.bestWindow} />
        <InfoRow label="Πρόσβαση" value={accessLabel(spot.access.rating)} />
        <InfoRow label="Πηγή βάθους" value={spot.depthSourceLabel} />
      </div>

      <DepthProfileGraphic spot={spot} />

      <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm font-semibold leading-6 text-slate-700">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-lagoon">Συμβουλή</p>
        <p className="mt-1">{spot.castingAdvice}</p>
      </div>

      {spot.warnings.length > 0 && <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-900">{spot.warnings.join(" ")}</div>}
    </section>
  );
}

function TripLogSheet({
  response,
  selectedSpot,
  customTripPoint,
  trips,
  tripDate,
  tripFishRecords,
  tripFishDraft,
  tripNotes,
  activeUser,
  tripVisibility,
  tripSaving,
  mediaSavingKey,
  editingTrip,
  activeTrip,
  error,
  onClose,
  onSelectSpot,
  onTripDateChange,
  onSelectFishSpecies,
  onTripFishDraftChange,
  onAddTripFish,
  onRemoveTripFish,
  onTripNotesChange,
  onTripVisibilityChange,
  onSaveTrip,
  onSaveTripEdits,
  onFinishTrip,
  onRemoveTrip,
  onChangeTripVisibility,
  onEditTrip,
  onAddImages,
  onRemoveImage,
}: {
  response?: SpotsApiResponse;
  selectedSpot?: RankedSpot;
  customTripPoint?: Coordinates;
  trips: SavedFishingTrip[];
  tripDate: string;
  tripFishRecords: TripFishRecord[];
  tripFishDraft: TripFishDraft;
  tripNotes: string;
  activeUser?: ApiUser;
  tripVisibility: TripVisibility;
  tripSaving: boolean;
  mediaSavingKey?: string;
  editingTrip?: SavedFishingTrip;
  activeTrip: SavedFishingTrip | null;
  error?: string;
  onClose: () => void;
  onSelectSpot: (spotId: string) => void;
  onTripDateChange: (value: string) => void;
  onSelectFishSpecies: (fish: string) => void;
  onTripFishDraftChange: (field: keyof TripFishDraft, value: string | boolean) => void;
  onAddTripFish: () => void;
  onRemoveTripFish: (id: string) => void;
  onTripNotesChange: (value: string) => void;
  onTripVisibilityChange: (value: TripVisibility) => void;
  onSaveTrip: () => void;
  onSaveTripEdits: () => void;
  onFinishTrip: () => void;
  onRemoveTrip: (id: string) => void;
  onChangeTripVisibility: (id: string, visibility: TripVisibility) => void;
  onEditTrip: (trip: SavedFishingTrip) => void;
  onAddImages: (tripId: string, files: File[], fishRecordId?: string) => void;
  onRemoveImage: (tripId: string, mediaId: string) => void;
}) {
  const tripSpot = customTripPoint ? undefined : selectedSpot;
  const pointMode = response?.mode === "point";
  const tripCoordinates = pointMode && response?.pointAnalysis ? response.pointAnalysis.requestedPoint : tripSpot;
  const fishOptions = uniqueValues([...(tripSpot?.likelyFish ?? []), ...POPULAR_TARGET_FISH]).slice(0, 10);
  const canSave = Boolean(activeUser && !activeTrip && (tripSpot || customTripPoint) && !tripSaving);
  const isOwnerEditing = Boolean(editingTrip && activeUser?.id === editingTrip.userId);

  return (
    <section className="absolute bottom-0 left-0 right-0 z-40 max-h-[88svh] overflow-y-auto rounded-t-[1.8rem] border border-white/80 bg-white p-4 shadow-glow sm:bottom-4 sm:left-auto sm:right-4 sm:w-[31rem] sm:rounded-[1.8rem]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-kelp">{editingTrip ? `${editingTrip.status === "active" ? "Ενεργή" : "Ολοκληρωμένη"} εξόρμηση` : "Fishing trips"}</p>
          <h2 className="mt-1 text-xl font-black text-ink">{editingTrip ? editingTrip.locationName : "Νέα εξόρμηση"}</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">{editingTrip ? "Οι αλλαγές αποθηκεύονται απευθείας στο trip." : "Ξεκίνα τώρα και πρόσθεσε ψάρια ή εικόνες στη συνέχεια."}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600">x</button>
      </div>

      <div className="mt-4 space-y-3">
        {!activeUser && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold leading-6 text-amber-900">
            Συνδέσου με username για να αποθηκεύσεις εξόρμηση. Μπορείς ήδη να δεις τις δημόσιες εξορμήσεις άλλων χρηστών.
          </div>
        )}
        {!editingTrip && activeTrip && (
          <button type="button" onClick={() => onEditTrip(activeTrip)} className="w-full rounded-2xl border border-kelp/30 bg-kelp/10 p-3 text-left text-sm font-black leading-6 text-kelp transition hover:bg-kelp hover:text-white">
            Έχεις ενεργή εξόρμηση στο {activeTrip.locationName}. Πάτησε για να συνεχίσεις ή να την ολοκληρώσεις.
          </button>
        )}
        {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</div>}
        {editingTrip ? (
          <div className="rounded-2xl border border-kelp/20 bg-kelp/10 p-3 text-sm font-bold leading-6 text-kelp">
            <p className="text-[10px] font-black uppercase tracking-[0.18em]">Τοποθεσία</p>
            <p className="mt-1 text-ink">{editingTrip.locationName}</p>
            <p className="mt-1">{editingTrip.lat.toFixed(5)}, {editingTrip.lon.toFixed(5)}</p>
          </div>
        ) : customTripPoint ? (
          <div className="rounded-2xl border border-kelp/20 bg-kelp/10 p-3 text-sm font-bold leading-6 text-kelp">
            <p className="text-[10px] font-black uppercase tracking-[0.18em]">Τοποθεσία</p>
            <p className="mt-1 text-ink">Σημείο χάρτη</p>
            <p className="mt-1">{customTripPoint.lat.toFixed(5)}, {customTripPoint.lon.toFixed(5)}</p>
            <p className="mt-2 text-xs text-kelp/80">Χειροκίνητη εγγραφή χωρίς βαθμολογία, καιρό/θάλασσα ή βάθος από αναζήτηση.</p>
          </div>
        ) : response?.spots.length ? (
          <label className="block">
            <span className="mb-1 block text-xs font-black uppercase tracking-[0.16em] text-slate-500">Τοποθεσία</span>
            <select
              value={selectedSpot?.id ?? ""}
              onChange={(event) => onSelectSpot(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-tide focus:bg-white focus:ring-4 focus:ring-tide/15"
            >
              {response.spots.map((spot) => (
                <option key={spot.id} value={spot.id}>{pointMode ? spot.name : `#${spot.rank} ${spot.name}`}</option>
              ))}
            </select>
          </label>
        ) : (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold leading-6 text-amber-900">
            Κάνε πρώτα αναζήτηση για ranked σημείο ή πάτα σημείο στον χάρτη για χειροκίνητη εξόρμηση.
          </div>
        )}

        {!editingTrip && tripSpot && (
          <div className="rounded-2xl border border-tide/20 bg-tide/10 p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-lagoon">Snapshot που θα αποθηκευτεί</p>
            <p className="mt-1 text-sm font-black text-ink">{tripSpot.name}</p>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <TripMetric label="Στίγμα trip" value={tripCoordinates ? `${tripCoordinates.lat.toFixed(5)}, ${tripCoordinates.lon.toFixed(5)}` : unavailable()} />
              {!pointMode && <TripMetric label="Σκορ" value={`${tripSpot.score}/100`} />}
              <TripMetric label="Καιρός/θάλασσα" value={tripSpot.conditionsLabel} />
              <TripMetric label="Βυθός" value={`${tripSpot.techniqueDepthRange.label} ${tripSpot.seabedLabel}`} />
            </div>
            <DepthProfileGraphic spot={tripSpot} compact />
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-xs font-black uppercase tracking-[0.16em] text-slate-500">Ημερομηνία</span>
          <input
            type="datetime-local"
            value={tripDate}
            onChange={(event) => onTripDateChange(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-tide focus:bg-white focus:ring-4 focus:ring-tide/15"
          />
        </label>

        <fieldset className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <legend className="px-1 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Ορατότητα</legend>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {(["private", "public"] as const).map((visibility) => (
              <button
                key={visibility}
                type="button"
                onClick={() => onTripVisibilityChange(visibility)}
                className={`rounded-2xl border px-3 py-3 text-xs font-black transition ${tripVisibility === visibility ? "border-kelp bg-kelp text-white" : "border-slate-200 bg-white text-slate-700"}`}
              >
                {visibility === "private" ? "Ιδιωτική" : "Δημόσια"}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">{tripVisibility === "private" ? "Ορατή μόνο σε εσένα." : "Ορατή σε όλους τους χρήστες και επισκέπτες."}</p>
        </fieldset>

        {isOwnerEditing && editingTrip && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Εικόνες εξόρμησης</p>
              <span className="text-[10px] font-black text-slate-400">{editingTrip.images.length}/20</span>
            </div>
            <MediaGallery
              images={editingTrip.images}
              username={activeUser?.username}
              editable
              busyKey={mediaSavingKey}
              onRemove={(mediaId) => onRemoveImage(editingTrip.id, mediaId)}
            />
            <label className={`mt-3 block cursor-pointer rounded-2xl border border-dashed border-tide/50 bg-white px-4 py-3 text-center text-xs font-black text-lagoon transition hover:border-lagoon ${mediaSavingKey === "trip" || editingTrip.images.length >= 20 ? "pointer-events-none opacity-50" : ""}`}>
              {mediaSavingKey === "trip" ? "Μεταφόρτωση..." : "Πρόσθεσε εικόνες"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="sr-only"
                disabled={Boolean(mediaSavingKey) || editingTrip.images.length >= 20}
                onChange={(event) => {
                  onAddImages(editingTrip.id, Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
            </label>
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Add fish</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {fishOptions.map((fish) => (
              <button
                key={fish}
                type="button"
                onClick={() => onSelectFishSpecies(fish)}
                className={`rounded-full border px-3 py-2 text-xs font-black transition ${tripFishDraft.species === fish ? "border-kelp bg-kelp text-white" : "border-slate-200 bg-white text-ink hover:border-kelp/40"}`}
              >
                {fish}
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="col-span-2 block">
              <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">Είδος</span>
              <input
                value={tripFishDraft.species}
                onChange={(event) => onTripFishDraftChange("species", event.target.value)}
                placeholder="π.χ. λαβράκι"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold outline-none transition focus:border-tide focus:ring-4 focus:ring-tide/15"
              />
            </label>
            <MetricInput label="Πλήθος" value={tripFishDraft.count} onChange={(value) => onTripFishDraftChange("count", value)} type="number" min="1" />
            <MetricInput label="Βάρος kg" value={tripFishDraft.weightKg} onChange={(value) => onTripFishDraftChange("weightKg", value)} type="number" min="0" step="0.01" />
            <MetricInput label="Μήκος cm" value={tripFishDraft.lengthCm} onChange={(value) => onTripFishDraftChange("lengthCm", value)} type="number" min="0" step="0.1" />
            <MetricInput label="Δόλωμα" value={tripFishDraft.bait} onChange={(value) => onTripFishDraftChange("bait", value)} />
            <label className="col-span-2 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-black text-ink">
              <span>Released / C&R</span>
              <input
                type="checkbox"
                checked={tripFishDraft.released}
                onChange={(event) => onTripFishDraftChange("released", event.target.checked)}
                className="h-5 w-5 accent-kelp"
              />
            </label>
            <label className="col-span-2 block">
              <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">Fish notes</span>
              <input
                value={tripFishDraft.notes}
                onChange={(event) => onTripFishDraftChange("notes", event.target.value)}
                placeholder="ώρα, τρόπο που πήρε, κατάσταση"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold outline-none transition focus:border-tide focus:ring-4 focus:ring-tide/15"
              />
            </label>
          </div>

          <button type="button" onClick={onAddTripFish} disabled={tripSaving} className="mt-3 w-full rounded-2xl bg-kelp px-4 py-3 text-sm font-black text-white transition hover:bg-ink disabled:opacity-50">
            {tripSaving ? "Αποθήκευση..." : "Add fish"}
          </button>

          {tripFishRecords.length > 0 && (
            <div className="mt-3 space-y-2">
              {tripFishRecords.map((record) => (
                <article key={record.id} className="rounded-2xl border border-kelp/20 bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-ink">{formatFishRecordSummary(record)}</p>
                      <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">{fishRecordMetrics(record)}</p>
                    </div>
                    <button type="button" onClick={() => onRemoveTripFish(record.id)} disabled={tripSaving} className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-500 disabled:opacity-50">remove</button>
                  </div>
                   {record.notes && <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">{record.notes}</p>}
                  {editingTrip && (
                    <>
                      <MediaGallery
                        images={record.images}
                        username={activeUser?.username}
                        editable={isOwnerEditing}
                        busyKey={mediaSavingKey}
                        onRemove={(mediaId) => onRemoveImage(editingTrip.id, mediaId)}
                      />
                      {isOwnerEditing && (
                        <label className={`mt-2 block cursor-pointer rounded-xl border border-dashed border-tide/40 bg-slate-50 px-3 py-2 text-center text-[10px] font-black text-lagoon ${mediaSavingKey === record.id || record.images.length >= 5 ? "pointer-events-none opacity-50" : ""}`}>
                          {mediaSavingKey === record.id ? "Μεταφόρτωση..." : `Εικόνες ψαριού ${record.images.length}/5`}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            multiple
                            className="sr-only"
                            disabled={Boolean(mediaSavingKey) || record.images.length >= 5}
                            onChange={(event) => {
                              onAddImages(editingTrip.id, Array.from(event.target.files ?? []), record.id);
                              event.target.value = "";
                            }}
                          />
                        </label>
                      )}
                    </>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-black uppercase tracking-[0.16em] text-slate-500">Σημειώσεις</span>
          <textarea
            value={tripNotes}
            onChange={(event) => onTripNotesChange(event.target.value)}
            rows={3}
            placeholder="δόλωμα, ώρα που πήρε, φάση νερού, παρατηρήσεις"
            className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-tide focus:bg-white focus:ring-4 focus:ring-tide/15"
          />
        </label>

        {editingTrip ? (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={onSaveTripEdits} disabled={tripSaving} className="rounded-2xl bg-lagoon px-4 py-3 text-sm font-black text-white transition hover:bg-ink disabled:opacity-50">
              {tripSaving ? "Αποθήκευση..." : "Αποθήκευση αλλαγών"}
            </button>
            {editingTrip.status === "active" ? (
              <button type="button" onClick={onFinishTrip} disabled={tripSaving} className="rounded-2xl bg-kelp px-4 py-3 text-sm font-black text-white transition hover:bg-ink disabled:opacity-50">
                Ολοκλήρωση trip
              </button>
            ) : (
              <div className="grid place-items-center rounded-2xl bg-slate-100 px-4 py-3 text-center text-xs font-black text-slate-500">Ολοκληρώθηκε {editingTrip.completedAt ? formatTripDate(editingTrip.completedAt) : ""}</div>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={onSaveTrip}
            disabled={!canSave}
            className="w-full rounded-2xl bg-kelp px-4 py-3 text-sm font-black text-white transition hover:bg-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {tripSaving ? "Έναρξη..." : "Έναρξη ενεργής εξόρμησης"}
          </button>
        )}
      </div>

      <div className="mt-5 border-t border-slate-200 pt-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-lagoon">Αποθηκευμένες</p>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-500">{trips.length}</span>
        </div>
        {trips.length === 0 ? (
          <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm font-semibold text-slate-600">Δεν υπάρχει ακόμα αποθηκευμένη εξόρμηση.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {trips.map((trip) => (
              <article key={trip.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                <button type="button" onClick={() => activeUser?.id === trip.userId && onEditTrip(trip)} className={`w-full text-left ${activeUser?.id === trip.userId ? "cursor-pointer" : "cursor-default"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-kelp">@{trip.username} · {formatTripDate(trip.tripDate)} · {trip.techniqueLabel}</p>
                      <h3 className="mt-1 line-clamp-1 text-sm font-black text-ink">{trip.locationName}</h3>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${trip.status === "active" ? "bg-kelp text-white" : "bg-slate-100 text-slate-500"}`}>{trip.status}</span>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${trip.visibility === "public" ? "bg-tide/15 text-lagoon" : "bg-slate-100 text-slate-500"}`}>{trip.visibility}</span>
                    </div>
                  </div>
                  {activeUser?.id === trip.userId && <p className="mt-2 text-[10px] font-black uppercase tracking-[0.14em] text-lagoon">Πάτησε για επεξεργασία</p>}
                </button>
                <MediaGallery images={trip.images} username={activeUser?.username} />
                <div className="mt-2 space-y-1">
                  {(trip.fishRecords.length ? trip.fishRecords : fishCaughtToRecords(trip.fishCaught)).map((record) => (
                    <div key={record.id}>
                      <p className="text-xs font-bold leading-5 text-ink">
                        {formatFishRecordSummary(record)} <span className="font-semibold text-slate-500">{fishRecordMetrics(record)}</span>
                      </p>
                      <MediaGallery images={record.images} username={activeUser?.username} />
                    </div>
                  ))}
                </div>
                <p className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-600">{trip.conditionsLabel}</p>
                {trip.notes && <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold leading-5 text-slate-700">{trip.notes}</p>}
                {activeUser?.id === trip.userId && (
                  <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
                    <button type="button" onClick={() => onChangeTripVisibility(trip.id, trip.visibility === "public" ? "private" : "public")} className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black text-slate-600">Κάνε {trip.visibility === "public" ? "ιδιωτική" : "δημόσια"}</button>
                    <button type="button" onClick={() => onRemoveTrip(trip.id)} className="rounded-xl bg-slate-100 px-3 py-2 text-[10px] font-black text-slate-500">delete</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function TripMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white px-3 py-2">
      <p className="font-black uppercase tracking-[0.15em] text-slate-400">{label}</p>
      <p className="mt-1 line-clamp-3 font-bold leading-5 text-ink">{value}</p>
    </div>
  );
}

function MediaGallery({
  images,
  username,
  editable = false,
  busyKey,
  onRemove,
}: {
  images: TripMedia[];
  username?: string;
  editable?: boolean;
  busyKey?: string;
  onRemove?: (mediaId: string) => void;
}) {
  if (images.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 grid grid-cols-4 gap-2">
      {images.map((image) => (
        <div key={image.id} className="group relative aspect-square overflow-hidden rounded-xl bg-slate-100">
          <AuthenticatedImage url={image.thumbnailUrl} username={username} alt={image.originalName} />
          {editable && onRemove && (
            <button
              type="button"
              onClick={() => onRemove(image.id)}
              disabled={Boolean(busyKey)}
              aria-label={`Διαγραφή ${image.originalName}`}
              className="absolute right-1 top-1 rounded-full bg-ink/80 px-2 py-1 text-[9px] font-black text-white disabled:opacity-50"
            >
              {busyKey === image.id ? "..." : "x"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function AuthenticatedImage({ url, username, alt }: { url: string; username?: string; alt: string }) {
  const [objectUrl, setObjectUrl] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    let nextObjectUrl: string | undefined;
    setObjectUrl(undefined);

    void fetchTripImage(url, username).then((blob) => {
      if (cancelled) {
        return;
      }
      nextObjectUrl = URL.createObjectURL(blob);
      setObjectUrl(nextObjectUrl);
    }).catch(() => undefined);

    return () => {
      cancelled = true;
      if (nextObjectUrl) {
        URL.revokeObjectURL(nextObjectUrl);
      }
    };
  }, [url, username]);

  return objectUrl
    ? <img src={objectUrl} alt={alt} className="h-full w-full object-cover" />
    : <div className="grid h-full w-full place-items-center text-[9px] font-black uppercase text-slate-400">image</div>;
}

function MetricInput({
  label,
  value,
  onChange,
  type = "text",
  min,
  step,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number";
  min?: string;
  step?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">{label}</span>
      <input
        type={type}
        min={min}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold outline-none transition focus:border-tide focus:ring-4 focus:ring-tide/15"
      />
    </label>
  );
}

function DepthProfileGraphic({ spot, compact = false }: { spot: RankedSpot; compact?: boolean }) {
  const points = spot.depth.castingProfile.filter((point) => typeof point.depthM === "number");
  if (points.length === 0) {
    return null;
  }

  const chartWidth = 280;
  const waterTopY = 22;
  const baselineY = 68;
  const xStart = 28;
  const xEnd = 252;
  const depthValues = points.map((point) => point.depthM ?? 0).sort((a, b) => a - b);
  const minDepth = depthValues[0] ?? 0;
  const maxDepth = Math.max(...depthValues, 1);
  const referenceDepth = spot.depth.castingDepthM ?? depthValues[Math.floor(depthValues.length / 2)] ?? maxDepth;
  const visualMaxDepth = Math.max(1, Math.min(maxDepth, Math.max(referenceDepth * 1.8, 12)));
  const minDistance = Math.min(...points.map((point) => point.distanceM));
  const maxDistance = Math.max(...points.map((point) => point.distanceM));
  const gradientId = `depth-fill-${spot.id.replace(/[^a-zA-Z0-9_-]/g, "-")}-${compact ? "compact" : "full"}`;
  const chartPoints = points.map((point, index) => {
    const distanceRange = maxDistance - minDistance;
    const x = distanceRange === 0 ? chartWidth / 2 : xStart + ((point.distanceM - minDistance) / distanceRange) * (xEnd - xStart);
    const y = waterTopY + (Math.min(point.depthM ?? 0, visualMaxDepth) / visualMaxDepth) * (baselineY - waterTopY);
    return { ...point, x, y };
  });
  const linePoints = chartPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPath = `M ${chartPoints[0].x} ${baselineY} L ${linePoints} L ${chartPoints[chartPoints.length - 1].x} ${baselineY} Z`;
  const minPoint = chartPoints.reduce((current, point) => (point.depthM ?? 0) < (current.depthM ?? 0) ? point : current);
  const maxPoint = chartPoints.reduce((current, point) => (point.depthM ?? 0) > (current.depthM ?? 0) ? point : current);

  return (
    <div className={`${compact ? "mt-2 p-2" : "mt-3 p-3"} rounded-2xl border border-tide/25 bg-gradient-to-b from-sky-50 to-white`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-lagoon">Βάθος βολής</p>
        <div className="flex gap-1.5">
          <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-slate-500">min {minDepth.toFixed(1)}μ</span>
          <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-slate-500">max {maxDepth.toFixed(1)}μ</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${chartWidth} 82`} role="img" aria-label="Γραφικό προφίλ βάθους" className={`${compact ? "h-20" : "h-28"} mt-2 w-full overflow-visible`}>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#19a7ce" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#0b5f6f" stopOpacity="0.1" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={chartWidth} height="18" rx="4" fill="#e6d6a9" opacity="0.55" />
        <path d={`M0 20 C39 15 62 24 98 19 C134 14 160 22 196 18 C230 14 255 20 ${chartWidth} 16`} fill="none" stroke="#b18a45" strokeWidth="1.4" />
        <rect x="0" y={waterTopY} width={chartWidth} height="52" fill="#e0f7fb" opacity="0.72" />
        <path d={areaPath} fill={`url(#${gradientId})`} />
        <polyline points={linePoints} fill="none" stroke="#0b5f6f" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        {chartPoints.map((point) => (
          <g key={point.distanceM}>
            <line x1={point.x} x2={point.x} y1={waterTopY} y2="70" stroke="#0b5f6f" strokeOpacity="0.12" strokeDasharray="3 3" />
            <circle cx={point.x} cy={point.y} r="5.4" fill="#09202a" stroke="#ffffff" strokeWidth="2.4" />
            {(!compact || point === minPoint || point === maxPoint) && <text x={point.x} y={point.y < 32 ? point.y + 13 : point.y - 7} textAnchor="middle" fontSize="10" fontWeight="800" fill="#09202a" stroke="#ffffff" strokeWidth="2.5" paintOrder="stroke">{(point.depthM ?? 0).toFixed(1)}μ</text>}
            <text x={point.x} y="80" textAnchor="middle" fontSize="10" fontWeight="700" fill="#0b5f6f">{point.distanceM}μ</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
      <p className="mt-1 leading-5">{value}</p>
    </div>
  );
}

function SelectedSpotSummary({ spot }: { spot: RankedSpot }) {
  return (
    <div className="mt-2 space-y-1.5 text-xs font-bold leading-5 text-slate-700">
      <p className="line-clamp-1 sm:line-clamp-2">{spot.summary}</p>
      <p className="line-clamp-1 rounded-2xl border border-sky-100 bg-sky-50 px-3 py-2 text-ink sm:line-clamp-2">{spot.conditionsLabel}</p>
      <p className="line-clamp-1 sm:line-clamp-2">
        Βάθος: {spot.techniqueDepthRange.label} Βυθός: {spot.seabedLabel}, σκαλώματα {spot.snagRiskLabel}.
      </p>
      <DepthProfileGraphic spot={spot} compact />
    </div>
  );
}

function searchCacheKey(
  query: string,
  resultLimit: number,
  radiusKm: number,
  locationOnly: boolean,
  mode: SpotSearchMode,
  coordinates?: Coordinates,
  gpsAccuracyM?: number,
): string {
  return JSON.stringify({
    version: 7,
    mode,
    query: query.trim().toLowerCase().replace(/\s+/g, " "),
    resultLimit,
    radiusKm,
    locationOnly,
    coordinates: coordinates ? { lat: Number(coordinates.lat.toFixed(5)), lon: Number(coordinates.lon.toFixed(5)) } : undefined,
    gpsAccuracyM: typeof gpsAccuracyM === "number" ? Math.round(gpsAccuracyM) : undefined,
  });
}

function searchQueryFromState(technique: TechniqueId, location: string, targetFish = "", timeHint = ""): string {
  const label = TECHNIQUE_PROFILES[technique].label;
  return [label, targetFish.trim(), location.trim(), timeHint.trim()].filter(Boolean).join(" ");
}

function normalizeResultLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_RESULT_LIMIT;
  }

  return Math.min(48, Math.max(5, Math.round(value)));
}

function normalizeRadiusKm(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_RADIUS_KM;
  }

  return Math.min(60, Math.max(1, Math.round(value)));
}

function mapPointLocationLabel(coordinates: Coordinates): string {
  return `Σημείο χάρτη ${coordinates.lat.toFixed(5)}, ${coordinates.lon.toFixed(5)}`;
}

function unavailable(): string {
  return "Μη διαθέσιμο";
}

function formatMetric(value: number | undefined, unit: string, digits = 1): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : unavailable();
}

function formatCoordinates(point: Coordinates): string {
  return `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;
}

function formatBearing(value: number): string {
  const normalized = ((value % 360) + 360) % 360;
  return `${Math.round(normalized)}°`;
}

function formatWind(speed?: number, bearing?: number): string {
  const parts = [
    typeof speed === "number" && Number.isFinite(speed) ? `${speed.toFixed(1)}km/h` : undefined,
    typeof bearing === "number" && Number.isFinite(bearing) ? formatBearing(bearing) : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : unavailable();
}

function formatSeaState(height?: number, bearing?: number, period?: number): string {
  const parts = [
    typeof height === "number" && Number.isFinite(height) ? `${height.toFixed(1)}μ` : undefined,
    typeof bearing === "number" && Number.isFinite(bearing) ? formatBearing(bearing) : undefined,
    typeof period === "number" && Number.isFinite(period) ? `${period.toFixed(1)}s` : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : unavailable();
}

function formatPressure(value: number | undefined, trend: RankedSpot["weather"]["pressureTrend"]): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return unavailable();
  }
  const trends: Record<RankedSpot["weather"]["pressureTrend"], string> = {
    rising: "ανοδική",
    falling: "πτωτική",
    stable: "σταθερή",
    unknown: "άγνωστη τάση",
  };
  return `${value.toFixed(0)}hPa · ${trends[trend]}`;
}

function formatVisibility(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return unavailable();
  }
  return value >= 1000 ? `${(value / 1000).toFixed(1)}χλμ` : `${Math.round(value)}μ`;
}

function confidenceLabel(confidence: "high" | "medium" | "low" | "none"): string {
  const labels = { high: "Υψηλή", medium: "Μέτρια", low: "Χαμηλή", none: "Μη διαθέσιμη" } as const;
  return labels[confidence];
}

function normalizeFishCount(value: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 1;
  }

  return Math.max(1, Math.round(numeric));
}

function optionalPositiveNumber(value: string): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }

  return numeric;
}

function formatFishRecordSummary(record: TripFishRecord): string {
  return `${record.count}x ${record.species}`;
}

function fishRecordMetrics(record: TripFishRecord): string {
  const metrics = [
    typeof record.weightKg === "number" ? `${record.weightKg}kg` : undefined,
    typeof record.lengthCm === "number" ? `${record.lengthCm}cm` : undefined,
    record.bait ? `δόλωμα ${record.bait}` : undefined,
    record.released ? "released" : "κρατήθηκε",
  ].filter(Boolean);

  return metrics.join(" · ");
}

function fishCaughtToRecords(fishCaught: string[]): TripFishRecord[] {
  return fishCaught.map((fish, index) => ({
    id: `legacy-${index}-${fish}`,
    species: fish,
    count: 1,
    released: false,
    images: [],
  }));
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function formatTripDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("el-GR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function toDatetimeLocal(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function depthProfileText(spot: RankedSpot): string {
  const points = spot.depth.castingProfile
    .filter((point) => typeof point.depthM === "number")
    .map((point) => `${point.distanceM}μ: ${point.depthM?.toFixed(1)}μ`);

  return points.length ? points.join(" · ") : "Δεν υπάρχει προφίλ βολής";
}

function categoryLabel(category: RankedSpot["category"]): string {
  const labels: Record<RankedSpot["category"], string> = {
    beach: "Παραλία",
    harbour: "Λιμάνι",
    breakwater: "Κυματοθραύστης",
    pier: "Προβλήτα",
    rocky: "Βράχια",
    reef: "Ξέρα/ύφαλος",
    shoal: "Ρηχό",
    headland: "Κάβος",
    estuary: "Παράκτιο πέρασμα",
    marina: "Μαρίνα",
    bay: "Κόλπος",
    fallback: "Εκτίμηση",
  };

  return labels[category];
}

function accessLabel(rating: RankedSpot["access"]["rating"]): string {
  const labels: Record<RankedSpot["access"]["rating"], string> = {
    easy: "εύκολη",
    moderate: "μέτρια",
    hard: "δύσκολη",
    restricted: "περιορισμένη",
    unknown: "άγνωστη",
  };

  return labels[rating];
}

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, (error) => reject(new Error(geolocationErrorLabel(error))), {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 60_000,
    });
  });
}

function geolocationErrorLabel(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) {
    return "Δεν δόθηκε άδεια τοποθεσίας. Ενεργοποίησε location permission για τον browser και ξαναδοκίμασε.";
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return "Δεν είναι διαθέσιμη η τρέχουσα τοποθεσία GPS.";
  }
  if (error.code === error.TIMEOUT) {
    return "Το GPS άργησε να απαντήσει. Δοκίμασε ξανά ή γράψε την περιοχή χειροκίνητα.";
  }

  return "Δεν μπορέσαμε να πάρουμε την τρέχουσα τοποθεσία.";
}

function baseLayerLabel(layer: MapBaseLayer): string {
  const labels: Record<MapBaseLayer, string> = {
    terrain: "Terrain",
    satellite: "Satellite",
    street: "Street",
  };

  return labels[layer];
}
