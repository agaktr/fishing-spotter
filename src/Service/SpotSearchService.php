<?php

namespace App\Service;

use App\Exception\ApiException;
use Psr\Cache\CacheItemPoolInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

final class SpotSearchService
{
    private const PROFILES = [
        'surfcasting' => ['label' => 'Surfcasting', 'aliases' => ['surfcasting', 'surf casting', 'beach casting', 'casting', 'ψάρεμα παραλίας', 'παραλία'], 'depth' => [4, 12, 2, 18], 'waves' => [0.35, 1.25, 1.9], 'species' => ['τσιπούρα', 'λαβράκι', 'σαργός', 'κέφαλος', 'μελανούρι', 'σαλάχια'], 'bait' => ['σκουλήκι', 'καλαμάρι', 'γαρίδα', 'φιλέτο σαρδέλας', 'μύδι'], 'times' => ['σούρουπο', 'πρώτες ώρες νύχτας', 'ξημέρωμα'], 'advice' => 'Ξεκίνα στα 60-120μ και μετά μίκρυνε τη βολή αν τα ψάρια τρώνε στο πρώτο αυλάκι.', 'fit' => ['beach' => 98, 'bay' => 82, 'estuary' => 84, 'shoal' => 78, 'headland' => 58, 'breakwater' => 52, 'rocky' => 45, 'harbour' => 40, 'pier' => 62, 'reef' => 48, 'marina' => 25, 'fallback' => 55]],
        'spinning' => ['label' => 'Spinning', 'aliases' => ['spinning', 'lure fishing', 'lures', 'σπινινγκ', 'σπίνινγκ', 'τεχνητά'], 'depth' => [2, 15, 1, 28], 'waves' => [0.15, 0.9, 1.6], 'species' => ['λαβράκι', 'λούτσος', 'γοφάρι', 'λίτσα', 'παλαμίδα', 'ζαργάνα'], 'bait' => ['τεχνητά σε χρώματα αφρόψαρων', 'λευκές σιλικόνες', 'minnow τύπου σαρδέλας'], 'times' => ['ξημέρωμα', 'σούρουπο', 'δραστηριότητα αφρόψαρων'], 'advice' => 'Κάνε βολές βεντάλια πρώτα στα ρεύματα και μετά δούλεψε παράλληλα σε βράχια ή μώλους.', 'fit' => ['headland' => 95, 'rocky' => 92, 'breakwater' => 88, 'estuary' => 82, 'pier' => 75, 'reef' => 84, 'harbour' => 68, 'beach' => 62, 'bay' => 58, 'shoal' => 66, 'marina' => 42, 'fallback' => 55]],
        'shore-jigging' => ['label' => 'Shore Jigging', 'aliases' => ['shore jigging', 'shorejigging', 'jigging', 'τζιγκινγκ', 'τζίγκινγκ'], 'depth' => [10, 35, 5, 55], 'waves' => [0.1, 0.85, 1.45], 'species' => ['μαγιάτικο', 'παλαμίδα', 'συναγρίδα', 'λούτσος', 'γοφάρι'], 'bait' => ['metal jigs', 'jigs σε χρώματα αφρόψαρων', 'glow jigs'], 'times' => ['ανατολή', 'δύση', 'ζωντανό ρεύμα'], 'advice' => 'Προτίμησε βαθιά νερά στα 30-80μ από την ακτή και μέτρα το βύθισμα του jig για να βρεις τη ζώνη.', 'fit' => ['headland' => 98, 'rocky' => 94, 'breakwater' => 90, 'reef' => 88, 'pier' => 70, 'harbour' => 60, 'beach' => 35, 'bay' => 44, 'shoal' => 74, 'marina' => 28, 'fallback' => 50]],
        'eging' => ['label' => 'Eging', 'aliases' => ['eging', 'squid fishing', 'squid', 'egi', 'cuttlefish', 'καλαμάρια', 'σουπιές'], 'depth' => [3, 10, 1.5, 18], 'waves' => [0, 0.45, 0.9], 'species' => ['καλαμάρι', 'σουπιά', 'θράψαλο'], 'bait' => ['φυσικά χρώματα γαρίδας', 'πορτοκαλί/ροζ egi', 'glow egi τη νύχτα'], 'times' => ['νύχτα', 'σούρουπο', 'φωτισμένα λιμάνια'], 'advice' => 'Δούλεψε όρια φυκιάδας και γραμμές φωτός με παύσεις αρκετές ώστε το egi να πλησιάζει τον βυθό.', 'fit' => ['harbour' => 92, 'marina' => 86, 'pier' => 88, 'breakwater' => 86, 'rocky' => 76, 'reef' => 72, 'bay' => 70, 'beach' => 45, 'headland' => 70, 'shoal' => 60, 'fallback' => 54]],
        'bottom-fishing' => ['label' => 'Ψάρεμα Βυθού', 'aliases' => ['bottom fishing', 'bottom', 'ledgering', 'bait fishing', 'ψάρεμα βυθού', 'πατωτό', 'δολωτό'], 'depth' => [5, 22, 2, 40], 'waves' => [0, 0.9, 1.7], 'species' => ['τσιπούρα', 'σαργός', 'λυθρίνι', 'κέφαλος', 'χειλού'], 'bait' => ['γαρίδα', 'σκουλήκι', 'μύδι', 'καλαμάρι', 'σαρδέλα'], 'times' => ['ξημέρωμα', 'σούρουπο', 'νύχτα'], 'advice' => 'Κράτα πρώτα βυθό και μετά ελάφρυνε το μολύβι αν το ρεύμα αφήνει το δόλωμα να δουλεύει φυσικά.', 'fit' => ['pier' => 90, 'breakwater' => 88, 'harbour' => 82, 'beach' => 76, 'rocky' => 78, 'reef' => 80, 'bay' => 66, 'headland' => 72, 'marina' => 44, 'shoal' => 70, 'fallback' => 56]],
        'rock-fishing' => ['label' => 'Ψάρεμα στα Βράχια', 'aliases' => ['rock fishing', 'rockfishing', 'rocks', 'float fishing', 'βράχια', 'ψάρεμα στα βράχια', 'απίκο', 'φελλός'], 'depth' => [3, 18, 1, 35], 'waves' => [0, 0.65, 1.15], 'species' => ['χειλού', 'σαργός', 'τσιπούρα', 'σκορπίνα', 'ροφός', 'λαβράκι'], 'bait' => ['γαρίδα', 'μύδι', 'σκουλήκι', 'μικρό καβούρι'], 'times' => ['ήρεμα πρωινά', 'σούρουπο', 'καθαρό νερό'], 'advice' => 'Ψάρεψε πρώτα κοντά: ακμές βράχων, λωρίδες αφρού και αλλαγές βάθους στα 5-30μ.', 'fit' => ['rocky' => 98, 'headland' => 92, 'reef' => 86, 'breakwater' => 78, 'pier' => 72, 'harbour' => 62, 'beach' => 30, 'bay' => 52, 'shoal' => 62, 'fallback' => 50]],
        'boat-fishing' => ['label' => 'Ψάρεμα από Βάρκα', 'aliases' => ['boat fishing', 'boat', 'kayak', 'offshore', 'βάρκα', 'ψάρεμα από βάρκα', 'καγιάκ'], 'depth' => [15, 60, 8, 120], 'waves' => [0, 0.7, 1.2], 'species' => ['συναγρίδα', 'μαγιάτικο', 'ροφός', 'λυθρίνι', 'παλαμίδα', 'καλαμάρι'], 'bait' => ['ζωντανό', 'καλαμάρι', 'σαρδέλα', 'jigs', 'inchiku'], 'times' => ['στρωμένος καιρός', 'ανατολή', 'δομή επιβεβαιωμένη με βυθόμετρο'], 'advice' => 'Χρησιμοποίησε τον χάρτη μόνο για προγραμματισμό. Επιβεβαίωσε βάθος και ασφάλεια με ναυτικούς χάρτες και όργανα σκάφους.', 'fit' => ['reef' => 94, 'shoal' => 88, 'headland' => 78, 'rocky' => 76, 'harbour' => 62, 'marina' => 64, 'bay' => 58, 'breakwater' => 54, 'pier' => 45, 'beach' => 35, 'fallback' => 50]],
    ];

