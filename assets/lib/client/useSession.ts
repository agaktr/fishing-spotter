import { useEffect, useState } from "react";
import type { ApiUser } from "@/lib/types";
import { ACCOUNT_KEY, restoreSession, revokeSession, SESSION_ENDED_EVENT, syncStoredSession, TOKEN_KEY, type SessionEndDetail } from "./api";

export function useSession() {
  const [user, setUser] = useState<ApiUser>();
  const [restoring, setRestoring] = useState(true);
  const [sessionError, setSessionError] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    let revision = 0;
    const ended = (event: Event) => {
      revision += 1; setUser(undefined); setRestoring(false);
      if ((event as CustomEvent<SessionEndDetail>).detail?.reason === "expired") setSessionError("Η συνεδρία έληξε. Συνδέσου στον ίδιο λογαριασμό για τα διατηρημένα πρόχειρα και τη συνέχεια.");
    };
    window.addEventListener(SESSION_ENDED_EVENT, ended);
    const restore = () => {
      const current = ++revision;
      void restoreSession().then((next) => { if (!cancelled && current === revision) { setUser(next); setSessionError(undefined); } })
        .catch((error) => { if (!cancelled && current === revision) setSessionError(error instanceof Error ? error.message : "Η συνεδρία δεν επαληθεύτηκε."); })
        .finally(() => { if (!cancelled && current === revision) setRestoring(false); });
    };
    const storage = (event: StorageEvent) => {
      if (event.key !== TOKEN_KEY && event.key !== ACCOUNT_KEY && event.key !== null) return;
      try {
        if (event.storageArea !== localStorage || (event.key === TOKEN_KEY && sessionStorage.getItem(TOKEN_KEY))) return;
      } catch { return; }
      syncStoredSession(); setRestoring(true); restore();
    };
    window.addEventListener("storage", storage); restore();
    return () => { cancelled = true; window.removeEventListener(SESSION_ENDED_EVENT, ended); window.removeEventListener("storage", storage); };
  }, []);
  async function disconnect() {
    try { await revokeSession(); setSessionError(undefined); }
    catch { setSessionError("Έγινε τοπική αποσύνδεση. Η ανάκληση στον server δεν επιβεβαιώθηκε."); }
  }
  return { user, restoring, sessionError, dismissError: () => setSessionError(undefined), connect: (next: ApiUser) => { setUser(next); setSessionError(undefined); }, disconnect };
}
