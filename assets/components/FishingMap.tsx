"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection, LineString, Point, Polygon } from "geojson";
import type { Coordinates, GeocodedLocation, PointAnalysis, RankedSpot, SpotSearchMode } from "@/lib/types";
import { distanceKm, formatDistanceKm, round } from "@/lib/geo";
import type { SavedFishingTrip } from "@/lib/types";
import { TripPhotoMarker, tripMapPhotos } from "./TripPhotoMarker";

export type MapBaseLayer = "street" | "satellite" | "terrain";

interface FishingMapProps {
  location?: GeocodedLocation;
  radiusKm: number;
  spots: RankedSpot[];
  trips?: SavedFishingTrip[];
  userId?: string;
  selectedTripId?: string;
  tripFocus?: { id: string; lat: number; lon: number; revision: number };
  selectedSpotId?: string;
  loading: boolean;
  baseLayer: MapBaseLayer;
  depthVisible: boolean;
  recenterKey?: number;
  onMeasureStart?: () => void;
  pickedPoint?: Coordinates;
  mode?: SpotSearchMode;
  pointAnalysis?: PointAnalysis;
  onSelectSpot: (spotId: string) => void;
  onSelectTrip?: (tripId: string) => void;
  onPickPoint: (coordinates: Coordinates) => void;
}

interface TripMapMarker extends Coordinates {
  id: string;
  locationName: string;
  techniqueLabel: string;
  tripDate: string;
  fishCaught: string[];
  fishRecords?: Array<{ count: number }>;
  outcome: "not-recorded" | "zero" | "recorded";
  status: "active" | "completed";
}

type SpotProperties = Record<string, string | number | boolean>;
type MapFeatureCollection = FeatureCollection<Point | Polygon | LineString, SpotProperties>;

const EMPTY_COLLECTION: MapFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

