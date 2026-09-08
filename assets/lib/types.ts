export type TechniqueId =
  | "surfcasting"
  | "spinning"
  | "shore-jigging"
  | "eging"
  | "bottom-fishing"
  | "rock-fishing"
  | "boat-fishing";

export type SpotCategory =
  | "beach"
  | "harbour"
  | "breakwater"
  | "pier"
  | "rocky"
  | "reef"
  | "shoal"
  | "headland"
  | "estuary"
  | "marina"
  | "bay"
  | "fallback";

export type AccessRating = "easy" | "moderate" | "hard" | "restricted" | "unknown";

export type SeabedType = "sand" | "mixed" | "rock" | "reef" | "weed" | "mud" | "harbour" | "unknown";

export type SnagRisk = "low" | "medium" | "high" | "unknown";

export interface Coordinates {
  lat: number;
  lon: number;
}

export type SpotSearchMode = "nearby" | "point";

export interface SpotsApiRequest {
  technique: TechniqueId;
  location: string;
  targetSpecies?: string;
  fishingAt?: string;
  mode: SpotSearchMode;
  coordinates?: Coordinates;
  locationLabel?: string;
  gpsAccuracyM?: number;
  resultLimit: number;
  radiusKm: number;
  saveHistory: boolean;
}

export interface SearchIntent {
  raw: string;
  technique: TechniqueId;
  techniqueLabel: string;
  locationText: string;
  radiusKm: number;
  targetSpecies?: string;
  timeHint?: string;
  confidence: number;
}

export interface GeocodedLocation extends Coordinates {
  displayName: string;
  countryCode?: string;
}

export interface AccessSummary {
  rating: AccessRating;
  parkingDistanceM?: number;
  notes: string[];
}

export interface CandidateSpot extends Coordinates {
  id: string;
  osmType: "node" | "way" | "relation" | "fallback";
  osmId?: number;
  name: string;
  category: SpotCategory;
  distanceKm: number;
  tags: Record<string, string>;
  access: AccessSummary;
  dataQuality: "osm" | "generated";
}

export interface DepthProfile {
  source: "emodnet-dtm-2024" | "opentopodata-gebco2020" | "estimated" | "unavailable";
  hasNearbyWater: boolean;
  isSpotInWater?: boolean;
  shoreDistanceM?: number;
  waterBearingDeg?: number;
  closestFishableDepthM?: number;
  castingDepthM?: number;
  maxDepthM?: number;
  castingProfile: Array<{
    distanceM: number;
    depthM?: number;
    lat?: number;
    lon?: number;
    confidence: "measured" | "estimated" | "none";
  }>;
  slope: "flat" | "gentle" | "moderate" | "steep" | "unknown";
  seabedType: SeabedType;
  snagRisk: SnagRisk;
  style: string;
  sampleCount: number;
  confidence: "high" | "medium" | "low" | "none";
}

export type TechniqueDepthStatus = "ideal" | "shallow" | "deep" | "too-shallow" | "too-deep" | "unknown";

export interface TechniqueDepthRange {
  techniqueLabel: string;
  valueM?: number;
  idealMinM: number;
  idealMaxM: number;
  softMinM: number;
  softMaxM: number;
  status: TechniqueDepthStatus;
  label: string;
}

export interface ConditionsMetadata {
  sourceSnapshot?: ConditionsMetadata;
  validAt?: string;
  fetchedAt?: string;
  sourceCoordinates?: Coordinates;
  temporalMode?: string;
}

export interface MarineSnapshot extends ConditionsMetadata {
  waveHeightM?: number;
  waveDirectionDeg?: number;
  wavePeriodS?: number;
  swellHeightM?: number;
  swellDirectionDeg?: number;
  swellPeriodS?: number;
  seaSurfaceTemperatureC?: number;
  currentSpeedKmh?: number;
  currentDirectionDeg?: number;
  seaLevelMslM?: number;
  confidence: "high" | "medium" | "low" | "none";
}

