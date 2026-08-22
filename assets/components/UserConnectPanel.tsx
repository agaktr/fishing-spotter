"use client";

import { FormEvent, useState } from "react";
import type { ApiUser } from "@/lib/types";
import { connectUsername } from "@/lib/client/api";

export function UserConnectPanel({
  activeUser,
  onConnected,
  onDisconnect,
  onClose,
}: {
  activeUser?: ApiUser;
  onConnected: (user: ApiUser) => void;
  onDisconnect: () => void;
  onClose: () => void;
}) {
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(undefined);
    try {
      onConnected(await connectUsername(username));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Η σύνδεση απέτυχε.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="absolute left-3 right-3 top-[4.6rem] z-40 rounded-[1.5rem] border border-white/80 bg-white/95 p-4 shadow-glow backdrop-blur sm:left-auto sm:right-4 sm:w-[24rem]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-kelp">User profile</p>
          <h2 className="mt-1 text-xl font-black text-ink">{activeUser ? `@${activeUser.username}` : "Σύνδεση με username"}</h2>
        </div>
        <button type="button" onClick={onClose} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600">x</button>
      </div>

      {activeUser ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl border border-kelp/20 bg-kelp/10 p-3">
            <p className="text-sm font-black text-ink">{activeUser.displayName}</p>
            <p className="mt-1 text-xs font-semibold text-kelp">Οι ιδιωτικές εξορμήσεις είναι ορατές μόνο σε αυτό το username.</p>
          </div>
          <button type="button" onClick={onDisconnect} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700">Αποσύνδεση</button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-black uppercase tracking-[0.16em] text-slate-500">Username</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="π.χ. admin" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-tide focus:bg-white focus:ring-4 focus:ring-tide/15" />
          </label>
          <button type="submit" disabled={loading || !username.trim()} className="w-full rounded-2xl bg-kelp px-4 py-3 text-sm font-black text-white disabled:opacity-50">{loading ? "Σύνδεση..." : "Σύνδεση"}</button>
          {error && <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}
        </form>
      )}

      <a href="/admin" className="mt-4 block border-t border-slate-200 pt-3 text-center text-xs font-black text-lagoon underline">Admin χρηστών</a>
    </section>
  );
}
