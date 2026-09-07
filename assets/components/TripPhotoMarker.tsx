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
  const [source, setSource] = useState<string>();
  const [ready, setReady] = useState(false);
  const photos = tripMapPhotos(trip, userId);
  const url = photos[0]?.thumbnailUrl;
  useEffect(() => {
    const marker = new maplibregl.Marker({ element, anchor: "bottom" }).setLngLat([trip.lon, trip.lat]).addTo(map);
    element.removeAttribute("role");
    element.removeAttribute("aria-label");
    element.removeAttribute("tabindex");
    return () => { marker.remove(); };
  }, [map, element, trip.lon, trip.lat]);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    setSource(undefined); setReady(false);
    const clear = () => { cancelled = true; setSource(undefined); setReady(false); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    window.addEventListener(SESSION_ENDED_EVENT, clear);
    if (url) void fetchTripImage(url).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob); setSource(objectUrl);
    }).catch(() => { if (!cancelled) setReady(false); });
    return () => { clear(); window.removeEventListener(SESSION_ENDED_EVENT, clear); };
  }, [url, userId]);
  useEffect(() => {
    map.setFeatureState({ source: "trips", id: trip.id }, { photo: ready });
    // The parent map can be removed before child cleanup during logout.
    return () => { if (map.getStyle()?.sources.trips) map.setFeatureState({ source: "trips", id: trip.id }, { photo: false }); };
  }, [map, trip.id, ready]);
  return createPortal(<button type="button" className="trip-photo-pin" data-ready={ready} aria-pressed={selected} aria-label={`${trip.locationName}: ${photos.length} φωτογραφίες, λεπτομέρειες εξόρμησης`} onClick={(event) => { event.stopPropagation(); onSelect(); }}>
    {source && <img src={source} alt="" onLoad={() => setReady(true)} onError={() => setReady(false)} />}
    {photos.length > 1 && <span className="trip-photo-count">{photos.length}</span>}
  </button>, element);
}