export function FishingMap({ location, radiusKm, spots, trips = [], userId, selectedTripId, tripFocus, selectedSpotId, loading, baseLayer, depthVisible, recenterKey = 0, onMeasureStart, pickedPoint, mode, pointAnalysis, onSelectSpot, onSelectTrip, onPickPoint }: FishingMapProps) {
  const [readyMap, setReadyMap] = useState<MapLibreMap>();
  const [measuring, setMeasuring] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<Coordinates[]>([]);
  const measuringRef = useRef(false);
  const measurementLabel = measurePoints.length === 2 ? formatDistanceKm(distanceKm(measurePoints[0], measurePoints[1])).replace(/(km|m)$/, " $1") : undefined;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const centerMarkerRef = useRef<maplibregl.Marker | null>(null);
  const onSelectSpotRef = useRef(onSelectSpot);
  const onSelectTripRef = useRef(onSelectTrip);
  const onPickPointRef = useRef(onPickPoint);
  const lastFitKeyRef = useRef<string | undefined>(undefined);
  const lastTripFitKeyRef = useRef<string | undefined>(undefined);
  const lastRecenterKeyRef = useRef(recenterKey);

  useEffect(() => {
    onSelectSpotRef.current = onSelectSpot;
  }, [onSelectSpot]);

  useEffect(() => {
    onSelectTripRef.current = onSelectTrip;
  }, [onSelectTrip]);

  useEffect(() => {
    onPickPointRef.current = onPickPoint;
  }, [onPickPoint]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
          satellite: {
            type: "raster",
            tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256,
            attribution: "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
          },
          terrain: {
            type: "raster",
            tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "Map data © OpenStreetMap contributors, SRTM | OpenTopoMap CC-BY-SA",
          },
          emodnetDepth: {
            type: "raster",
            tiles: ["/api/depth-tiles/{z}/{x}/{y}.png"],
            tileSize: 256,
            maxzoom: 15,
            attribution: "EMODnet Bathymetry 2024 · CC BY 4.0 · Not for navigation",
          },
          openseamap: {
            type: "raster",
            tiles: ["https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenSeaMap contributors",
          },
        },
        layers: [
          { id: "osm", type: "raster", source: "osm" },
          { id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" } },
          { id: "terrain", type: "raster", source: "terrain", layout: { visibility: "none" } },
          {
            id: "emodnetDepth",
            type: "raster",
            source: "emodnetDepth",
            layout: { visibility: "none" },
            paint: { "raster-opacity": 0.58 },
          },
          {
            id: "openseamap",
            type: "raster",
            source: "openseamap",
            paint: { "raster-opacity": 0.9 },
          },
        ],
      },
      center: [22.56, 36.76],
      zoom: 10,
      attributionControl: { compact: true },
      locale: {
        "NavigationControl.ZoomIn": "Μεγέθυνση",
        "NavigationControl.ZoomOut": "Σμίκρυνση",
        "NavigationControl.ResetBearing": "Επαναφορά στον βορρά",
      },
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: "metric" }), "top-left");

    map.on("load", () => {
      map.addSource("radius", {
        type: "geojson",
        data: EMPTY_COLLECTION,
      });
      map.addSource("search-center", {
        type: "geojson",
        data: EMPTY_COLLECTION,
      });
      map.addSource("picked-point", {
        type: "geojson",
        data: EMPTY_COLLECTION,
      });
      map.addSource("trips", {
        type: "geojson",
        promoteId: "id",
        data: EMPTY_COLLECTION,
      });
      map.addSource("spots", {
        type: "geojson",
        data: EMPTY_COLLECTION,
      });
      map.addSource("depth-profile", {
        type: "geojson",
        data: EMPTY_COLLECTION,
      });
      map.addSource("point-analysis", {
        type: "geojson",
        data: EMPTY_COLLECTION,
      });

      map.addLayer({
        id: "radius-fill",
        type: "fill",
        source: "radius",
        paint: {
          "fill-color": "#19a7ce",
          "fill-opacity": 0.1,
        },
      });

      map.addLayer({
        id: "radius-line",
        type: "line",
        source: "radius",
        paint: {
          "line-color": "#0b5f6f",
          "line-width": 2,
          "line-dasharray": [2, 2],
        },
      });

      map.addLayer({
        id: "search-center-halo",
        type: "circle",
        source: "search-center",
        paint: {
          "circle-radius": 17,
          "circle-color": "#19a7ce",
          "circle-opacity": 0.2,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });

      map.addLayer({
        id: "search-center-dot",
        type: "circle",
        source: "search-center",
        paint: {
          "circle-radius": 7,
          "circle-color": "#19a7ce",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
        },
      });

      map.addLayer({
        id: "search-center-label",
        type: "symbol",
        source: "search-center",
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-size": 12,
          "text-offset": [0, -1.7],
          "text-anchor": "bottom",
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#09202a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 2,
        },
      });

      map.addLayer({
        id: "picked-point-halo",
        type: "circle",
        source: "picked-point",
        paint: {
          "circle-radius": 19,
          "circle-color": "#1f5136",
          "circle-opacity": 0.18,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });

      map.addLayer({
        id: "picked-point-dot",
        type: "circle",
        source: "picked-point",
        paint: {
          "circle-radius": 8,
          "circle-color": "#1f5136",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
        },
      });

      map.addLayer({
        id: "picked-point-label",
        type: "symbol",
        source: "picked-point",
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-size": 12,
          "text-offset": [0, 1.45],
          "text-anchor": "top",
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#1f5136",
          "text-halo-color": "#ffffff",
          "text-halo-width": 2,
        },
      });

      map.addLayer({
        id: "spots-halo",
        type: "circle",
        source: "spots",
        paint: {
          "circle-radius": 18,
          "circle-color": "#ffffff",
          "circle-opacity": 0.86,
          "circle-blur": 0.12,
        },
      });

      map.addLayer({
        id: "depth-profile-line",
        type: "line",
        source: "depth-profile",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": "#0b5f6f",
          "line-width": 3,
          "line-dasharray": [1.5, 1.5],
          "line-opacity": 0.75,
        },
      });

      map.addLayer({
        id: "depth-profile-points",
        type: "circle",
        source: "depth-profile",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 8,
          "circle-color": "#09202a",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });

      map.addLayer({
        id: "depth-profile-labels",
        type: "symbol",
        source: "depth-profile",
        filter: ["==", ["geometry-type"], "Point"],
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-size": 14,
          "text-offset": [0, 1.35],
          "text-anchor": "top",
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#09202a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 2,
        },
      });

      map.addLayer({
        id: "point-analysis-lines",
        type: "line",
        source: "point-analysis",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": ["case", ["==", ["get", "kind"], "adjustment"], "#d97706", "#0b5f6f"],
          "line-width": ["case", ["==", ["get", "kind"], "adjustment"], 2, 4],
          "line-dasharray": [2, 1.5],
        },
      });

      map.addLayer({
        id: "point-analysis-points",
        type: "circle",
        source: "point-analysis",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": ["match", ["get", "kind"], "requested", 9, "analyzed", 11, "target", 10, 6],
          "circle-color": ["match", ["get", "kind"], "requested", "#d97706", "analyzed", "#19a7ce", "target", "#09202a", "#0b5f6f"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
        },
      });

      map.addLayer({
        id: "point-analysis-labels",
        type: "symbol",
        source: "point-analysis",
        filter: ["all", ["==", ["geometry-type"], "Point"], ["!=", ["get", "kind"], "profile"]],
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-size": 14,
          "text-offset": [0, 1.45],
          "text-anchor": "top",
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#09202a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 2,
        },
      });

      map.addLayer({
        id: "spots-circle",
        type: "circle",
        source: "spots",
        paint: {
          "circle-radius": ["case", ["==", ["get", "selected"], true], 15, 11],
          "circle-color": ["match", ["get", "recommendationStatus"], "unsuitable", "#b91c1c", "caution", "#d97706", "eligible", "#0b5f6f", "#64748b"],
          "circle-stroke-color": ["case", ["==", ["get", "selected"], true], "#09202a", "#ffffff"],
          "circle-stroke-width": ["case", ["==", ["get", "selected"], true], 4, 2],
        },
      });

      map.addLayer({
        id: "spots-rank",
        type: "symbol",
        source: "spots",
        layout: {
          "text-field": ["to-string", ["get", "rank"]],
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-size": 12,
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#ffffff",
        },
      });

      map.addLayer({
        id: "trips-halo",
        type: "circle",
        source: "trips",
        paint: {
          "circle-radius": 17,
          "circle-color": "#f59e0b",
          "circle-opacity": ["case", ["boolean", ["feature-state", "photo"], false], 0, 0.26],
          "circle-stroke-opacity": ["case", ["boolean", ["feature-state", "photo"], false], 0, 1],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });

      map.addLayer({
        id: "trips-circle",
        type: "circle",
        source: "trips",
        paint: {
          "circle-radius": 9,
          "circle-opacity": ["case", ["boolean", ["feature-state", "photo"], false], 0, 1],
          "circle-stroke-opacity": ["case", ["boolean", ["feature-state", "photo"], false], 0, 1],
          "circle-color": "#d97706",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
        },
      });

      map.addLayer({
        id: "trips-label",
        type: "symbol",
        source: "trips",
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-size": 11,
          "text-offset": [0, 1.4],
          "text-anchor": "top",
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#78350f",
          "text-halo-color": "#ffffff",
          "text-halo-width": 2,
        },
      });

      map.addSource("measurement", { type: "geojson", data: EMPTY_COLLECTION });
      map.addLayer({ id: "measurement-line", type: "line", source: "measurement", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#fbbf24", "line-width": 4, "line-dasharray": [2, 2] } });
      map.addLayer({ id: "measurement-endpoints", type: "circle", source: "measurement", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 7, "circle-color": "#fbbf24", "circle-stroke-color": "#09202a", "circle-stroke-width": 3 } });
      map.addLayer({ id: "measurement-label", type: "symbol", source: "measurement", filter: ["==", ["geometry-type"], "LineString"], layout: { "symbol-placement": "line-center", "text-field": ["get", "label"], "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"], "text-size": 16, "text-allow-overlap": true, "text-offset": [0, -1] }, paint: { "text-color": "#09202a", "text-halo-color": "#ffffff", "text-halo-width": 3 } });

      const selectSpot = (event: maplibregl.MapLayerMouseEvent) => {
        if (measuringRef.current) return;
        const feature = event.features?.[0];
        const id = feature?.properties?.id;
        if (typeof id === "string") {
          onSelectSpotRef.current(id);
        }
      };

      map.on("click", "spots-circle", selectSpot);
      map.on("click", "spots-rank", selectSpot);
      const selectTrip = (event: maplibregl.MapLayerMouseEvent) => {
        if (measuringRef.current) return;
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === "string") {
          onSelectTripRef.current?.(id);
        }
      };
      map.on("click", "trips-halo", selectTrip);
      map.on("click", "trips-circle", selectTrip);
      map.on("click", "trips-label", selectTrip);

      map.on("click", (event) => {
        if (measuringRef.current) {
          const point = { lat: event.lngLat.lat, lon: event.lngLat.lng };
          setMeasurePoints((points) => points.length < 2 ? [...points, point] : points);
          return;
        }
        const existingFeatures = map.queryRenderedFeatures(event.point, { layers: ["spots-circle", "spots-rank", "point-analysis-points", "point-analysis-labels", "trips-halo", "trips-circle", "trips-label"] });
        if (existingFeatures.length > 0) {
          return;
        }

        onPickPointRef.current({ lat: event.lngLat.lat, lon: event.lngLat.lng });
      });

      const showPointer = () => {
        map.getCanvas().style.cursor = measuringRef.current ? "crosshair" : "pointer";
      };

      const hidePointer = () => {
        map.getCanvas().style.cursor = measuringRef.current ? "crosshair" : "";
      };

      map.on("mouseenter", "spots-circle", showPointer);
      map.on("mouseenter", "spots-rank", showPointer);
      map.on("mouseenter", "trips-circle", showPointer);
      map.on("mouseenter", "trips-halo", showPointer);
      map.on("mouseenter", "trips-label", showPointer);
      map.on("mouseleave", "spots-circle", hidePointer);
      map.on("mouseleave", "spots-rank", hidePointer);
      map.on("mouseleave", "trips-circle", hidePointer);
      map.on("mouseleave", "trips-halo", hidePointer);
      map.on("mouseleave", "trips-label", hidePointer);
      setReadyMap(map);
    });

    mapRef.current = map;

    return () => {
      centerMarkerRef.current?.remove();
      centerMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const update = () => {
      for (const layerId of ["osm", "satellite", "terrain"]) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, "visibility", layerId === (baseLayer === "street" ? "osm" : baseLayer) ? "visible" : "none");
        }
      }
    };

    if (map.getLayer("osm")) {
      update();
    } else {
      map.once("load", update);
      return () => {
        map.off("load", update);
      };
    }
  }, [baseLayer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const update = () => {
      if (map.getLayer("emodnetDepth")) {
        map.setLayoutProperty("emodnetDepth", "visibility", depthVisible ? "visible" : "none");
      }
    };

    if (map.getLayer("emodnetDepth")) {
      update();
    } else {
      map.once("load", update);
      return () => {
        map.off("load", update);
      };
    }
  }, [depthVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const update = () => {
      const source = map.getSource("picked-point") as maplibregl.GeoJSONSource | undefined;
      source?.setData(toPickedPointCollection(pointAnalysis ? undefined : pickedPoint));
    };

    if (map.getSource("picked-point")) {
      update();
    } else {
      map.once("load", update);
      return () => {
        map.off("load", update);
      };
    }
  }, [pickedPoint, pointAnalysis]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const update = () => {
      const validTrips = trips.filter(isValidTripMarker);
      const source = map.getSource("trips") as maplibregl.GeoJSONSource | undefined;
      source?.setData(toTripCollection(validTrips));

      const fitKey = tripFitKey(validTrips);
      if (!tripFocus && !location && !pickedPoint && validTrips.length > 0 && lastTripFitKeyRef.current !== fitKey) {
        fitTripMarkers(map, validTrips);
      }
      lastTripFitKeyRef.current = fitKey;
    };

    if (map.getSource("trips")) {
      update();
    } else {
      map.once("load", update);
      return () => {
        map.off("load", update);
      };
    }
  }, [location, pickedPoint, trips, tripFocus]);

  useEffect(() => {
    const recenterRequested = recenterKey !== lastRecenterKeyRef.current;
    lastRecenterKeyRef.current = recenterKey;
    // Clearing a selection must not recenter on the fallback pin or location.
    if (!selectedSpotId && !recenterRequested) return;
    const map = mapRef.current;
    const point = spots.find((spot) => spot.id === selectedSpotId) ?? pickedPoint ?? location;
    if (!map || !point) return;
    const update = () => {
      // Center in the unobscured map area, not underneath the active sheet.
      const panel = containerRef.current?.closest("main")?.querySelector<HTMLElement>(".search-panel, .results-panel, .map-analysis .workflow-panel");
      const bounds = panel?.getBoundingClientRect();
      const desktop = map.getContainer().clientWidth >= 640;
      map.easeTo({ center: [point.lon, point.lat], offset: bounds ? desktop ? [-bounds.width / 2, 0] : [0, -bounds.height / 2] : [0, 0], duration: 500 });
    };
    if (map.getSource("spots")) update();
    else map.once("load", update);
    return () => { map.off("load", update); };
  }, [selectedSpotId, recenterKey]);

  // New result framing takes precedence over selection recentering.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const update = () => {
      const spotSource = map.getSource("spots") as maplibregl.GeoJSONSource | undefined;
      const radiusSource = map.getSource("radius") as maplibregl.GeoJSONSource | undefined;
      const depthProfileSource = map.getSource("depth-profile") as maplibregl.GeoJSONSource | undefined;
      const searchCenterSource = map.getSource("search-center") as maplibregl.GeoJSONSource | undefined;
      const pointAnalysisSource = map.getSource("point-analysis") as maplibregl.GeoJSONSource | undefined;

      if (mode === "point" && pointAnalysis) {
        const pointData = toPointAnalysisCollection(pointAnalysis, spots[0]);
        spotSource?.setData(EMPTY_COLLECTION);
        radiusSource?.setData(EMPTY_COLLECTION);
        depthProfileSource?.setData(EMPTY_COLLECTION);
        searchCenterSource?.setData(EMPTY_COLLECTION);
        pointAnalysisSource?.setData(pointData);
        centerMarkerRef.current?.remove();
        centerMarkerRef.current = null;

        const fitKey = pointAnalysisFitKey(pointAnalysis);
        if (lastFitKeyRef.current !== fitKey) {
          fitPointAnalysis(map, pointAnalysis, spots[0]);
          lastFitKeyRef.current = fitKey;
        }
        return;
      }

      pointAnalysisSource?.setData(EMPTY_COLLECTION);

      if (!location) {
        spotSource?.setData(EMPTY_COLLECTION);
        radiusSource?.setData(EMPTY_COLLECTION);
        depthProfileSource?.setData(EMPTY_COLLECTION);
        searchCenterSource?.setData(EMPTY_COLLECTION);
        centerMarkerRef.current?.remove();
        centerMarkerRef.current = null;
        lastFitKeyRef.current = undefined;
        return;
      }

      const spotData = toSpotCollection(spots, selectedSpotId);
      const radiusData = toRadiusCollection(location, radiusKm);
      const depthProfileData = toDepthProfileCollection(spots.find((spot) => spot.id === selectedSpotId) ?? spots[0]);
      const searchCenterData = toSearchCenterCollection(location);
      const fitKey = mapFitKey(location, radiusKm, spots);

      spotSource?.setData(spotData);
      radiusSource?.setData(radiusData);
      depthProfileSource?.setData(depthProfileData);
      searchCenterSource?.setData(searchCenterData);
      updateSearchCenterMarker(map, location, centerMarkerRef);

      if (lastFitKeyRef.current !== fitKey) {
        const bounds = new maplibregl.LngLatBounds([location.lon, location.lat], [location.lon, location.lat]);
        for (const spot of spots) {
          bounds.extend([spot.lon, spot.lat]);
        }

        map.fitBounds(bounds, {
          padding: { top: 70, bottom: 70, left: 70, right: 70 },
          maxZoom: spots.length ? 13 : 10,
          duration: 700,
        });
        lastFitKeyRef.current = fitKey;
      }
    };

    if (map.getSource("spots")) {
      update();
    } else {
      map.once("load", update);
      return () => {
        map.off("load", update);
      };
    }
  }, [location, mode, pointAnalysis, radiusKm, selectedSpotId, spots]);

  // Explicit journal navigation wins over automatic result/trip framing.
  useEffect(() => {
    if (!tripFocus || !readyMap || !isValidTripMarker(tripFocus)) return;
    toggleMeasurement(false);
    readyMap.easeTo({ center: [tripFocus.lon, tripFocus.lat], zoom: 14, padding: { top: 0, bottom: 0, left: 0, right: 0 }, offset: [0, 0], duration: 500 });
    readyMap.getCanvas().focus({ preventScroll: true });
  }, [tripFocus, readyMap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      const features: MapFeatureCollection["features"] = measurePoints.map((point) => pointFeature(point, "measurement", ""));
      if (measurementLabel) features.push({ type: "Feature", geometry: { type: "LineString", coordinates: measurePoints.map((point) => [point.lon, point.lat]) }, properties: { label: measurementLabel } });
      (map.getSource("measurement") as maplibregl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
    };
    if (map.getSource("measurement")) update();
    else map.once("load", update);
    return () => { map.off("load", update); };
  }, [measurePoints, measurementLabel]);

  function toggleMeasurement(active: boolean) {
    measuringRef.current = active;
    setMeasuring(active);
    setMeasurePoints([]);
    const map = mapRef.current;
    if (map) {
      map.getCanvas().style.cursor = active ? "crosshair" : "";
      if (active) map.doubleClickZoom.disable();
      else map.doubleClickZoom.enable();
    }
    if (active) onMeasureStart?.();
  }

  return (
    <div className="relative h-full min-h-[100svh] w-full">
      <div ref={containerRef} className="h-full w-full" aria-label="Χάρτης ψαρότοπων" />
      {readyMap && trips.filter((trip) => isValidTripMarker(trip) && tripMapPhotos(trip, userId).length > 0).map((trip) => <TripPhotoMarker key={trip.id} map={readyMap} trip={trip} userId={userId} selected={trip.id === selectedTripId} onSelect={() => { if (!measuringRef.current) onSelectTripRef.current?.(trip.id); }} />)}
      <div className="measure-tools" data-active={measuring} aria-label="Μέτρηση απόστασης">
        <button className={measuring ? "ui-primary" : "ui-secondary"} aria-pressed={measuring} onClick={() => toggleMeasurement(!measuring)}>{measuring ? "Έξοδος μέτρησης" : "Μέτρηση"}</button>
        {measuring && <div className="measure-status"><p role="status" aria-live="polite">{measurementLabel ? `Απόσταση: ${measurementLabel}` : measurePoints.length ? "Πάτησε το δεύτερο σημείο" : "Πάτησε το πρώτο σημείο"}</p><p className="ui-help">Ευθεία απόσταση, όχι διαδρομή ή οδηγία πλοήγησης.</p><button className="ui-secondary" disabled={!measurePoints.length} onClick={() => setMeasurePoints([])}>Καθαρισμός</button></div>}
      </div>
      {loading && (
        <div className="absolute inset-0 grid place-items-center bg-ink/20 backdrop-blur-[2px]">
          <div className="rounded-3xl bg-white px-6 py-4 text-center shadow-glow">
            <p className="text-sm font-black text-ink">Σάρωση ακτογραμμής</p>
            <p className="mt-1 text-xs text-slate-600">OSM, καιρός, θάλασσα και ενδεικτική συμβατότητα</p>
          </div>
        </div>
      )}
    </div>
  );
}