export interface WeatherSnapshot extends ConditionsMetadata {
  airTemperatureC?: number;
  apparentTemperatureC?: number;
  relativeHumidityPct?: number;
  windSpeedKmh?: number;
  windDirectionDeg?: number;
  gustKmh?: number;
  pressureHpa?: number;
  pressureTrend: "rising" | "falling" | "stable" | "unknown";
  precipitationMm?: number;
  weatherCode?: number;
  cloudCoverPct?: number;
  visibilityM?: number;
  moonPhase?: number;
  isDay?: boolean;
  confidence: "high" | "medium" | "low" | "none";
}

export interface FactorScore {
  key: string;
  label: string;
  score: number;
  weight: number;
  explanation: string;
}

export interface RankedSpot extends CandidateSpot {
  recommendationStatus?: "eligible" | "caution" | "unsuitable" | "unverified";
  recommendationReasons?: string[];
  conditionsStatus?: "adverse" | "unknown" | "no-adverse-signal";
  scoreMeaning?: "heuristic-fit";
  actionabilityLabel?: string;
  rank: number;
  score: number;
  summary: string;
  depth: DepthProfile;
  marine: MarineSnapshot;
  weather: WeatherSnapshot;
  typicalSpecies?: string[];
  recommendedTechniques: string[];
  bait: string[];
  castingAdvice: string;
  bestWindow: string;
  depthStyle: string;
  techniqueDepthRange: TechniqueDepthRange;
  depthSourceLabel: string;
  seabedLabel: string;
  snagRiskLabel: string;
  confidenceLabel: string;
  conditionsLabel: string;
  warnings: string[];
  breakdown: FactorScore[];
}

export interface ApproximateZone {
  bearingDeg: number;
  direction: string;
  distanceRangeM: [number, number];
  depthRangeM: [number, number];
  confidence: "low";
  actionable: false;
  label: string;
}

export interface PointAnalysis {
  requestedPoint: Coordinates;
  analyzedPoint: Coordinates;
  adjustedToWater: boolean;
  waterDistanceM: number;
  waterBearingDeg?: number;
  gpsAccuracyM?: number;
  waterFound?: boolean;
  requiresRelocation?: boolean;
  standingPointStatus?: "unverified" | "not-applicable";
  techniqueRangeM?: [number, number];
  spatialResolutionM?: number;
  approximateZone?: ApproximateZone;
}

export interface SpotsApiResponse {
  conditionsScope?: "regional" | "point";
  conditionsAt?: string;
  mode?: SpotSearchMode;
  scanId?: string;
  intent: SearchIntent;
  location: GeocodedLocation;
  generatedAt: string;
  resultLimit: number;
  candidateCount: number;
  cache: {
    hit: boolean;
    source: "new" | "server" | "browser";
    entries: number;
    maxAgeSeconds: number;
    ageSeconds?: number;
  };
  spots: RankedSpot[];
  pointAnalysis?: PointAnalysis;
  warnings: string[];
  attributions: string[];
}

export interface DataFetchResult<T> {
  data: T;
  warnings: string[];
}

