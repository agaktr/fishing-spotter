import { FormEvent, useEffect, useState } from "react";
import type { ApiUser } from "@/lib/types";
import { clearSession, createUser, fetchUsers, issueInvitation, SESSION_ENDED_EVENT, updateUser, verifiedUserId } from "@/lib/client/api";
import { useSession } from "@/lib/client/useSession";
import { AuthForm } from "./UserConnectPanel";

export function AdminUsers() {
  const session = useSession();
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [invitation, setInvitation] = useState<{ username: string; invitationToken: string; expiresAt: string }>();
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const ended = () => { setUsers([]); setInvitation(undefined); setUsername(""); setDisplayName(""); };
    window.addEventListener(SESSION_ENDED_EVENT, ended);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, ended);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setUsers([]); setInvitation(undefined);
    if (session.user?.role !== "admin") return;
    setLoading(true);
    void fetchUsers().then((items) => { if (!cancelled && verifiedUserId() === session.user?.id) { setUsers(items); setError(undefined); } })
      .catch((error) => { if (!cancelled) setError(error.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [session.user?.id, session.user?.role, revision]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setInvitation(undefined);
    try {
      const result = await createUser(username.trim(), displayName.trim());
      if (verifiedUserId() !== session.user?.id) return;
      setUsers((items) => [...items, result.user].sort((a, b) => a.username.localeCompare(b.username)));
      setInvitation({ ...result, username: result.user.username });
      setUsername(""); setDisplayName(""); setError(undefined);
    } catch (error) { setError(error instanceof Error ? error.message : "Η δημιουργία απέτυχε."); }
    finally { setBusy(false); }
  }

  async function change(user: ApiUser, input: Parameters<typeof updateUser>[1]) {
    setBusy(true);
    try {
      const updated = await updateUser(user.id, input);
      if (verifiedUserId() !== session.user?.id) return;
      setUsers((items) => items.map((item) => item.id === updated.id ? updated : item));
      if (updated.id === session.user?.id) { if (updated.active) session.connect(updated); else clearSession(); }
      setError(undefined);
    } catch (error) { setError(error instanceof Error ? error.message : "Η αλλαγή απέτυχε."); }
    finally { setBusy(false); }
  }

  async function recover(user: ApiUser) {
    if (!window.confirm(`Νέα πρόσκληση ανάκτησης για @${user.username}; Μοιράσου την μόνο ιδιωτικά με τον κάτοχο.`)) return;
    setBusy(true); setInvitation(undefined);
    try { const issued = await issueInvitation(user.id); if (verifiedUserId() !== session.user?.id) return; setInvitation({ ...issued, username: user.username }); setError(undefined); }
    catch (error) { setError(error instanceof Error ? error.message : "Η πρόσκληση δεν εκδόθηκε."); }
    finally { setBusy(false); }
  }

  return <main className="min-h-screen bg-[#eef8f8] px-4 py-8 text-ink sm:px-8"><div className="mx-auto max-w-5xl">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="ui-eyebrow">Fishing Spotter</p><h1 className="mt-2 text-3xl font-black">Διαχείριση χρηστών</h1><p className="mt-2 text-sm font-semibold text-slate-600">Πρόσβαση μόνο σε επαληθευμένους διαχειριστές.</p></div>
      <a href="/" className="ui-primary">Πίσω στον χάρτη</a>
    </header>
    {(error || session.sessionError) && <p role="alert" className="ui-error mt-4">{error || session.sessionError}</p>}
    {session.restoring ? <p className="ui-notice mt-6">Επαλήθευση συνεδρίας...</p> : !session.user ? <section className="mx-auto mt-8 max-w-md rounded-3xl bg-white p-5 shadow-glow"><h2 className="text-xl font-black">Σύνδεση διαχειριστή</h2><AuthForm onConnected={session.connect} /></section> : <>
      <div className="mt-6 flex flex-wrap items-center gap-3"><p className="break-all text-sm font-bold">@{session.user.username}</p><button className="ui-secondary" onClick={() => void session.disconnect()}>Αποσύνδεση</button></div>
      {session.user.role !== "admin" ? <p className="ui-notice mt-4">Ο λογαριασμός σου δεν έχει δικαίωμα διαχείρισης. Δεν εμφανίζονται στοιχεία άλλων χρηστών.</p> : <>
        {invitation && <section className="ui-warning mt-6" aria-label="Νέα ιδιωτική πρόσκληση"><h2 className="font-black">Νέα πρόσκληση για @{invitation.username}</h2><p className="mt-2">Εμφανίζεται μόνο τώρα. Κοινοποίησέ την ιδιωτικά, όχι σε δημόσια σημείωση, σύνδεσμο ή screenshot.</p><code className="mt-3 block select-all break-all rounded-xl bg-white p-3">{invitation.invitationToken}</code><p className="mt-2">Λήξη: {new Date(invitation.expiresAt).toLocaleString("el-GR")}</p><button className="ui-secondary mt-3" onClick={() => setInvitation(undefined)}>Απόκρυψη πρόσκλησης</button></section>}
        <section className="mt-6 grid items-start gap-6 lg:grid-cols-[20rem_1fr]">
          <form onSubmit={submit} className="space-y-3 rounded-3xl bg-white p-5 shadow-glow"><h2 className="text-xl font-black">Νέος χρήστης</h2><label className="ui-label">Username<input className="ui-input" value={username} onChange={(e) => setUsername(e.target.value)} required /></label><label className="ui-label">Όνομα εμφάνισης<input className="ui-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required /></label><button className="ui-primary w-full" disabled={busy || loading}>Δημιουργία και πρόσκληση</button></form>
          <div className="min-w-0 rounded-3xl bg-white p-5 shadow-glow"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-black">Χρήστες ({users.length})</h2><button className="ui-secondary" disabled={loading || busy} onClick={() => setRevision((n) => n + 1)}>Ανανέωση</button></div>
            {loading ? <p className="ui-help mt-4">Φόρτωση...</p> : <div className="mt-4 space-y-3">{users.map((user) => <article key={`${user.id}:${user.updatedAt}`} className="space-y-3 rounded-2xl border border-slate-200 p-3"><p className="break-all font-black">@{user.username} <span className="text-xs text-slate-500">{user.active ? "Ενεργός" : "Ανενεργός"}</span></p>
              <form onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); void change(user, { displayName: String(values.get("displayName")), role: values.get("role") as ApiUser["role"] }); }} className="space-y-2">
                <label className="ui-label">Όνομα εμφάνισης<input name="displayName" defaultValue={user.displayName} className="ui-input" required /></label><label className="ui-label">Ρόλος<select name="role" defaultValue={user.role} className="ui-input"><option value="user">Χρήστης</option><option value="admin">Διαχειριστής</option></select></label><button className="ui-secondary w-full" disabled={busy}>Αποθήκευση στοιχείων</button>
              </form>
              <div className="flex flex-wrap gap-2"><button className="ui-secondary" disabled={busy} onClick={() => { if (window.confirm(`${user.active ? "Απενεργοποίηση" : "Ενεργοποίηση"} @${user.username};`)) void change(user, { active: !user.active }); }}>{user.active ? "Απενεργοποίηση" : "Ενεργοποίηση"}</button><button className="ui-secondary" disabled={busy} onClick={() => void recover(user)}>Πρόσκληση / ανάκτηση</button></div>
            </article>)}</div>}
          </div>
        </section>
      </>}
    </>}
  </div></main>;
}