function toSpotCollection(spots: RankedSpot[], selectedSpotId?: string): MapFeatureCollection {
  return {
    type: "FeatureCollection",
    features: spots.map((spot) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [spot.lon, spot.lat],
      },
      properties: {
        id: spot.id,
        rank: spot.rank,
        score: spot.score,
        recommendationStatus: spot.conditionsStatus === "adverse" ? "unsuitable" : spot.recommendationStatus ?? "unverified",
        selected: spot.id === selectedSpotId,
        name: spot.name,
      },
    })),
  };
}

function toTripCollection(trips: TripMapMarker[]): MapFeatureCollection {
  return {
    type: "FeatureCollection",
    features: trips.map((trip) => ({
      type: "Feature",
      id: trip.id,
      geometry: {
        type: "Point",
        coordinates: [trip.lon, trip.lat],
      },
      properties: {
        id: trip.id,
        label: `${trip.status === "active" ? "Ενεργή" : "Εξόρμηση"} ${trip.outcome === "zero" ? "0" : trip.outcome === "recorded" ? tripFishCount(trip) : "? (μη καταγεγραμμένο)"}`,
        name: trip.locationName,
        technique: trip.techniqueLabel,
        tripDate: trip.tripDate,
      },
    })),
  };
}

function isValidTripMarker(trip: Coordinates): boolean {
  return Number.isFinite(trip.lat) && Number.isFinite(trip.lon) && trip.lat >= -90 && trip.lat <= 90 && trip.lon >= -180 && trip.lon <= 180;
}

