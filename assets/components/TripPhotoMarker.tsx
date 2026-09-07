import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import maplibregl, { type Map } from "maplibre-gl";
import { fetchTripImage, SESSION_ENDED_EVENT } from "@/lib/client/api";
import type { SavedFishingTrip } from "@/lib/types";

export function tripMapPhotos(trip: SavedFishingTrip, userId?: string) {
  const owner = Boolean(userId && trip.userId === userId);
  return [...trip.images, ...trip.fishRecords.flatMap((fish) => fish.images)]
    .filter((image, index, images) => (owner || trip.visibility === "public" && trip.status === "completed" && trip.sharedMediaIds.includes(image.id)) && images.findIndex((item) => item.id === image.id) === index);
}

export function TripPhotoMarker({ map, trip, userId, selected, onSelect }: { map: Map; trip: SavedFishingTrip; userId?: string; selected: boolean; onSelect: () => void }) {
  const [element] = useState(() => document.createElement("div"));
  const [loaded, setLoaded] = useState<{ key: string; sources: string[] }>({ key: "", sources: [] });
  const photos = tripMapPhotos(trip, userId);
  const mediaKey = JSON.stringify([userId, trip.id, photos.map((photo) => [photo.id, photo.thumbnailUrl])]);
  const sources = loaded.key === mediaKey ? loaded.sources : [];
  const ready = sources.length > 0;
  useEffect(() => {
    const marker = new maplibregl.Marker({ element, anchor: "bottom" }).setLngLat([trip.lon, trip.lat]).addTo(map);
    element.removeAttribute("role");
    element.removeAttribute("aria-label");
    element.removeAttribute("tabindex");
    return () => { marker.remove(); };
  }, [map, element, trip.lon, trip.lat]);
  useEffect(() => {
    let cancelled = false;
    const objectUrls = new Set<string>();
    setLoaded({ key: mediaKey, sources: [] });
    const clear = () => {
      cancelled = true;
      setLoaded({ key: mediaKey, sources: [] });
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.clear();
    };
    window.addEventListener(SESSION_ENDED_EVENT, clear);
    void (async () => {
      const valid: string[] = [];
      for (const photo of photos) {
        if (cancelled || valid.length === 3) break;
        let url: string | undefined;
        try {
          const blob = await fetchTripImage(photo.thumbnailUrl);
          if (cancelled) return;
          url = URL.createObjectURL(blob);
          objectUrls.add(url);
          // Validate decoding before hiding the normal marker or occupying a card slot.
          const image = new Image();
          image.src = url;
          await image.decode();
          if (cancelled) return;
          valid.push(url);
          setLoaded({ key: mediaKey, sources: [...valid] });
        } catch {
          if (url && objectUrls.delete(url)) URL.revokeObjectURL(url);
        }
      }
    })();
    return () => { clear(); window.removeEventListener(SESSION_ENDED_EVENT, clear); };
  }, [mediaKey]);
  useEffect(() => {
    const source = selected ? "selected-trip" : "trips";
    if (map.getStyle()?.sources[source]) map.setFeatureState({ source, id: trip.id }, { photo: ready });
    // The parent map can be removed before child cleanup during logout.
    return () => { if (map.getStyle()?.sources[source]) map.setFeatureState({ source, id: trip.id }, { photo: false }); };
  }, [map, trip.id, ready, selected]);
  return createPortal(<button type="button" className="trip-photo-pin" data-ready={ready} data-cards={sources.length} aria-pressed={selected} aria-label={`${trip.locationName}: ${photos.length} φωτογραφίες, λεπτομέρειες εξόρμησης`} onClick={(event) => { event.stopPropagation(); onSelect(); }}>
    {sources.map((source) => <img key={source} className="trip-photo-card" src={source} alt="" />)}
    {photos.length > 1 && <span className="trip-photo-count" aria-hidden="true">{photos.length}</span>}
  </button>, element);
}
