import type { ApiUser, CreateTripInput, PersonalInsights, SavedFishingTrip, SavedPlace, SavedScan, ScanSummary, SpotsApiRequest, SpotsApiResponse, UpdateTripInput } from "@/lib/types";

export const TOKEN_KEY = "fishing-session-token";
export const ACCOUNT_KEY = "fishing-session-account";
export const SESSION_ENDED_EVENT = "fishing-session-ended";
export const DRAFT_PREFIX = "fishing-draft:";
export const CONTINUATION_PREFIX = "fishing-continuation:";
export type SessionEndReason = "expired" | "logout" | "account-switch";
export interface SessionEndDetail { reason: SessionEndReason }
let memoryToken: string | undefined;
let verifiedIdentity: { id: string; token: string } | undefined;

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export function sessionToken(): string | undefined {
  try { return sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY) ?? memoryToken; }
  catch { return memoryToken; }
}

export function verifiedUserId(): string | undefined {
  return verifiedIdentity?.token === sessionToken() ? verifiedIdentity?.id : undefined;
}

function clearCredentials(token = sessionToken(), replaceAll = false) {
  memoryToken = undefined;
  for (const storage of [() => sessionStorage, () => localStorage]) {
    try { const area = storage(); if (replaceAll || area.getItem(TOKEN_KEY) === token) area.removeItem(TOKEN_KEY); } catch { /* Attempt both stores independently. */ }
  }
}

function clearAccountData(userId?: string) {
  for (const storage of [() => sessionStorage, () => localStorage]) {
    try {
      const area = storage();
      for (const key of Object.keys(area)) {
        if (key.startsWith(userId ? `${DRAFT_PREFIX}${userId}:` : DRAFT_PREFIX) || key === `${CONTINUATION_PREFIX}${userId}` || (!userId && key.startsWith(CONTINUATION_PREFIX))) area.removeItem(key);
      }
    } catch { /* Storage may be unavailable. */ }
  }
}

export function clearSession(reason: SessionEndReason = "logout") {
  let account = verifiedIdentity?.id;
  try { account ??= localStorage.getItem(ACCOUNT_KEY) ?? undefined; } catch { /* Use the verified in-memory identity. */ }
  // Let the mounted browser preserve its continuation before credentials become unavailable.
  window.dispatchEvent(new CustomEvent<SessionEndDetail>(SESSION_ENDED_EVENT, { detail: { reason } }));
  clearCredentials(reason === "account-switch" ? verifiedIdentity?.token ?? sessionToken() : sessionToken(), reason === "logout");
  verifiedIdentity = undefined;
  if (reason === "expired") return;
  clearAccountData(account);
  try {
    if (localStorage.getItem(ACCOUNT_KEY) === account) localStorage.removeItem(ACCOUNT_KEY);
    localStorage.removeItem("fishing-spotter-username");
    localStorage.removeItem("fishing-spotter-trips");
  } catch { /* Storage may be unavailable. */ }
}

function acceptVerifiedUser(user: ApiUser) {
  let previous = verifiedIdentity?.id;
  try { previous ??= localStorage.getItem(ACCOUNT_KEY) ?? undefined; } catch { /* No persisted account hint. */ }
  if (previous && previous !== user.id) {
    if (verifiedIdentity) window.dispatchEvent(new CustomEvent<SessionEndDetail>(SESSION_ENDED_EVENT, { detail: { reason: "account-switch" } }));
    clearAccountData(previous);
  }
  for (const storage of [() => sessionStorage, () => localStorage]) {
    try {
      const area = storage();
      for (const key of Object.keys(area)) {
        if ((key.startsWith(DRAFT_PREFIX) && !key.startsWith(`${DRAFT_PREFIX}${user.id}:`)) || (key.startsWith(CONTINUATION_PREFIX) && key !== `${CONTINUATION_PREFIX}${user.id}`)) area.removeItem(key);
      }
    } catch { /* Do not unlock data belonging to a different account. */ }
  }
  // Only a successful bearer verification unlocks drafts. The stored account ID is not authentication.
  verifiedIdentity = { id: user.id, token: sessionToken()! };
  try { localStorage.setItem(ACCOUNT_KEY, user.id); } catch { /* In-memory access remains scoped. */ }
}