function tripFishCount(trip: TripMapMarker): number {
  if (trip.fishRecords?.length) {
    return trip.fishRecords.reduce((sum, record) => {
      const count = Number.isFinite(record.count) ? Math.round(record.count) : 0;
      return sum + Math.max(0, count);
    }, 0);
  }

  return trip.fishCaught.length;
}

function tripFitKey(trips: TripMapMarker[]): string {
  return trips.map((trip) => `${trip.id}:${round(trip.lat, 5)},${round(trip.lon, 5)}`).join("|");
}

function fitTripMarkers(map: MapLibreMap, trips: TripMapMarker[]) {
  if (trips.length === 1) {
    map.flyTo({ center: [trips[0].lon, trips[0].lat], zoom: 12, duration: 700 });
    return;
  }

  const bounds = new maplibregl.LngLatBounds([trips[0].lon, trips[0].lat], [trips[0].lon, trips[0].lat]);
  for (const trip of trips.slice(1)) {
    bounds.extend([trip.lon, trip.lat]);
  }

  map.fitBounds(bounds, {
    padding: { top: 90, bottom: 90, left: 90, right: 90 },
    maxZoom: 12,
    duration: 700,
  });
}

function toRadiusCollection(location: GeocodedLocation, radiusKm: number): MapFeatureCollection {
  const coordinates: number[][] = [];
  const points = 96;
  const radiusMeters = radiusKm * 1000;
  const earthRadiusM = 6371008.8;
  const lat = (location.lat * Math.PI) / 180;
  const lon = (location.lon * Math.PI) / 180;
  const angularDistance = radiusMeters / earthRadiusM;

  for (let i = 0; i <= points; i += 1) {
    const bearing = (i / points) * Math.PI * 2;
    const pointLat = Math.asin(
      Math.sin(lat) * Math.cos(angularDistance) +
        Math.cos(lat) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const pointLon =
      lon +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat),
        Math.cos(angularDistance) - Math.sin(lat) * Math.sin(pointLat),
      );

    coordinates.push([((pointLon * 180) / Math.PI + 540) % 360 - 180, (pointLat * 180) / Math.PI]);
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [coordinates],
        },
        properties: {},
      },
    ],
  };
}

