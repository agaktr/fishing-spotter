import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchTripImage, SESSION_ENDED_EVENT } from "@/lib/client/api";
import type { TripMedia } from "@/lib/types";

export function TripMediaGallery({ images, onRemove, busy = false }: { images: TripMedia[]; onRemove?: (id: string) => void; busy?: boolean }) {
  const [selectedId, setSelectedId] = useState<string>();
  const index = images.findIndex((image) => image.id === selectedId);
  useEffect(() => {
    const clear = () => setSelectedId(undefined);
    window.addEventListener(SESSION_ENDED_EVENT, clear);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, clear);
  }, []);
  useEffect(() => { if (index < 0) setSelectedId(undefined); }, [index]);
  return images.length ? <><div className="mt-2 grid grid-cols-3 gap-2">
    {images.map((image) => <div key={image.id} className="relative min-w-0">
      <button type="button" aria-label={`Προβολή ${image.originalName}`} aria-haspopup="dialog" onClick={() => setSelectedId(image.id)} className="block aspect-square w-full overflow-hidden rounded-xl bg-slate-100">
        <PrivateImage key={image.thumbnailUrl} image={image} />
      </button>
      {onRemove && <button type="button" aria-label={`Διαγραφή ${image.originalName}`} className="absolute right-1 top-1 rounded-full bg-ink px-2 py-1 text-xs font-black text-white" disabled={busy} onClick={() => { if (window.confirm("Οριστική διαγραφή εικόνας;")) onRemove(image.id); }}>x</button>}
    </div>)}
  </div>{index >= 0 && createPortal(<MediaViewer images={images} index={index} onSelect={setSelectedId} onClose={() => setSelectedId(undefined)} />, document.body)}</> : null;
}

function PrivateImage({ image, full = false }: { image: TripMedia; full?: boolean }) {
  const [source, setSource] = useState<string>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    setSource(undefined); setError(false);
    const clear = () => { cancelled = true; setSource(undefined); if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = undefined; } };
    window.addEventListener(SESSION_ENDED_EVENT, clear);
    void fetchTripImage(full ? image.url : image.thumbnailUrl).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob); setSource(objectUrl);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; window.removeEventListener(SESSION_ENDED_EVENT, clear); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [image.url, image.thumbnailUrl, full]);
  return source && !error ? <img src={source} alt={image.originalName} onError={() => setError(true)} className={full ? "h-full w-full object-contain" : "h-full w-full object-cover"} /> : <span role="status" className="p-2 text-xs">{error ? "Η εικόνα δεν είναι διαθέσιμη" : "Φόρτωση εικόνας..."}</span>;
}

function MediaViewer({ images, index, onSelect, onClose }: { images: TripMedia[]; index: number; onSelect: (id: string) => void; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const image = images[index];
  const move = (direction: number) => onSelect(images[(index + direction + images.length) % images.length].id);
  useEffect(() => {
    const dialog = dialogRef.current!;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    closeRef.current?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  // The native modal contains focus; the portal escapes disabled editor fieldsets.
  return <dialog ref={dialogRef} aria-label="Προβολή εικόνων" aria-modal="true" className="media-dialog" onCancel={(event) => { event.preventDefault(); onClose(); }} onKeyDown={(event) => {
    if (event.key === "Tab") {
      const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button");
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    if (images.length > 1 && (event.key === "ArrowLeft" || event.key === "ArrowRight")) { event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1); }
  }}>
    <header className="flex min-w-0 items-center justify-between gap-3 p-3">
      <p aria-live="polite" aria-atomic="true" className="min-w-0 break-all text-xs font-bold">{image.originalName} · {index + 1} / {images.length}</p>
      <button ref={closeRef} type="button" className="media-viewer-control shrink-0" aria-label="Κλείσιμο εικόνας" onClick={onClose}>x</button>
    </header>
    <div className="flex min-h-0 items-center justify-center px-3"><PrivateImage key={`${image.id}:${image.url}`} image={image} full /></div>
    <footer className="flex items-center justify-center gap-4 p-3">
      {images.length > 1 && <><button type="button" className="media-viewer-control" aria-label="Προηγούμενη εικόνα" onClick={() => move(-1)}>&lt;</button><button type="button" className="media-viewer-control" aria-label="Επόμενη εικόνα" onClick={() => move(1)}>&gt;</button></>}
    </footer>
  </dialog>;
}
