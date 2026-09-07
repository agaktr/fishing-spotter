import { FormEvent, useState } from "react";
import type { ApiUser } from "@/lib/types";
import { authenticate } from "@/lib/client/api";

export function AuthForm({ onConnected }: { onConnected: (user: ApiUser) => void }) {
  const [activation, setActivation] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [invitationToken, setInvitationToken] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    if (activation && password !== confirmation) { setError("Οι κωδικοί δεν ταιριάζουν."); return; }
    setLoading(true);
    try {
      const user = await authenticate({ username: username.trim(), password, ...(activation ? { invitationToken: invitationToken.trim() } : {}) }, remember);
      setPassword(""); setConfirmation(""); setInvitationToken("");
      onConnected(user);
    } catch (error) { setError(error instanceof Error ? error.message : "Η σύνδεση απέτυχε."); }
    finally { setLoading(false); }
  }

  return <form onSubmit={submit} className="mt-4 space-y-3">
    <div className="grid grid-cols-2 gap-2">
      <button type="button" disabled={loading} aria-pressed={!activation} className={!activation ? "ui-primary" : "ui-secondary"} onClick={() => { setActivation(false); setError(undefined); setInvitationToken(""); setPassword(""); setConfirmation(""); }}>Σύνδεση</button>
      <button type="button" disabled={loading} aria-pressed={activation} className={activation ? "ui-primary" : "ui-secondary"} onClick={() => { setActivation(true); setError(undefined); setPassword(""); setConfirmation(""); }}>Ενεργοποίηση λογαριασμού</button>
    </div>
    <p className="ui-help">{activation ? "Η πρόσκληση είναι ιδιωτικός κωδικός μίας χρήσης από τον διαχειριστή, όχι ο κωδικός σύνδεσής σου. Συμπλήρωσε το username που σου έδωσε, την πρόσκληση και έναν νέο προσωπικό κωδικό. Χρησιμοποιείται και για ανάκτηση πρόσβασης." : "Έχεις ήδη ορίσει προσωπικό κωδικό; Συνδέσου με το username και τον κωδικό σου. Αν δεν έχεις ενεργοποιήσει τον λογαριασμό σου ή ξέχασες τον κωδικό, ζήτησε ιδιωτικά πρόσκληση από τον διαχειριστή και επίλεξε «Ενεργοποίηση λογαριασμού»."}</p>
    {activation && <p className="ui-notice">Χρησιμοποίησε την πιο πρόσφατη πρόσκληση πριν από τη λήξη που σου έστειλε ο διαχειριστής. Αν έληξε, χρησιμοποιήθηκε ή δεν έγινε δεκτή, έλεγξε το username και ζήτησε νέα πρόσκληση. Μετά την ενεργοποίηση χρησιμοποιείς τη «Σύνδεση» με τον προσωπικό σου κωδικό.</p>}
    <label className="ui-label">Username<input className="ui-input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required disabled={loading} /></label>
    {activation && <label className="ui-label">Κωδικός πρόσκλησης<input className="ui-input" type="password" value={invitationToken} onChange={(e) => setInvitationToken(e.target.value)} autoComplete="off" required disabled={loading} /></label>}
    <label className="ui-label">{activation ? "Νέος κωδικός" : "Κωδικός"}<input className="ui-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={activation ? "new-password" : "current-password"} required disabled={loading} /></label>
    {activation && <label className="ui-label">Επιβεβαίωση κωδικού<input className="ui-input" type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="new-password" required disabled={loading} /></label>}
    <label className="ui-check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Να παραμείνω συνδεδεμένος σε αυτή την προσωπική συσκευή</label>
    <p className="ui-help">Χωρίς αυτή την επιλογή, η συνεδρία διατηρείται μόνο σε αυτή την καρτέλα. Μην την επιλέγεις σε κοινόχρηστη συσκευή.</p>
    {error && <div role="alert" className="ui-error"><p>{error}</p><p className="mt-2">{activation ? "Έλεγξε το username και την πιο πρόσφατη πρόσκληση. Αν το πρόβλημα συνεχίζεται, ζήτησε νέα πρόσκληση από τον διαχειριστή." : "Έλεγξε username και κωδικό. Αν δεν έχεις ορίσει κωδικό ή χρειάζεσαι ανάκτηση, ζήτησε πρόσκληση και επίλεξε «Ενεργοποίηση λογαριασμού»."}</p></div>}
    <button className="ui-primary w-full" disabled={loading} type="submit">{loading ? "Επαλήθευση..." : activation ? "Ενεργοποίηση και σύνδεση" : "Σύνδεση"}</button>
  </form>;
}

export function UserConnectPanel({ activeUser, onConnected, onDisconnect, onClose }: {
  activeUser?: ApiUser; onConnected: (user: ApiUser) => void; onDisconnect: () => void; onClose: () => void;
}) {
  return <section className="workflow-panel auth-panel" aria-label="Λογαριασμός">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><p className="ui-eyebrow">Λογαριασμός</p><h2 className="mt-1 break-words text-xl font-black">{activeUser ? `@${activeUser.username}` : "Ασφαλής σύνδεση"}</h2></div>
      <button type="button" aria-label="Κλείσιμο λογαριασμού" onClick={onClose} className="ui-close">x</button>
    </div>
    {activeUser ? <div className="mt-4 space-y-3">
      <p className="ui-notice">{activeUser.displayName}</p>
      <button type="button" onClick={() => { if (window.confirm("Αποσύνδεση; Οι μη αποθηκευμένες αλλαγές θα αφαιρεθούν από τη συσκευή.")) onDisconnect(); }} className="ui-secondary w-full">Αποσύνδεση</button>
      {activeUser.role === "admin" && <a href="/admin" className="block text-center text-sm font-bold text-lagoon underline">Διαχείριση χρηστών</a>}
    </div> : <AuthForm onConnected={onConnected} />}
  </section>;
}