function toSearchCenterCollection(location: GeocodedLocation): MapFeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [location.lon, location.lat],
        },
        properties: {
          label: searchCenterLabel(location),
        },
      },
    ],
  };
}

function toPickedPointCollection(point?: Coordinates): MapFeatureCollection {
  if (!point) {
    return EMPTY_COLLECTION;
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [point.lon, point.lat],
        },
        properties: {
          label: "Επιλεγμένο σημείο",
        },
      },
    ],
  };
}

export function toPointAnalysisCollection(analysis: PointAnalysis, spot?: RankedSpot): MapFeatureCollection {
  const features: MapFeatureCollection["features"] = [];
  const profilePoints = spot?.depth.castingProfile.filter(hasMapCoordinates) ?? [];

  if (spot && !spot.depth.hasNearbyWater) {
    features.push(pointFeature(analysis.requestedPoint, "requested", "Δεν βρέθηκε κελί νερού"));
    return { type: "FeatureCollection", features };
  }

  if (analysis.adjustedToWater) {
    features.push(pointFeature(analysis.requestedPoint, "requested", "Ζητήθηκε"));
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [analysis.requestedPoint.lon, analysis.requestedPoint.lat],
          [analysis.analyzedPoint.lon, analysis.analyzedPoint.lat],
        ],
      },
      properties: { kind: "adjustment" },
    });
  }

  features.push(pointFeature(
    analysis.analyzedPoint,
    "analyzed",
    analysis.approximateZone ? "Δείγμα μοντέλου, όχι στόχος βολής" : "Σημείο δειγματοληψίας",
  ));

  for (const point of profilePoints) {
    features.push(pointFeature(
      { lat: point.lat, lon: point.lon },
      "profile",
      typeof point.depthM === "number" ? `${point.distanceM}μ / ${round(point.depthM, 0)}μ` : `${point.distanceM}μ`,
    ));
  }

  return { type: "FeatureCollection", features };
}