export function syncStoredSession() {
  let account: string | null = null;
  try { account = localStorage.getItem(ACCOUNT_KEY); } catch { /* Restore will verify any available credential. */ }
  if (verifiedIdentity && account !== verifiedIdentity.id) clearSession("account-switch");
  else if (verifiedIdentity?.token !== sessionToken()) {
    window.dispatchEvent(new CustomEvent<SessionEndDetail>(SESSION_ENDED_EVENT, { detail: { reason: "expired" } }));
    verifiedIdentity = undefined;
  }
}

interface SessionPayload { user: ApiUser; token: string; expiresAt: string }
export interface Invitation { invitationToken: string; expiresAt: string }

export async function authenticate(input: { username: string; password: string; invitationToken?: string }, remember: boolean): Promise<ApiUser> {
  const payload = await apiRequest<SessionPayload>(input.invitationToken ? "/api/activate" : "/api/session", {
    method: "POST", body: JSON.stringify(input),
  }, false);
  if (!payload.user?.id || !payload.user.active || !["admin", "user"].includes(payload.user.role) || typeof payload.token !== "string" || !payload.token || !(Date.parse(payload.expiresAt) > Date.now())) {
    throw new Error("Το API δεν επέστρεψε έγκυρη ασφαλή συνεδρία. Δεν έγινε σύνδεση μόνο με username.");
  }
  clearCredentials(sessionToken(), true);
  try { (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, payload.token); } catch { memoryToken = payload.token; }
  acceptVerifiedUser(payload.user);
  return payload.user;
}

export async function restoreSession(): Promise<ApiUser | undefined> {
  try { localStorage.removeItem("fishing-spotter-username"); localStorage.removeItem("fishing-spotter-trips"); } catch { /* Legacy identity is never used for authentication. */ }
  if (!sessionToken()) return undefined;
  const { user } = await apiRequest<{ user: ApiUser }>("/api/session");
  if (!user?.id || !user.active || !["admin", "user"].includes(user.role)) { clearSession("expired"); throw new Error("Η ταυτότητα της συνεδρίας δεν επιβεβαιώθηκε."); }
  acceptVerifiedUser(user);
  return user;
}

export async function revokeSession(): Promise<void> {
  const token = sessionToken();
  const identity = verifiedIdentity;
  try { await apiRequest<void>("/api/session", { method: "DELETE" }); }
  finally { if (token === sessionToken() || (!sessionToken() && (!verifiedIdentity || verifiedIdentity === identity))) clearSession(); }
}