    private const DEPTHS = [
        'beach' => [2, 6, 12, 'gentle', 'sand', 'low'], 'harbour' => [4, 9, 18, 'moderate', 'harbour', 'medium'],
        'breakwater' => [5, 14, 26, 'moderate', 'mixed', 'high'], 'pier' => [4, 10, 20, 'moderate', 'mixed', 'medium'],
        'rocky' => [3, 12, 28, 'steep', 'rock', 'high'], 'reef' => [2, 8, 18, 'moderate', 'reef', 'high'],
        'shoal' => [1, 5, 12, 'gentle', 'mixed', 'medium'], 'headland' => [4, 16, 35, 'steep', 'rock', 'high'],
        'estuary' => [1, 5, 11, 'gentle', 'mud', 'low'], 'marina' => [3, 7, 14, 'flat', 'harbour', 'medium'],
        'bay' => [2, 7, 16, 'gentle', 'sand', 'low'], 'fallback' => [2, 7, 15, 'gentle', 'unknown', 'unknown'],
    ];

    private const CATEGORIES = ['beach', 'breakwater', 'rocky', 'bay', 'headland', 'pier', 'harbour', 'marina'];

    public function __construct(
        private readonly HttpClientInterface $http,
        private readonly CacheItemPoolInterface $spotCache,
        private readonly CacheItemPoolInterface $upstreamCache,
        private readonly string $nominatimEndpoint,
        private readonly string $overpassEndpoint,
        private readonly string $openTopoDataset,
    ) {
    }