function pointFeature(coordinates: Coordinates, kind: string, label: string): MapFeatureCollection["features"][number] {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [coordinates.lon, coordinates.lat] },
    properties: { kind, label },
  };
}

function hasMapCoordinates(point: RankedSpot["depth"]["castingProfile"][number]): point is typeof point & Required<Pick<typeof point, "lat" | "lon">> {
  return typeof point.lat === "number" && Number.isFinite(point.lat) && typeof point.lon === "number" && Number.isFinite(point.lon);
}

function pointAnalysisFitKey(analysis: PointAnalysis): string {
  return `point:${round(analysis.requestedPoint.lat, 5)},${round(analysis.requestedPoint.lon, 5)}:${round(analysis.analyzedPoint.lat, 5)},${round(analysis.analyzedPoint.lon, 5)}`;
}

function fitPointAnalysis(map: MapLibreMap, analysis: PointAnalysis, spot?: RankedSpot) {
  const coordinates = [analysis.requestedPoint, analysis.analyzedPoint];
  for (const point of spot?.depth.castingProfile.filter(hasMapCoordinates) ?? []) {
    coordinates.push({ lat: point.lat, lon: point.lon });
  }
  const bounds = new maplibregl.LngLatBounds(
    [coordinates[0].lon, coordinates[0].lat],
    [coordinates[0].lon, coordinates[0].lat],
  );
  for (const point of coordinates.slice(1)) {
    bounds.extend([point.lon, point.lat]);
  }

  const desktop = map.getContainer().clientWidth >= 1024;
  const height = map.getContainer().clientHeight;
  map.fitBounds(bounds, {
    padding: desktop
      ? { top: 100, bottom: 100, left: 80, right: 560 }
      : { top: Math.min(90, height * 0.15), bottom: height * 0.48, left: 35, right: 35 },
    maxZoom: 16,
    duration: 700,
  });
}

