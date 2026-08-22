"use client";

import { FormEvent, useEffect, useState } from "react";
import type { ApiUser } from "@/lib/types";
import { createUser, fetchUsers, updateUser } from "@/lib/client/api";

export function AdminUsers() {
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadUsers();
  }, []);

  async function loadUsers() {
    setLoading(true);
    try {
      setUsers(await fetchUsers());
      setError(undefined);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Δεν φορτώθηκαν οι χρήστες.");
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const user = await createUser(username, displayName);
      setUsers((current) => [...current, user].sort((a, b) => a.username.localeCompare(b.username)));
      setUsername("");
      setDisplayName("");
      setError(undefined);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Ο χρήστης δεν δημιουργήθηκε.");
    }
  }

  async function toggle(user: ApiUser) {
    try {
      const updated = await updateUser(user.id, { active: !user.active });
      setUsers((current) => current.map((item) => item.id === updated.id ? updated : item));
      setError(undefined);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Η αλλαγή απέτυχε.");
    }
  }

  return (
    <main className="min-h-screen bg-[#eef8f8] px-4 py-8 text-ink sm:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.25em] text-lagoon">Fishing Spotter</p>
            <h1 className="mt-2 text-3xl font-black">Admin χρηστών</h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold text-slate-600">Προσωρινή διαχείριση χωρίς password. Οι χρήστες συνδέονται στην εφαρμογή μόνο με το username.</p>
          </div>
          <a href="/" className="rounded-2xl bg-ink px-5 py-3 text-sm font-black text-white">Πίσω στον χάρτη</a>
        </div>

        <section className="mt-8 grid gap-6 lg:grid-cols-[22rem_1fr]">
          <form onSubmit={submit} className="h-fit rounded-[1.75rem] border border-white bg-white p-5 shadow-glow">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-kelp">Νέος χρήστης</p>
            <label className="mt-4 block">
              <span className="mb-1 block text-xs font-black uppercase tracking-[0.15em] text-slate-500">Username</span>
              <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="username" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-bold outline-none focus:border-tide" />
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-black uppercase tracking-[0.15em] text-slate-500">Όνομα εμφάνισης</span>
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Display name" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-bold outline-none focus:border-tide" />
            </label>
            <button type="submit" disabled={!username.trim()} className="mt-4 w-full rounded-2xl bg-kelp px-4 py-3 text-sm font-black text-white disabled:opacity-50">Προσθήκη χρήστη</button>
            {error && <p className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}
          </form>

          <div className="rounded-[1.75rem] border border-white bg-white p-5 shadow-glow">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-black">Χρήστες</h2>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500">{users.length}</span>
            </div>
            {loading ? <p className="mt-4 text-sm font-semibold text-slate-500">Φόρτωση...</p> : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {users.map((user) => (
                  <article key={user.id} className={`rounded-2xl border p-4 ${user.active ? "border-kelp/20 bg-kelp/5" : "border-slate-200 bg-slate-50 opacity-70"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black">@{user.username}</p>
                        <p className="mt-1 truncate text-xs font-semibold text-slate-500">{user.displayName}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${user.active ? "bg-kelp text-white" : "bg-slate-200 text-slate-600"}`}>{user.active ? "active" : "inactive"}</span>
                    </div>
                    <button type="button" onClick={() => void toggle(user)} className="mt-4 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700">{user.active ? "Απενεργοποίηση" : "Ενεργοποίηση"}</button>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