    public function search(array $body): array
    {
        $query = trim((string) ($body['query'] ?? ''));
        $radius = min(60, max(1, is_numeric($body['radiusKm'] ?? null) ? (float) $body['radiusKm'] : 25));
        $limit = min(48, max(5, is_numeric($body['resultLimit'] ?? null) ? (int) round((float) $body['resultLimit']) : 24));
        $intent = $this->parseIntent($query, $radius, ($body['locationOnly'] ?? false) === true);
        $coordinates = $body['coordinates'] ?? null;
        if (is_array($coordinates)) {
            $lat = $this->coordinate($coordinates['lat'] ?? null, -90, 90);
            $lon = $this->coordinate($coordinates['lon'] ?? null, -180, 180);
            $location = ['lat' => $lat, 'lon' => $lon, 'displayName' => trim((string) ($body['locationLabel'] ?? '')) ?: 'Επιλεγμένο σημείο χάρτη'];
            $intent['confidence'] = max(0.95, $intent['confidence']);
        } else {
            if ($intent['locationText'] === '') {
                throw new ApiException('Δεν βρέθηκε τοποθεσία στην αναζήτηση.');
            }
            $location = $this->geocode($intent['locationText']);
        }

        $keyData = ['version' => 8, 'query' => mb_strtolower(preg_replace('/\s+/u', ' ', $query) ?? $query), 'radiusKm' => $radius, 'resultLimit' => $limit, 'locationOnly' => ($body['locationOnly'] ?? false) === true, 'coordinates' => $coordinates ? ['lat' => round($location['lat'], 5), 'lon' => round($location['lon'], 5)] : null];
        $cacheKey = 'spots_'.hash('sha256', json_encode($keyData, JSON_THROW_ON_ERROR));
        $cached = $this->spotCache->getItem($cacheKey);
        if ($cached->isHit()) {
            $response = $cached->get();
            $response['cache'] = ['hit' => true, 'source' => 'server', 'entries' => $this->cacheEntries(), 'maxAgeSeconds' => 3600, 'ageSeconds' => max(0, time() - ($response['_cachedAt'] ?? time()))];
            unset($response['_cachedAt']);

            return $response;
        }

        $candidates = $this->candidates($location, $radius, max($limit, min(96, $limit * 3)));
        $depthProfiles = $this->depthProfiles($candidates, $location);
        $conditions = $this->conditions($location);
        $spots = $this->rank($candidates, $intent, $conditions, $depthProfiles, $limit);
        $response = [
            'intent' => $intent,
            'location' => $location,
            'generatedAt' => gmdate('Y-m-d\TH:i:s.v\Z'),
            'resultLimit' => $limit,
            'candidateCount' => count($candidates),
            'cache' => ['hit' => false, 'source' => 'new', 'entries' => $this->cacheEntries(), 'maxAgeSeconds' => 3600, 'ageSeconds' => 0],
            'spots' => $spots,
            'warnings' => $conditions['warnings'],
            'attributions' => ['© OpenStreetMap contributors', 'Open-Meteo', 'OpenTopoData / GEBCO'],
        ];
        $cached->set([...$response, '_cachedAt' => time()]);
        $cached->expiresAfter(3600);
        $this->spotCache->save($cached);
        $this->registerCacheKey($cacheKey);
        $response['cache']['entries'] = $this->cacheEntries();

        return $response;
    }

    public function clear(): int
    {
        $count = $this->cacheEntries();
        $this->spotCache->clear();

        return $count;
    }

    private function parseIntent(string $query, float $radius, bool $locationOnly): array
    {
        $lower = mb_strtolower($query, 'UTF-8');
        $technique = 'surfcasting';
        if (!$locationOnly) {
            $aliases = [];
            foreach (self::PROFILES as $id => $profile) {
                foreach ($profile['aliases'] as $alias) {
                    $aliases[] = [$id, $alias];
                }
            }
            usort($aliases, static fn (array $a, array $b): int => mb_strlen($b[1]) <=> mb_strlen($a[1]));
            foreach ($aliases as [$id, $alias]) {
                if (str_contains($lower, mb_strtolower($alias, 'UTF-8'))) {
                    $technique = $id;
                    break;
                }
            }
        }
        $cleaned = $query;
        foreach (self::PROFILES as $profile) {
            foreach ($profile['aliases'] as $alias) {
                $cleaned = preg_replace('/(^|\s)'.preg_quote($alias, '/').'(?=\s|$)/iu', ' ', $cleaned) ?? $cleaned;
            }
        }
        $cleaned = preg_replace('/\b(near|around|in|at|for|spots|spot|best|fishing|fish|κοντά|κοντα|γύρω|γυρω|σε|στη|στο|στην|στον|για|ψάρεμα|ψαρεμα|ψάρια|ψαρια|καλύτερα|καλυτερα|σημεία|σημεια)\b/iu', ' ', $cleaned) ?? $cleaned;
        $location = trim(preg_replace('/\s+/u', ' ', $cleaned) ?? $cleaned);

        return ['raw' => $query, 'technique' => $technique, 'techniqueLabel' => self::PROFILES[$technique]['label'], 'locationText' => $location, 'radiusKm' => $radius, 'confidence' => $location !== '' ? ($technique === 'surfcasting' ? 0.7 : 0.9) : 0.35];
    }