export interface ApiUser {
  role: "admin" | "user";
  id: string;
  username: string;
  displayName: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TripFishRecord {
  id: string;
  species: string;
  count: number;
  weightKg?: number;
  lengthCm?: number;
  weightBasis?: "individual" | "total" | "average" | "unknown";
  lengthBasis?: "individual" | "average" | "unknown";
  bait?: string;
  released: boolean;
  notes?: string;
  images: TripMedia[];
}

export type TripVisibility = "private" | "public";
export type TripStatus = "active" | "completed";
export type RecordingMode = "live" | "historical";
export type TripOutcome = "not-recorded" | "zero" | "recorded";
export type PublicLocationPrecision = "approximate" | "exact";

export interface TripMedia {
  id: string;
  fishRecordId: string | null;
  originalName: string;
  mimeType: string;
  fileSize: number;
  width: number;
  height: number;
  url: string;
  thumbnailUrl: string;
  createdAt: string;
}

export interface SavedFishingTrip {
  recordingMode: RecordingMode;
  endedAt: string | null;
  outcome: TripOutcome;
  fishingMinutes: number | null;
  anglerCount: number | null;
  conditionsRecordedAt: string | null;
  publicLocationPrecision: PublicLocationPrecision;
  shareNotes: boolean;
  sharedMediaIds: string[];
  id: string;
  userId: string;
  username: string;
  displayName: string;
  visibility: TripVisibility;
  status: TripStatus;
  createdAt: string;
  updatedAt: string;
  tripDate: string;
  completedAt: string | null;
  technique: TechniqueId;
  techniqueLabel: string;
  locationName: string;
  lat: number;
  lon: number;
  spotId: string;
  score: number;
  fishCaught: string[];
  fishRecords: TripFishRecord[];
  fishRevision?: string;
  images: TripMedia[];
  notes: string;
  conditionsLabel: string;
  depthLabel: string;
  seabedLabel: string;
  weather: WeatherSnapshot;
  marine: MarineSnapshot;
}

export interface CreateTripInput {
  recordingMode: RecordingMode;
  endedAt: string | null;
  outcome: TripOutcome;
  fishingMinutes: number | null;
  anglerCount: number | null;
  conditionsRecordedAt: string | null;
  publicLocationPrecision: PublicLocationPrecision;
  shareNotes: boolean;
  sharedMediaIds: string[];
  tripDate: string;
  technique: TechniqueId;
  techniqueLabel: string;
  locationName: string;
  lat: number;
  lon: number;
  spotId?: string;
  score?: number;
  visibility: TripVisibility;
  fishRecords: TripFishRecord[];
  notes?: string;
  conditionsLabel?: string;
  depthLabel?: string;
  seabedLabel?: string;
  weather?: WeatherSnapshot;
  marine?: MarineSnapshot;
}

export interface UpdateTripInput {
  endedAt?: string | null;
  outcome?: TripOutcome;
  fishingMinutes?: number | null;
  anglerCount?: number | null;
  conditionsRecordedAt?: string | null;
  publicLocationPrecision?: PublicLocationPrecision;
  shareNotes?: boolean;
  sharedMediaIds?: string[];
  visibility?: TripVisibility;
  tripDate?: string;
  notes?: string;
  fishRecords?: TripFishRecord[];
  expectedFishRevision?: string;
  status?: "completed";
}

export interface StoredPlace {
  id: number;
  externalKey: string;
  name: string;
  category: SpotCategory | "custom";
  lat: number;
  lon: number;
  dataQuality: CandidateSpot["dataQuality"] | "custom";
  tags: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface ScanSummary {
  id: string;
  username?: string;
  query: string;
  technique: TechniqueId;
  locationLabel: string;
  lat: number;
  lon: number;
  radiusKm: number;
  resultLimit: number;
  resultCount: number;
  createdAt: string;
  mode?: SpotSearchMode;
}

export interface SavedPlace extends Coordinates {
  id: string;
  name: string;
  technique: TechniqueId;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedScan extends ScanSummary {
  response: SpotsApiResponse;
  request: Partial<SpotsApiRequest> & { query?: string };
}

export interface TripDestination extends Coordinates {
  name: string;
  technique: TechniqueId;
  spot?: RankedSpot;
  conditionsAt?: string;
}

export interface PersonalInsights {
  summary: {
    completedTrips: number;
    knownOutcomeTrips: number;
    fishCount: number;
    effortHours: number;
    anglerHours: number;
    effortTrips: number;
    catchPerAnglerHour: number | null;
  };
  groups: Array<{
    technique: TechniqueId;
    locationName: string;
    tripCount: number;
    knownOutcomeTrips: number;
    fishCount: number;
    effortTrips: number;
    anglerHours: number;
    catchPerAnglerHour: number | null;
  }>;
}