export async function fetchTrips(scope: "visible" | "mine" | "public" = "visible"): Promise<SavedFishingTrip[]> {
  return (await apiRequest<{ trips: SavedFishingTrip[] }>(`/api/trips?scope=${scope}`, {}, scope !== "public" || Boolean(verifiedUserId()))).trips;
}
export async function createTrip(input: CreateTripInput): Promise<SavedFishingTrip> {
  return (await apiRequest<{ trip: SavedFishingTrip }>("/api/trips", { method: "POST", body: JSON.stringify(input) })).trip;
}
export async function fetchActiveTrip(): Promise<SavedFishingTrip | null> {
  return (await apiRequest<{ trip: SavedFishingTrip | null }>("/api/trips/active")).trip;
}
export async function fetchTrip(id: string): Promise<SavedFishingTrip> {
  return (await apiRequest<{ trip: SavedFishingTrip }>(`/api/trips/${encodeURIComponent(id)}`)).trip;
}
export async function updateTrip(id: string, input: UpdateTripInput): Promise<SavedFishingTrip> {
  return (await apiRequest<{ trip: SavedFishingTrip }>(`/api/trips/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) })).trip;
}
export async function uploadTripImage(id: string, image: File, fishRecordId?: string): Promise<SavedFishingTrip> {
  const body = new FormData();
  body.append("image", image);
  if (fishRecordId) body.append("fishRecordId", fishRecordId);
  return (await apiRequest<{ trip: SavedFishingTrip }>(`/api/trips/${encodeURIComponent(id)}/media`, { method: "POST", body })).trip;
}
export async function deleteTripImage(tripId: string, mediaId: string): Promise<SavedFishingTrip> {
  return (await apiRequest<{ trip: SavedFishingTrip }>(`/api/trips/${encodeURIComponent(tripId)}/media/${encodeURIComponent(mediaId)}`, { method: "DELETE" })).trip;
}
export async function fetchTripImage(url: string): Promise<Blob> {
  const target = new URL(url, window.location.origin);
  if (target.origin !== window.location.origin) throw new Error("Μη έγκυρη διεύθυνση εικόνας.");
  const token = sessionToken();
  const response = await fetch(target, { headers: userHeaders(), cache: "no-store", redirect: "error" });
  if (token !== sessionToken()) throw new Error("Η συνεδρία άλλαξε.");
  if (response.status === 401 && token) clearSession("expired");
  if (!response.ok) throw new Error("Η εικόνα δεν είναι διαθέσιμη.");
  return response.blob();
}
export async function deleteTrip(id: string): Promise<void> {
  await apiRequest<void>(`/api/trips/${encodeURIComponent(id)}`, { method: "DELETE" });
}
export async function fetchUsers(): Promise<ApiUser[]> {
  return (await apiRequest<{ users: ApiUser[] }>("/api/users")).users;
}
export function createUser(username: string, displayName: string): Promise<Invitation & { user: ApiUser }> {
  return apiRequest("/api/users", { method: "POST", body: JSON.stringify({ username, displayName }) });
}
export function issueInvitation(id: string): Promise<Invitation> {
  return apiRequest(`/api/users/${encodeURIComponent(id)}/invitation`, { method: "POST" });
}
export async function updateUser(id: string, input: { displayName?: string; active?: boolean; role?: ApiUser["role"] }): Promise<ApiUser> {
  return (await apiRequest<{ user: ApiUser }>(`/api/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) })).user;
}
export function searchSpots(input: SpotsApiRequest): Promise<SpotsApiResponse> {
  return apiRequest("/api/spots", { method: "POST", body: JSON.stringify(input) });
}
export async function fetchSavedPlaces(): Promise<SavedPlace[]> {
  return (await apiRequest<{ places: SavedPlace[] }>("/api/saved-places")).places;
}
export async function savePlace(input: Pick<SavedPlace, "name" | "lat" | "lon" | "technique" | "notes">): Promise<SavedPlace> {
  return (await apiRequest<{ place: SavedPlace }>("/api/saved-places", { method: "POST", body: JSON.stringify(input) })).place;
}
export async function deletePlace(id: string): Promise<void> {
  await apiRequest(`/api/saved-places/${encodeURIComponent(id)}`, { method: "DELETE" });
}
export async function fetchScans(): Promise<ScanSummary[]> {
  return (await apiRequest<{ scans: ScanSummary[] }>("/api/scans")).scans;
}
export async function fetchScan(id: string): Promise<SavedScan> {
  return (await apiRequest<{ scan: SavedScan }>(`/api/scans/${encodeURIComponent(id)}`)).scan;
}
export async function deleteScans(id?: string): Promise<void> {
  await apiRequest(`/api/scans${id ? `/${encodeURIComponent(id)}` : ""}`, { method: "DELETE" });
}
export function fetchInsights(): Promise<PersonalInsights> { return apiRequest("/api/insights"); }

export function userHeaders(): HeadersInit {
  const token = sessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiRequest<T>(url: string, init: RequestInit = {}, authenticated = true): Promise<T> {
  const token = authenticated ? sessionToken() : undefined;
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers, cache: "no-store", redirect: "error" });
  if (authenticated && token !== sessionToken()) throw new Error("Η συνεδρία άλλαξε. Δοκίμασε ξανά.");
  if (response.status === 401 && token) {
    clearSession("expired");
    throw new ApiError("Η συνεδρία έληξε. Τα πρόχειρα διατηρήθηκαν. Συνδέσου ξανά στον ίδιο λογαριασμό για συνέχεια.", 401);
  }
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => {
    if (response.ok) throw new Error("Ο server δεν επέστρεψε έγκυρη απόκριση JSON.");
    return {};
  });
  if (authenticated && token !== sessionToken()) throw new Error("Η συνεδρία άλλαξε. Δοκίμασε ξανά.");
  if (!response.ok) throw new ApiError(typeof payload.error === "string" ? payload.error : "Το αίτημα απέτυχε. Δοκίμασε ξανά.", response.status);
  return payload as T;
}