function mapFitKey(location: GeocodedLocation, radiusKm: number, spots: RankedSpot[]): string {
  return [
    round(location.lat, 5),
    round(location.lon, 5),
    round(radiusKm, 2),
    spots.map((spot) => `${spot.id}:${round(spot.lat, 5)},${round(spot.lon, 5)}`).join("|"),
  ].join(";");
}

function updateSearchCenterMarker(
  map: MapLibreMap,
  location: GeocodedLocation,
  markerRef: React.MutableRefObject<maplibregl.Marker | null>,
) {
  const label = searchCenterLabel(location);

  if (!markerRef.current) {
    const element = document.createElement("div");
    element.className = "pointer-events-none relative grid place-items-center";
    element.style.zIndex = "30";
    element.innerHTML = `
      <span class="absolute h-8 w-8 rounded-full bg-sky-400/30 ring-2 ring-white"></span>
      <span class="relative h-4 w-4 rounded-full border-[3px] border-white bg-sky-500 shadow-lg"></span>
      <span data-center-label class="absolute left-1/2 top-[-2rem] -translate-x-1/2 whitespace-nowrap rounded-full border border-sky-200 bg-white px-2.5 py-1 text-[11px] font-black text-sky-700 shadow-md"></span>
    `;
    markerRef.current = new maplibregl.Marker({ element, anchor: "center" }).setLngLat([location.lon, location.lat]).addTo(map);
  }

  const element = markerRef.current.getElement();
  const labelElement = element.querySelector("[data-center-label]");
  if (labelElement) {
    labelElement.textContent = label;
  }

  markerRef.current.setLngLat([location.lon, location.lat]);
}

