import { useEffect, useRef, useState } from "react";
import { fetchTripImage, SESSION_ENDED_EVENT } from "@/lib/client/api";
import type { TripMedia } from "@/lib/types";

export function TripMediaGallery({ images, onRemove, busy = false }: { images: TripMedia[]; onRemove?: (id: string) => void; busy?: boolean }) {
  return images.length ? <div className="mt-2 grid grid-cols-3 gap-2">
    {images.map((image) => <div key={image.id} className="relative min-w-0">
      <PrivateImage image={image} />
      {onRemove && <button type="button" aria-label={`Διαγραφή ${image.originalName}`} className="absolute right-1 top-1 rounded-full bg-ink px-2 py-1 text-xs font-black text-white" disabled={busy} onClick={() => { if (window.confirm("Οριστική διαγραφή εικόνας;")) onRemove(image.id); }}>x</button>}
    </div>)}
  </div> : null;
}

function PrivateImage({ image }: { image: TripMedia }) {
  const [source, setSource] = useState<string>();
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const dialog = dialogRef.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => { dialog?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [expanded]);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    setSource(undefined); setError(false);
    const clear = () => { cancelled = true; setSource(undefined); setExpanded(false); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    window.addEventListener(SESSION_ENDED_EVENT, clear);
    void fetchTripImage(expanded ? image.url : image.thumbnailUrl).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob); setSource(objectUrl);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; window.removeEventListener(SESSION_ENDED_EVENT, clear); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [image.url, image.thumbnailUrl, expanded]);
  return <><button type="button" aria-label={`Προβολή ${image.originalName}`} onClick={() => setExpanded(true)} className="block aspect-square w-full overflow-hidden rounded-xl bg-slate-100">
    {source ? <img src={source} alt={image.originalName} className="h-full w-full object-cover" /> : <span className="ui-help p-2">{error ? "Η εικόνα δεν είναι διαθέσιμη" : "Φόρτωση εικόνας..."}</span>}
  </button>{expanded && <dialog ref={dialogRef} aria-label={`Εικόνα: ${image.originalName}`} className="media-dialog" onCancel={() => setExpanded(false)} onClick={(event) => { if (event.target === event.currentTarget) setExpanded(false); }}>
    <div className="space-y-3 rounded-2xl bg-white p-3"><div className="flex items-start justify-between gap-3"><p className="break-all text-xs font-bold">{image.originalName}</p><button type="button" className="ui-close" autoFocus aria-label="Κλείσιμο εικόνας" onClick={() => setExpanded(false)}>x</button></div>{source ? <img src={source} alt={image.originalName} className="max-h-[75svh] w-full object-contain" /> : <p className="ui-help">{error ? "Η εικόνα δεν είναι διαθέσιμη" : "Φόρτωση εικόνας..."}</p>}</div>
  </dialog>}</>;
}
