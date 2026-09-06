import { useEffect, useRef, useState } from "react";
import type { Coordinates, TechniqueId, TripDestination } from "@/lib/types";
import { CONTINUATION_PREFIX, DRAFT_PREFIX, verifiedUserId } from "./api";

export const DRAFTS_CHANGED_EVENT = "fishing-drafts-changed";

export interface BrowserContinuation {
  panel: "search" | "trips" | "library";
  panelOpen: boolean;
  destination?: TripDestination;
  libraryDestination?: TripDestination;
  selectedTripId?: string;
  pickedPoint?: Coordinates;
  gpsAccuracyM?: number;
  technique: TechniqueId;
  location: string;
  targetSpecies: string;
  fishingAt: string;
  radiusKm: number;
  resultLimit: number;
}

export function draftKey(userId: string, subject: string) {
  return `${DRAFT_PREFIX}${userId}:${subject}`;
}

export function removeDraft(userId: string, subject: string) {
  if (verifiedUserId() !== userId) return;
  for (const storage of [() => localStorage, () => sessionStorage]) {
    try { storage().removeItem(draftKey(userId, subject)); } catch { /* Attempt both stores independently. */ }
  }
  window.dispatchEvent(new Event(DRAFTS_CHANGED_EVENT));
}

export function readDraft<T>(userId: string, subject: string): T | undefined {
  if (verifiedUserId() !== userId) return undefined;
  const key = draftKey(userId, subject);
  try {
    let stored = localStorage.getItem(key);
    // Preserve drafts already made by the tab-only version during this upgrade.
    if (!stored) {
      stored = sessionStorage.getItem(key);
      if (stored) { localStorage.setItem(key, stored); sessionStorage.removeItem(key); }
    }
    return stored ? JSON.parse(stored) as T : undefined;
  } catch { return undefined; }
}

export function writeDraft<T extends object>(userId: string, subject: string, value: T): boolean {
  if (verifiedUserId() !== userId) return false;
  try { localStorage.setItem(draftKey(userId, subject), JSON.stringify(value)); window.dispatchEvent(new Event(DRAFTS_CHANGED_EVENT)); return true; }
  catch { return false; }
}

export function listDrafts<T>(userId: string): Array<{ subject: string; value: T }> {
  if (verifiedUserId() !== userId) return [];
  const prefix = `${DRAFT_PREFIX}${userId}:`;
  const subjects = new Set<string>();
  for (const storage of [() => localStorage, () => sessionStorage]) {
    try { for (const key of Object.keys(storage())) if (key.startsWith(prefix)) subjects.add(key.slice(prefix.length)); } catch { /* Read whichever store is available. */ }
  }
  return [...subjects].flatMap((subject) => {
    const value = readDraft<T>(userId, subject);
    return value && typeof value === "object" ? [{ subject, value }] : [];
  });
}

export function writeContinuation(userId: string, value: BrowserContinuation): boolean {
  if (verifiedUserId() !== userId) return false;
  try { localStorage.setItem(`${CONTINUATION_PREFIX}${userId}`, JSON.stringify(value)); return true; } catch { return false; }
}

export function readContinuation(userId: string, hasGuestIntent = false): BrowserContinuation | undefined {
  if (hasGuestIntent || verifiedUserId() !== userId) return undefined;
  try { return JSON.parse(localStorage.getItem(`${CONTINUATION_PREFIX}${userId}`) ?? "null") ?? undefined; } catch { return undefined; }
}

// Callers key the editor by user and subject. Server mutations never reinitialize a draft.
export function usePersistentDraft<T extends object>(userId: string, subject: string, initial: () => T) {
  const [value, setValue] = useState<T>(() => {
    const defaults = initial();
    const stored = readDraft<T>(userId, subject);
    return stored && typeof stored === "object" && !Array.isArray(stored) ? { ...defaults, ...stored } : defaults;
  });
  const current = useRef(value);
  const [storageError, setStorageError] = useState(false);
  function change(next: T | ((previous: T) => T)) {
    const updated = typeof next === "function" ? next(current.current) : next;
    current.current = updated;
    setValue(updated);
    setStorageError(!writeDraft(userId, subject, updated));
  }
  function reset(next: T) {
    current.current = next;
    setValue(next);
    removeDraft(userId, subject);
  }
  useEffect(() => {
    // Fields are persisted synchronously on edit; also retain a destination-only new draft.
    if (subject.startsWith("new:")) setStorageError(!writeDraft(userId, subject, current.current));
  }, [userId, subject]);
  return { value, change, reset, storageError };
}

export function localDateTime(value: string, seconds = false): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, seconds ? 19 : 16);
}

export function displayDate(value?: string | null): string {
  if (!value) return "Μη καταγεγραμμένο";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Μη διαθέσιμο" : date.toLocaleString("el-GR", { dateStyle: "short", timeStyle: "short" });
}