function searchCenterLabel(location: GeocodedLocation): string {
  if (location.displayName.startsWith("Η θέση μου")) {
    return "Η θέση μου";
  }
  if (location.displayName.startsWith("Επιλεγμένο σημείο")) {
    return "Επιλεγμένο σημείο";
  }

  return "Κέντρο αναζήτησης";
}

function toDepthProfileCollection(selectedSpot?: RankedSpot): MapFeatureCollection {
  const points = selectedSpot?.depth.castingProfile.filter(hasMapCoordinates).filter((point) => typeof point.depthM === "number") ?? [];
  if (!selectedSpot || points.length === 0) {
    return EMPTY_COLLECTION;
  }

  const coordinates: number[][] = [[selectedSpot.lon, selectedSpot.lat]];
  const features: MapFeatureCollection["features"] = [];

  for (const point of points) {
    coordinates.push([point.lon, point.lat]);
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [point.lon, point.lat],
      },
      properties: {
        label: `Βάθος ~${round(point.depthM ?? 0, 0)} μ`,
        distanceM: point.distanceM,
        depthM: round(point.depthM ?? 0, 0),
      },
    });
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates,
        },
        properties: { label: "Ενδεικτικά δείγματα ζώνης ~115μ" },
      },
      ...features,
    ],
  };
}
