import type { ApiUser, CreateTripInput, SavedFishingTrip, TripVisibility } from "@/lib/types";

interface ApiErrorPayload {
  error?: string;
}

export async function connectUsername(username: string): Promise<ApiUser> {
  const payload = await apiRequest<{ user: ApiUser }>("/api/session", {
    method: "POST",
    body: JSON.stringify({ username }),
  });
  return payload.user;
}

export async function fetchTrips(username?: string, scope: "visible" | "mine" | "public" = "visible"): Promise<SavedFishingTrip[]> {
  const payload = await apiRequest<{ trips: SavedFishingTrip[] }>(`/api/trips?scope=${scope}`, {}, username);
  return payload.trips;
}

export async function createTrip(username: string, input: CreateTripInput): Promise<SavedFishingTrip> {
  const payload = await apiRequest<{ trip: SavedFishingTrip }>("/api/trips", {
    method: "POST",
    body: JSON.stringify(input),
  }, username);
  return payload.trip;
}

export async function setTripVisibility(username: string, id: string, visibility: TripVisibility): Promise<SavedFishingTrip> {
  const payload = await apiRequest<{ trip: SavedFishingTrip }>(`/api/trips/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ visibility }),
  }, username);
  return payload.trip;
}

export async function deleteTrip(username: string, id: string): Promise<void> {
  await apiRequest<void>(`/api/trips/${encodeURIComponent(id)}`, { method: "DELETE" }, username);
}

export async function fetchUsers(): Promise<ApiUser[]> {
  const payload = await apiRequest<{ users: ApiUser[] }>("/api/users");
  return payload.users;
}

export async function createUser(username: string, displayName: string): Promise<ApiUser> {
  const payload = await apiRequest<{ user: ApiUser }>("/api/users", {
    method: "POST",
    body: JSON.stringify({ username, displayName }),
  });
  return payload.user;
}

export async function updateUser(id: string, input: { displayName?: string; active?: boolean }): Promise<ApiUser> {
  const payload = await apiRequest<{ user: ApiUser }>(`/api/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return payload.user;
}

export function userHeaders(username?: string): HeadersInit {
  return username ? { "X-Fishing-User": username } : {};
}

async function apiRequest<T>(url: string, init: RequestInit = {}, username?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (username) {
    headers.set("X-Fishing-User", username);
  }

  const response = await fetch(url, { ...init, headers });
  if (response.status === 204) {
    return undefined as T;
  }

  const payload = (await response.json()) as T | ApiErrorPayload;
  if (!response.ok) {
    throw new Error("error" in (payload as ApiErrorPayload) && (payload as ApiErrorPayload).error
      ? (payload as ApiErrorPayload).error
      : "Το API request απέτυχε.");
  }
  return payload as T;
}