    private function geocode(string $query): array
    {
        $key = 'geocode_'.hash('sha256', mb_strtolower($query));

        return $this->cachedUpstream($key, 604800, function () use ($query): array {
            try {
                $data = $this->http->request('GET', rtrim($this->nominatimEndpoint, '/').'/search', ['query' => ['q' => $query, 'format' => 'jsonv2', 'limit' => 1, 'addressdetails' => 1], 'headers' => ['Accept' => 'application/json', 'User-Agent' => 'FishingSpotter/1.0 Symfony'], 'timeout' => 10])->toArray(false);
                if (isset($data[0]['lat'], $data[0]['lon'])) {
                    $location = ['lat' => (float) $data[0]['lat'], 'lon' => (float) $data[0]['lon'], 'displayName' => $data[0]['display_name'] ?? $query];
                    if (!empty($data[0]['address']['country_code'])) {
                        $location['countryCode'] = $data[0]['address']['country_code'];
                    }

                    return $location;
                }
            } catch (\Throwable) {
            }
            try {
                $data = $this->http->request('GET', 'https://geocoding-api.open-meteo.com/v1/search', ['query' => ['name' => $query, 'count' => 1, 'language' => 'en', 'format' => 'json'], 'timeout' => 10])->toArray(false);
                $result = $data['results'][0] ?? null;
                if ($result) {
                    return ['lat' => (float) $result['latitude'], 'lon' => (float) $result['longitude'], 'displayName' => implode(', ', array_filter([$result['name'] ?? null, $result['admin1'] ?? null, $result['country'] ?? null])), 'countryCode' => $result['country_code'] ?? null];
                }
            } catch (\Throwable) {
            }
            throw new ApiException('Η τοποθεσία δεν βρέθηκε από τις υπηρεσίες γεωκωδικοποίησης.', 500);
        });
    }

    private function candidates(array $center, float $radiusKm, int $target): array
    {
        $candidates = [];
        $endpoint = trim($this->overpassEndpoint) ?: 'https://overpass.private.coffee/api/interpreter';
        $meters = (int) round($radiusKm * 1000);
        $query = sprintf('[out:json][timeout:20];(nwr(around:%d,%.6f,%.6f)["natural"~"beach|cape|bay|reef|shoal|rock|cliff"];nwr(around:%d,%.6f,%.6f)["man_made"~"pier|breakwater|groyne|quay|lighthouse"];nwr(around:%d,%.6f,%.6f)["leisure"="marina"];nwr(around:%d,%.6f,%.6f)["harbour"];);out center tags %d;', $meters, $center['lat'], $center['lon'], $meters, $center['lat'], $center['lon'], $meters, $center['lat'], $center['lon'], $meters, $center['lat'], $center['lon'], max(80, $target * 3));
        try {
            $data = $this->http->request('POST', $endpoint, ['body' => ['data' => $query], 'headers' => ['User-Agent' => 'FishingSpotter/1.0 Symfony'], 'timeout' => 24])->toArray(false);
            foreach ($data['elements'] ?? [] as $element) {
                $lat = $element['lat'] ?? $element['center']['lat'] ?? null;
                $lon = $element['lon'] ?? $element['center']['lon'] ?? null;
                if (!is_numeric($lat) || !is_numeric($lon)) {
                    continue;
                }
                $tags = is_array($element['tags'] ?? null) ? $element['tags'] : [];
                $category = $this->category($tags);
                $distance = $this->distance($center['lat'], $center['lon'], (float) $lat, (float) $lon);
                if ($distance > $radiusKm) {
                    continue;
                }
                $id = ($element['type'] ?? 'node').':'.($element['id'] ?? count($candidates));
                $candidates[$id] = ['id' => $id, 'osmType' => $element['type'] ?? 'node', 'osmId' => isset($element['id']) ? (int) $element['id'] : null, 'name' => $tags['name'] ?? $this->categoryName($category), 'category' => $category, 'lat' => (float) $lat, 'lon' => (float) $lon, 'distanceKm' => round($distance, 2), 'tags' => array_map('strval', $tags), 'access' => ['rating' => in_array($category, ['rocky', 'headland', 'reef'], true) ? 'hard' : 'moderate', 'notes' => []], 'dataQuality' => 'osm'];
            }
        } catch (\Throwable) {
        }
        $candidates = array_values($candidates);
        usort($candidates, static fn (array $a, array $b): int => $a['distanceKm'] <=> $b['distanceKm']);
        for ($i = count($candidates); $i < $target; ++$i) {
            $category = self::CATEGORIES[$i % count(self::CATEGORIES)];
            $distance = max(0.7, $radiusKm * (0.18 + (($i % 7) / 10)));
            $point = $this->destination($center['lat'], $center['lon'], $distance, (75 + $i * 37) % 360);
            $candidates[] = ['id' => 'fallback:'.round($point['lat'], 5).','.round($point['lon'], 5), 'osmType' => 'fallback', 'name' => $this->categoryName($category).' εκτίμησης '.($i + 1), 'category' => $category, 'lat' => $point['lat'], 'lon' => $point['lon'], 'distanceKm' => round($distance, 2), 'tags' => [], 'access' => ['rating' => in_array($category, ['rocky', 'headland'], true) ? 'hard' : 'moderate', 'notes' => ['Η πρόσβαση χρειάζεται επιτόπιο έλεγχο.']], 'dataQuality' => 'generated'];
        }

        return array_slice($candidates, 0, $target);
    }

