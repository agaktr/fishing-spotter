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
  mode?: SpotSearchMode;
  query: string;
  coordinates?: Coordinates;
  locationLabel?: string;
  gpsAccuracyM?: number;
  resultLimit?: number;
  radiusKm?: number;
  locationOnly?: boolean;
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
  source: "opentopodata-gebco2020" | "estimated" | "unavailable";
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

export interface MarineSnapshot {
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

export interface WeatherSnapshot {
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
  rank: number;
  score: number;
  summary: string;
  depth: DepthProfile;
  marine: MarineSnapshot;
  weather: WeatherSnapshot;
  likelyFish: string[];
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

export interface CastRecommendation {
  bearingDeg: number;
  direction: string;
  distanceM: number;
  target: Coordinates;
  targetDepthM?: number;
  rationale: string;
  confidence: "high" | "medium" | "low" | "none";
}

export interface PointAnalysis {
  requestedPoint: Coordinates;
  analyzedPoint: Coordinates;
  adjustedToWater: boolean;
  waterDistanceM: number;
  waterBearingDeg?: number;
  gpsAccuracyM?: number;
  castRecommendation?: CastRecommendation;
}

export interface SpotsApiResponse {
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
  bait?: string;
  released: boolean;
  notes?: string;
}

export type TripVisibility = "private" | "public";

export interface SavedFishingTrip {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  visibility: TripVisibility;
  createdAt: string;
  updatedAt: string;
  tripDate: string;
  technique: TechniqueId;
  techniqueLabel: string;
  locationName: string;
  lat: number;
  lon: number;
  spotId: string;
  score: number;
  fishCaught: string[];
  fishRecords: TripFishRecord[];
  notes: string;
  conditionsLabel: string;
  depthLabel: string;
  seabedLabel: string;
  weather: WeatherSnapshot;
  marine: MarineSnapshot;
}

export interface CreateTripInput {
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
}