    private function conditions(array $location): array
    {
        $weather = ['pressureTrend' => 'unknown', 'confidence' => 'none'];
        $marine = ['confidence' => 'none'];
        $warnings = [];
        try {
            $data = $this->http->request('GET', 'https://api.open-meteo.com/v1/forecast', ['query' => ['latitude' => $location['lat'], 'longitude' => $location['lon'], 'current' => 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,precipitation,weather_code,cloud_cover,visibility,is_day', 'timezone' => 'auto'], 'timeout' => 15])->toArray(false);
            $current = $data['current'] ?? [];
            $weather = ['airTemperatureC' => $current['temperature_2m'] ?? null, 'apparentTemperatureC' => $current['apparent_temperature'] ?? null, 'relativeHumidityPct' => $current['relative_humidity_2m'] ?? null, 'windSpeedKmh' => $current['wind_speed_10m'] ?? null, 'windDirectionDeg' => $current['wind_direction_10m'] ?? null, 'gustKmh' => $current['wind_gusts_10m'] ?? null, 'pressureHpa' => $current['pressure_msl'] ?? null, 'pressureTrend' => 'stable', 'precipitationMm' => $current['precipitation'] ?? null, 'weatherCode' => $current['weather_code'] ?? null, 'cloudCoverPct' => $current['cloud_cover'] ?? null, 'visibilityM' => $current['visibility'] ?? null, 'isDay' => isset($current['is_day']) ? (bool) $current['is_day'] : null, 'confidence' => 'medium'];
        } catch (\Throwable) {
            $warnings[] = 'Δεν ήταν διαθέσιμα τα τρέχοντα δεδομένα καιρού.';
        }
        try {
            $data = $this->http->request('GET', 'https://marine-api.open-meteo.com/v1/marine', ['query' => ['latitude' => $location['lat'], 'longitude' => $location['lon'], 'current' => 'wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature,ocean_current_velocity,ocean_current_direction,sea_level_height_msl', 'cell_selection' => 'sea', 'timezone' => 'auto'], 'timeout' => 15])->toArray(false);
            $current = $data['current'] ?? [];
            $marine = ['waveHeightM' => $current['wave_height'] ?? null, 'waveDirectionDeg' => $current['wave_direction'] ?? null, 'wavePeriodS' => $current['wave_period'] ?? null, 'swellHeightM' => $current['swell_wave_height'] ?? null, 'swellDirectionDeg' => $current['swell_wave_direction'] ?? null, 'swellPeriodS' => $current['swell_wave_period'] ?? null, 'seaSurfaceTemperatureC' => $current['sea_surface_temperature'] ?? null, 'currentSpeedKmh' => $current['ocean_current_velocity'] ?? null, 'currentDirectionDeg' => $current['ocean_current_direction'] ?? null, 'seaLevelMslM' => $current['sea_level_height_msl'] ?? null, 'confidence' => $current ? 'medium' : 'none'];
        } catch (\Throwable) {
            $warnings[] = 'Δεν ήταν διαθέσιμα τα τρέχοντα θαλάσσια δεδομένα.';
        }

        return ['weather' => array_filter($weather, static fn (mixed $value): bool => $value !== null), 'marine' => array_filter($marine, static fn (mixed $value): bool => $value !== null), 'warnings' => $warnings];
    }

    private function depthProfiles(array $candidates, array $center): array
    {
        $cacheKey = 'depth_'.hash('sha256', json_encode(array_map(static fn (array $candidate): array => [round($candidate['lat'], 5), round($candidate['lon'], 5)], $candidates), JSON_THROW_ON_ERROR));

        return $this->cachedUpstream($cacheKey, 604800, function () use ($candidates, $center): array {
            $samples = [];
            foreach ($candidates as $index => $candidate) {
                $bearing = $this->bearing($center['lat'], $center['lon'], $candidate['lat'], $candidate['lon']);
                if ($candidate['distanceKm'] < 0.1) {
                    $bearing = (75 + $index * 37) % 360;
                }
                foreach ([50, 100, 150] as $distanceM) {
                    $point = $this->destination($candidate['lat'], $candidate['lon'], $distanceM / 1000, $bearing);
                    $samples[] = ['spotId' => $candidate['id'], 'distanceM' => $distanceM, 'bearing' => $bearing, ...$point];
                }
            }

            $successfulBatches = 0;
            for ($offset = 0; $offset < count($samples); $offset += 90) {
                $batch = array_slice($samples, $offset, 90);
                try {
                    $payload = $this->http->request('POST', 'https://api.opentopodata.org/v1/'.rawurlencode($this->openTopoDataset), [
                        'json' => ['locations' => implode('|', array_map(static fn (array $sample): string => $sample['lat'].','.$sample['lon'], $batch)), 'interpolation' => 'bilinear'],
                        'headers' => ['Accept' => 'application/json'],
                        'timeout' => 22,
                    ])->toArray(false);
                    if (($payload['status'] ?? null) !== 'OK' || !is_array($payload['results'] ?? null)) {
                        continue;
                    }
                    foreach ($payload['results'] as $resultIndex => $result) {
                        if (isset($batch[$resultIndex]) && is_numeric($result['elevation'] ?? null)) {
                            $samples[$offset + $resultIndex]['elevation'] = (float) $result['elevation'];
                        }
                    }
                    ++$successfulBatches;
                } catch (\Throwable) {
                }
            }
            if ($successfulBatches === 0) {
                return [];
            }

            $grouped = [];
            foreach ($samples as $sample) {
                if (!isset($sample['elevation']) || $sample['elevation'] > 0) {
                    continue;
                }
                $sample['depthM'] = abs($sample['elevation']);
                $grouped[$sample['spotId']][] = $sample;
            }
            $profiles = [];
            foreach ($grouped as $spotId => $wetSamples) {
                if (count($wetSamples) < 2) {
                    continue;
                }
                usort($wetSamples, static fn (array $a, array $b): int => $a['distanceM'] <=> $b['distanceM']);
                $depths = array_column($wetSamples, 'depthM');
                sort($depths);
                $middle = intdiv(count($depths), 2);
                $casting = count($depths) % 2 ? $depths[$middle] : ($depths[$middle - 1] + $depths[$middle]) / 2;
                $range = max($depths) - min($depths);
                $slopeRatio = $range / max(1, max(array_column($wetSamples, 'distanceM')));
                $slope = $slopeRatio > 0.045 ? 'steep' : ($slopeRatio > 0.022 ? 'moderate' : ($slopeRatio > 0.008 ? 'gentle' : 'flat'));
                $profiles[$spotId] = [
                    'closest' => min($depths),
                    'casting' => $casting,
                    'max' => max($depths),
                    'slope' => $slope,
                    'bearing' => $wetSamples[0]['bearing'],
                    'points' => array_map(static fn (array $sample): array => ['distanceM' => $sample['distanceM'], 'depthM' => round($sample['depthM'], 1), 'lat' => $sample['lat'], 'lon' => $sample['lon'], 'confidence' => 'measured'], $wetSamples),
                ];
            }

            return $profiles;
        });
    }

    private function rank(array $candidates, array $intent, array $conditions, array $depthProfiles, int $limit): array
    {
        $profile = self::PROFILES[$intent['technique']];
        $spots = [];
        foreach ($candidates as $index => $candidate) {
            [$closest, $casting, $max, $slope, $seabed, $snag] = self::DEPTHS[$candidate['category']] ?? self::DEPTHS['fallback'];
            $measuredDepth = $depthProfiles[$candidate['id']] ?? null;
            if ($measuredDepth) {
                $closest = $measuredDepth['closest'];
                $casting = $measuredDepth['casting'];
                $max = $measuredDepth['max'];
                $slope = $measuredDepth['slope'];
            }
            $depthScore = $this->rangeScore($casting, $profile['depth']);
            $fitScore = $profile['fit'][$candidate['category']] ?? 55;
            $accessScore = ['easy' => 92, 'moderate' => 70, 'hard' => 42, 'restricted' => 18, 'unknown' => 55][$candidate['access']['rating']] ?? 55;
            $wave = $conditions['marine']['waveHeightM'] ?? null;
            $conditionScore = is_numeric($wave) ? $this->rangeScore((float) $wave, [$profile['waves'][0], $profile['waves'][1], 0, $profile['waves'][2]]) : 58;
            $score = (int) round($fitScore * 0.4 + $depthScore * 0.3 + $accessScore * 0.15 + $conditionScore * 0.15);
            $factor = ['steep' => 1.45, 'moderate' => 1.18, 'gentle' => 0.92, 'flat' => 0.72][$slope] ?? 0.9;
            $depthRange = $this->depthRange($casting, $profile);
            $conditionsLabel = $this->conditionsLabel($conditions);
            $spots[] = [...$candidate,
                'score' => $score,
                'summary' => sprintf('%s για %s: %s, περίπου %.0fμ βάθος στη ζώνη βολής.', $score >= 75 ? 'Πολύ καλή προοπτική' : ($score >= 60 ? 'Καλή προοπτική' : 'Μέτρια προοπτική'), $profile['label'], $this->categoryName($candidate['category']), $casting),
                'depth' => ['source' => $measuredDepth ? 'opentopodata-gebco2020' : 'estimated', 'hasNearbyWater' => true, 'isSpotInWater' => false, 'shoreDistanceM' => 0, 'waterBearingDeg' => $measuredDepth['bearing'] ?? (75 + $index * 37) % 360, 'closestFishableDepthM' => $closest, 'castingDepthM' => $casting, 'maxDepthM' => $max, 'castingProfile' => $measuredDepth['points'] ?? [['distanceM' => 50, 'depthM' => round(max(0.8, $casting * 0.5 * $factor), 1), 'confidence' => 'estimated'], ['distanceM' => 100, 'depthM' => round(max(0.8, $casting * $factor), 1), 'confidence' => 'estimated'], ['distanceM' => 150, 'depthM' => round(max(0.8, $casting * 1.5 * $factor), 1), 'confidence' => 'estimated']], 'slope' => $slope, 'seabedType' => $seabed, 'snagRisk' => $snag, 'style' => $this->depthStyle($slope), 'sampleCount' => 3, 'confidence' => $measuredDepth ? 'low' : 'low'],
                'marine' => $conditions['marine'], 'weather' => $conditions['weather'], 'likelyFish' => $profile['species'], 'recommendedTechniques' => [$profile['label']], 'bait' => $profile['bait'], 'castingAdvice' => $profile['advice'], 'bestWindow' => implode(', ', $profile['times']), 'depthStyle' => $this->depthStyle($slope), 'techniqueDepthRange' => $depthRange, 'depthSourceLabel' => $measuredDepth ? 'OpenTopoData / GEBCO 2020' : 'Εκτίμηση βάσει μορφολογίας και κατηγορίας σημείου', 'seabedLabel' => $this->seabedLabel($seabed), 'snagRiskLabel' => ['low' => 'χαμηλά', 'medium' => 'μέτρια', 'high' => 'υψηλά', 'unknown' => 'άγνωστα'][$snag], 'confidenceLabel' => $measuredDepth ? 'Δημόσια δείγματα GEBCO κατά μήκος της βολής' : ($candidate['dataQuality'] === 'osm' ? 'OSM σημείο με εκτιμώμενο βάθος' : 'Παράκτια εκτίμηση, χρειάζεται επιβεβαίωση'), 'conditionsLabel' => $conditionsLabel, 'warnings' => array_values(array_filter([$candidate['dataQuality'] === 'generated' ? 'Το σημείο είναι παράκτια εκτίμηση και όχι επιβεβαιωμένη θέση.' : null, $conditionScore < 35 ? 'Οι συνθήκες είναι έξω από το ασφαλές εύρος της τεχνικής.' : null])), 'breakdown' => [['key' => 'technique', 'label' => 'Καταλληλότητα τεχνικής', 'score' => $fitScore, 'weight' => 40, 'explanation' => 'Συνδυασμός τεχνικής και τύπου ακτής.'], ['key' => 'depth', 'label' => 'Βάθος', 'score' => $depthScore, 'weight' => 30, 'explanation' => $depthRange['label']], ['key' => 'access', 'label' => 'Πρόσβαση', 'score' => $accessScore, 'weight' => 15, 'explanation' => 'Εκτίμηση από τον τύπο σημείου.'], ['key' => 'conditions', 'label' => 'Συνθήκες', 'score' => $conditionScore, 'weight' => 15, 'explanation' => $conditionsLabel]],
            ];
        }
        usort($spots, static fn (array $a, array $b): int => $b['score'] <=> $a['score']);
        $spots = array_slice($spots, 0, $limit);
        foreach ($spots as $index => &$spot) {
            $spot['rank'] = $index + 1;
        }

        return $spots;
    }

    private function depthRange(float $value, array $profile): array
    {
        [$idealMin, $idealMax, $softMin, $softMax] = $profile['depth'];
        $status = $value < $softMin ? 'too-shallow' : ($value < $idealMin ? 'shallow' : ($value <= $idealMax ? 'ideal' : ($value <= $softMax ? 'deep' : 'too-deep')));
        $labels = ['ideal' => sprintf('%.0fμ: μέσα στο ιδανικό %.0f-%.0fμ για %s.', $value, $idealMin, $idealMax, $profile['label']), 'shallow' => sprintf('%.0fμ: λίγο ρηχότερα από το ιδανικό εύρος.', $value), 'deep' => sprintf('%.0fμ: βαθύτερα από το ιδανικό αλλά ψαρεύσιμα.', $value), 'too-shallow' => sprintf('%.0fμ: πολύ ρηχά για την τεχνική.', $value), 'too-deep' => sprintf('%.0fμ: πολύ βαθιά για την τεχνική.', $value)];

        return ['techniqueLabel' => $profile['label'], 'valueM' => $value, 'idealMinM' => $idealMin, 'idealMaxM' => $idealMax, 'softMinM' => $softMin, 'softMaxM' => $softMax, 'status' => $status, 'label' => $labels[$status]];
    }

    private function conditionsLabel(array $conditions): string
    {
        $weather = $conditions['weather'];
        $marine = $conditions['marine'];
        $parts = [];
        if (isset($weather['airTemperatureC'])) $parts[] = 'αέρας '.round($weather['airTemperatureC'], 1).'°C';
        if (isset($marine['seaSurfaceTemperatureC'])) $parts[] = 'θάλασσα '.round($marine['seaSurfaceTemperatureC'], 1).'°C';
        if (isset($weather['windSpeedKmh'])) $parts[] = 'άνεμος '.round($weather['windSpeedKmh']).'χλμ/ώρα';
        if (isset($marine['waveHeightM'])) $parts[] = 'κύμα '.round($marine['waveHeightM'], 1).'μ';
        if (isset($marine['currentSpeedKmh'])) $parts[] = 'ρεύμα '.round($marine['currentSpeedKmh'], 1).'χλμ/ώρα';
        if (isset($weather['pressureHpa'])) $parts[] = 'πίεση '.round($weather['pressureHpa']).'hPa';

        return $parts ? implode(' · ', $parts) : 'Δεν υπάρχουν διαθέσιμα ζωντανά δεδομένα συνθηκών.';
    }

    private function rangeScore(float $value, array $range): int
    {
        [$idealMin, $idealMax, $hardMin, $hardMax] = $range;
        if ($value >= $idealMin && $value <= $idealMax) return 95;
        if ($value < $hardMin || $value > $hardMax) return 18;
        if ($value < $idealMin) return (int) round(max(18, min(85, 35 + (($value - $hardMin) / max(0.001, $idealMin - $hardMin)) * 50)));

        return (int) round(max(18, min(85, 85 - (($value - $idealMax) / max(0.001, $hardMax - $idealMax)) * 55)));
    }

    private function category(array $tags): string
    {
        $natural = $tags['natural'] ?? '';
        $manMade = $tags['man_made'] ?? '';
        if (in_array($manMade, ['breakwater', 'groyne'], true)) return 'breakwater';
        if (in_array($manMade, ['pier', 'quay'], true)) return 'pier';
        if (($tags['leisure'] ?? '') === 'marina') return 'marina';
        if (isset($tags['harbour']) || in_array($natural, ['harbour'], true)) return 'harbour';
        if (in_array($natural, ['beach', 'sand', 'shingle'], true)) return 'beach';
        if ($natural === 'bay') return 'bay';
        if ($natural === 'reef') return 'reef';
        if ($natural === 'shoal') return 'shoal';
        if ($natural === 'cape') return 'headland';
        if (in_array($natural, ['rock', 'cliff'], true)) return 'rocky';

        return 'fallback';
    }

    private function categoryName(string $category): string
    {
        return ['beach' => 'Παραλία', 'harbour' => 'Λιμενικό σημείο', 'breakwater' => 'Κυματοθραύστης', 'pier' => 'Προβλήτα', 'rocky' => 'Βραχώδης ακτή', 'reef' => 'Ξέρα', 'shoal' => 'Ρηχό', 'headland' => 'Κάβος', 'estuary' => 'Εκβολή', 'marina' => 'Μαρίνα', 'bay' => 'Όρμος', 'fallback' => 'Παράκτιο σημείο'][$category] ?? 'Παράκτιο σημείο';
    }

    private function seabedLabel(string $type): string
    {
        return ['sand' => 'αμμώδης', 'mixed' => 'μικτός', 'rock' => 'βραχώδης', 'reef' => 'ύφαλος/βράχος', 'weed' => 'φυκιάδα', 'mud' => 'λασπώδης', 'harbour' => 'λιμενικός/τεχνητός', 'unknown' => 'άγνωστος'][$type] ?? 'άγνωστος';
    }

    private function depthStyle(string $slope): string
    {
        return ['flat' => 'σχεδόν επίπεδος βυθός', 'gentle' => 'ήπια κλίση', 'moderate' => 'μέτρια κλίση', 'steep' => 'απότομο κατέβασμα'][$slope] ?? 'άγνωστη μορφολογία';
    }

    private function coordinate(mixed $value, float $min, float $max): float
    {
        if (!is_numeric($value) || ($number = (float) $value) < $min || $number > $max) {
            throw new ApiException('Οι συντεταγμένες δεν είναι έγκυρες.');
        }

        return $number;
    }

    private function distance(float $lat1, float $lon1, float $lat2, float $lon2): float
    {
        $dLat = deg2rad($lat2 - $lat1);
        $dLon = deg2rad($lon2 - $lon1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLon / 2) ** 2;

        return 2 * 6371.0088 * asin(min(1, sqrt($a)));
    }

    private function destination(float $lat, float $lon, float $distanceKm, float $bearing): array
    {
        $angular = $distanceKm / 6371.0088;
        $bearing = deg2rad($bearing);
        $lat1 = deg2rad($lat);
        $lon1 = deg2rad($lon);
        $lat2 = asin(sin($lat1) * cos($angular) + cos($lat1) * sin($angular) * cos($bearing));
        $lon2 = $lon1 + atan2(sin($bearing) * sin($angular) * cos($lat1), cos($angular) - sin($lat1) * sin($lat2));

        return ['lat' => rad2deg($lat2), 'lon' => fmod(rad2deg($lon2) + 540, 360) - 180];
    }

    private function bearing(float $lat1, float $lon1, float $lat2, float $lon2): float
    {
        $lat1 = deg2rad($lat1);
        $lat2 = deg2rad($lat2);
        $deltaLon = deg2rad($lon2 - $lon1);
        $angle = rad2deg(atan2(sin($deltaLon) * cos($lat2), cos($lat1) * sin($lat2) - sin($lat1) * cos($lat2) * cos($deltaLon)));

        return fmod($angle + 360, 360);
    }

    private function cachedUpstream(string $key, int $ttl, callable $loader): mixed
    {
        $item = $this->upstreamCache->getItem($key);
        if ($item->isHit()) return $item->get();
        $value = $loader();
        $item->set($value);
        $item->expiresAfter($ttl);
        $this->upstreamCache->save($item);

        return $value;
    }

    private function registerCacheKey(string $key): void
    {
        $registry = $this->spotCache->getItem('_registry');
        $keys = $registry->isHit() && is_array($registry->get()) ? $registry->get() : [];
        $keys[$key] = time();
        $registry->set($keys);
        $registry->expiresAfter(3600);
        $this->spotCache->save($registry);
    }

    private function cacheEntries(): int
    {
        $registry = $this->spotCache->getItem('_registry');

        return $registry->isHit() && is_array($registry->get()) ? count($registry->get()) : 0;
    }
}
