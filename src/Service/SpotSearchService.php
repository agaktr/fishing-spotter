<?php

namespace App\Service;

use App\Exception\ApiException;
use Psr\Cache\CacheItemPoolInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

final class SpotSearchService
{
    private const POINT_BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];
    private const POINT_DISTANCES_M = [50, 80, 100, 150, 300, 650, 1200];
    private const NEARBY_BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];
    private const NEARBY_DISTANCES_M = [50, 100, 150, 200];
    private const MAX_COAST_DISTANCE_M = 200;

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

    public function __construct(
        private readonly HttpClientInterface $http,
        private readonly CacheItemPoolInterface $spotCache,
        private readonly CacheItemPoolInterface $upstreamCache,
        private readonly string $nominatimEndpoint,
        private readonly string $overpassEndpoint,
        private readonly string $openTopoDataset,
    ) {
    }

    public function search(array $body, bool $cachePointAnalysis = true): array
    {
        $mode = $body['mode'] ?? 'nearby';
        if (!is_string($mode) || !in_array($mode, ['nearby', 'point'], true)) {
            throw new ApiException('Ο τρόπος ανάλυσης δεν είναι έγκυρος.');
        }
        $query = trim((string) ($body['query'] ?? ''));
        $radius = min(60, max(1, is_numeric($body['radiusKm'] ?? null) ? (float) $body['radiusKm'] : 25));
        $limit = $mode === 'point' ? 1 : min(48, max(5, is_numeric($body['resultLimit'] ?? null) ? (int) round((float) $body['resultLimit']) : 24));
        $intent = $this->parseIntent($query, $radius, ($body['locationOnly'] ?? false) === true);
        $coordinates = $body['coordinates'] ?? null;
        if ($mode === 'point' && !is_array($coordinates)) {
            throw new ApiException('Οι συντεταγμένες είναι υποχρεωτικές για ανάλυση σημείου.');
        }
        $gpsAccuracyM = null;
        if (array_key_exists('gpsAccuracyM', $body)) {
            if (!is_numeric($body['gpsAccuracyM']) || (float) $body['gpsAccuracyM'] < 0) {
                throw new ApiException('Η ακρίβεια GPS δεν είναι έγκυρη.');
            }
            $gpsAccuracyM = (float) $body['gpsAccuracyM'];
        }
        if (is_array($coordinates)) {
            $lat = $this->coordinate($coordinates['lat'] ?? null, -90, 90);
            $lon = $this->coordinate($coordinates['lon'] ?? null, -180, 180);
            $location = ['lat' => $lat, 'lon' => $lon, 'displayName' => trim((string) ($body['locationLabel'] ?? '')) ?: 'Επιλεγμένο σημείο χάρτη'];
            $intent['confidence'] = max(0.95, $intent['confidence']);
            if ($mode === 'point') {
                $intent['locationText'] = $location['displayName'];
            }
        } else {
            if ($intent['locationText'] === '') {
                throw new ApiException('Δεν βρέθηκε τοποθεσία στην αναζήτηση.');
            }
            $location = $this->geocode($intent['locationText']);
        }

        $cacheEnabled = $mode !== 'point' || $cachePointAnalysis;
        $keyData = ['version' => 13, 'mode' => $mode, 'query' => mb_strtolower(preg_replace('/\s+/u', ' ', $query) ?? $query), 'radiusKm' => $radius, 'resultLimit' => $limit, 'locationOnly' => ($body['locationOnly'] ?? false) === true, 'coordinates' => $coordinates ? ['lat' => round($location['lat'], 6), 'lon' => round($location['lon'], 6)] : null, 'locationLabel' => $coordinates ? $location['displayName'] : null, 'gpsAccuracyM' => $gpsAccuracyM];
        $cacheKey = 'spots_'.hash('sha256', json_encode($keyData, JSON_THROW_ON_ERROR));
        $cached = null;
        if ($cacheEnabled) {
            $cached = $this->spotCache->getItem($cacheKey);
            if ($cached->isHit()) {
                $response = $cached->get();
                $response['cache'] = ['hit' => true, 'source' => 'server', 'entries' => $this->cacheEntries(), 'maxAgeSeconds' => 3600, 'ageSeconds' => max(0, time() - ($response['_cachedAt'] ?? time()))];
                unset($response['_cachedAt']);

                return $response;
            }
        }

        if ($mode === 'point') {
            $response = $this->analyzePoint($location, $intent, $gpsAccuracyM, $cacheEnabled);
        } else {
            $candidates = $this->candidates($location, $radius, max($limit, min(48, $limit * 2)));
            $depthProfiles = $this->depthProfiles($candidates);
            if ($candidates !== [] && $depthProfiles === []) {
                throw new ApiException('Η υπηρεσία βυθομετρίας δεν είναι προσωρινά διαθέσιμη.', 503);
            }
            $validatedCandidates = array_values(array_filter(
                $candidates,
                fn (array $candidate): bool => $this->isValidatedNearbyCandidate($depthProfiles[$candidate['id']] ?? null, $intent['technique']),
            ));
            $conditions = $this->conditions($location);
            $spots = $this->rank($validatedCandidates, $intent, $conditions, $depthProfiles, $limit);
            $warnings = $conditions['warnings'];
            if ($candidates === []) {
                $warnings[] = 'Δεν βρέθηκαν χαρτογραφημένα παράκτια σημεία στην επιλεγμένη ακτίνα.';
            } elseif (count($validatedCandidates) < count($candidates)) {
                $warnings[] = $intent['technique'] === 'boat-fishing'
                    ? sprintf('Απορρίφθηκαν %d σημεία χωρίς επιβεβαιωμένο νερό στην ακριβή θέση.', count($candidates) - count($validatedCandidates))
                    : sprintf('Απορρίφθηκαν %d σημεία χωρίς επιβεβαιωμένη ακτή εντός %dμ.', count($candidates) - count($validatedCandidates), self::MAX_COAST_DISTANCE_M);
            }
            if (count($spots) < $limit) {
                $warnings[] = sprintf('Εμφανίζονται μόνο %d επιβεβαιωμένα παράκτια σημεία αντί για %d.', count($spots), $limit);
            }
            $response = [
                'mode' => 'nearby',
                'intent' => $intent,
                'location' => $location,
                'generatedAt' => gmdate('Y-m-d\TH:i:s.v\Z'),
                'resultLimit' => $limit,
                'candidateCount' => count($validatedCandidates),
                'cache' => ['hit' => false, 'source' => 'new', 'entries' => $this->cacheEntries(), 'maxAgeSeconds' => 3600, 'ageSeconds' => 0],
                'spots' => $spots,
                'warnings' => $warnings,
                'attributions' => ['© OpenStreetMap contributors', 'Open-Meteo', 'OpenTopoData / GEBCO'],
            ];
        }
        if ($cached !== null) {
            $cached->set([...$response, '_cachedAt' => time()]);
            $cached->expiresAfter(3600);
            $this->spotCache->save($cached);
            $this->registerCacheKey($cacheKey);
            $response['cache']['entries'] = $this->cacheEntries();
        }

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
        $configuredEndpoint = trim($this->overpassEndpoint);
        $endpoints = array_values(array_unique(array_filter([
            $configuredEndpoint !== '' ? $configuredEndpoint : null,
            'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
            'https://overpass.private.coffee/api/interpreter',
        ])));
        $meters = (int) round($radiusKm * 1000);
        $query = sprintf('[out:json][timeout:20];(nwr(around:%d,%.6f,%.6f)["natural"~"beach|cape|bay|reef|shoal|rock|cliff"];nwr(around:%d,%.6f,%.6f)["man_made"~"pier|breakwater|groyne|quay|lighthouse"];nwr(around:%d,%.6f,%.6f)["leisure"="marina"];nwr(around:%d,%.6f,%.6f)["harbour"];);out center tags %d;', $meters, $center['lat'], $center['lon'], $meters, $center['lat'], $center['lon'], $meters, $center['lat'], $center['lon'], $meters, $center['lat'], $center['lon'], max(80, $target * 3));
        $overpassCache = $this->upstreamCache->getItem('overpass_v3_'.hash('sha256', $query));
        $data = $overpassCache->isHit() ? $overpassCache->get() : null;
        if (!is_array($data)) {
            foreach ($endpoints as $endpoint) {
                try {
                    $httpResponse = $this->http->request('POST', $endpoint, ['body' => ['data' => $query], 'headers' => ['User-Agent' => 'FishingSpotter/1.0 Symfony'], 'timeout' => 24]);
                    $response = $httpResponse->getStatusCode() === 200 ? $httpResponse->toArray(false) : null;
                    if (is_array($response) && is_array($response['elements'] ?? null) && empty($response['remark'])) {
                        $data = $response;
                        $overpassCache->set($data);
                        $overpassCache->expiresAfter(86400);
                        $this->upstreamCache->save($overpassCache);
                        break;
                    }
                } catch (\Throwable) {
                }
            }
        }
        if (!is_array($data)) {
            throw new ApiException('Η υπηρεσία χαρτογραφημένων σημείων δεν είναι προσωρινά διαθέσιμη.', 503);
        }
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
        $candidates = array_values($candidates);
        usort($candidates, static fn (array $a, array $b): int => $a['distanceKm'] <=> $b['distanceKm']);

        return array_slice($candidates, 0, $target);
    }

    private function analyzePoint(array $requested, array $intent, ?float $gpsAccuracyM, bool $cacheEnabled): array
    {
        $samples = [['distanceM' => 0, 'bearing' => null, 'lat' => $requested['lat'], 'lon' => $requested['lon']]];
        foreach (self::POINT_BEARINGS as $bearing) {
            foreach (self::POINT_DISTANCES_M as $distanceM) {
                $samples[] = ['distanceM' => $distanceM, 'bearing' => $bearing, ...$this->destination($requested['lat'], $requested['lon'], $distanceM / 1000, $bearing)];
            }
        }
        $depthCacheData = [
            'version' => 1,
            'algorithm' => 'point-8-bearings-7-distances-exact',
            'dataset' => $this->openTopoDataset,
            'interpolation' => 'bilinear',
            'bearings' => self::POINT_BEARINGS,
            'distancesM' => self::POINT_DISTANCES_M,
            'locations' => array_map(static fn (array $sample): array => [round($sample['lat'], 7), round($sample['lon'], 7)], $samples),
        ];
        $depthSamples = $cacheEnabled
            ? $this->cachedUpstream(
                'point_depth_'.hash('sha256', json_encode($depthCacheData, JSON_THROW_ON_ERROR)),
                604800,
                fn (): array => $this->sampleElevations($samples),
            )
            : $this->sampleElevations($samples);

        $measuredCount = count(array_filter($depthSamples, static fn (array $sample): bool => is_numeric($sample['elevation'] ?? null)));
        $exactSample = $depthSamples[0] ?? null;
        $exactIsWater = is_numeric($exactSample['elevation'] ?? null) ? (float) $exactSample['elevation'] < 0 : null;
        $wetSamples = [];
        foreach ($depthSamples as $sample) {
            if (is_numeric($sample['elevation'] ?? null) && (float) $sample['elevation'] < 0) {
                $wetSamples[] = [...$sample, 'depthM' => abs((float) $sample['elevation'])];
            }
        }
        usort($wetSamples, static fn (array $a, array $b): int => $a['distanceM'] <=> $b['distanceM'] ?: (($a['bearing'] ?? 0) <=> ($b['bearing'] ?? 0)));
        $waterSample = $exactIsWater === true ? $wetSamples[0] : ($wetSamples[0] ?? null);
        $waterFound = $waterSample !== null;
        $waterDistanceM = $waterFound ? (int) $waterSample['distanceM'] : 0;
        $waterBearing = $waterFound && $waterDistanceM > 0 ? (float) $waterSample['bearing'] : null;
        $analyzed = $waterFound ? ['lat' => $waterSample['lat'], 'lon' => $waterSample['lon']] : ['lat' => $requested['lat'], 'lon' => $requested['lon']];
        $conditions = $this->conditions($analyzed, $waterFound);
        $profile = self::PROFILES[$intent['technique']];
        $castChoice = $waterFound ? $this->choosePointCast($wetSamples, $profile) : null;
        $castRecommendation = $castChoice && $castChoice['suitable'] ? [
            'bearingDeg' => $castChoice['bearing'],
            'direction' => $this->compassDirection($castChoice['bearing']),
            'distanceM' => $castChoice['target']['distanceM'],
            'target' => ['lat' => $castChoice['target']['lat'], 'lon' => $castChoice['target']['lon']],
            'targetDepthM' => round($castChoice['target']['depthM'], 1),
            'rationale' => sprintf('Μετρημένο βάθος %.1fμ στα %dμ για %s%s.', $castChoice['target']['depthM'], $castChoice['target']['distanceM'], $profile['label'], $castChoice['deepening'] > 0.5 ? ', με χρήσιμη αύξηση βάθους στην ίδια κατεύθυνση' : ''),
            'confidence' => $castChoice['confidence'],
        ] : null;

        $pointWarnings = [];
        if ($measuredCount === 0) {
            $pointWarnings[] = 'Η δημόσια υπηρεσία βυθομετρίας δεν επέστρεψε μετρήσεις για το σημείο.';
        } elseif (!$waterFound) {
            $pointWarnings[] = 'Δεν εντοπίστηκε μετρημένο νερό στα δείγματα έως 1200μ από το ζητούμενο σημείο.';
        } elseif ($waterDistanceM > 150) {
            $pointWarnings[] = sprintf('Το πλησιέστερο μετρημένο νερό είναι στα %dμ, πέρα από τη συνήθη ζώνη βολής.', $waterDistanceM);
        } elseif ($castChoice === null) {
            $pointWarnings[] = 'Δεν υπάρχουν αρκετά μετρημένα υδάτινα δείγματα εντός 150μ για κατεύθυνση βολής.';
        } elseif (!$castChoice['suitable']) {
            $pointWarnings[] = sprintf('Τα μετρημένα βάθη εντός 150μ είναι έξω από το χρήσιμο εύρος %.1f-%.1fμ για %s.', $profile['depth'][2], $profile['depth'][3], $profile['label']);
        }
        $warnings = [...$conditions['warnings'], ...$pointWarnings];
        $depth = $this->pointDepthProfile($depthSamples, $wetSamples, $exactIsWater, $waterSample, $castChoice, $measuredCount);
        $depthValue = $depth['castingDepthM'] ?? $depth['closestFishableDepthM'] ?? null;
        $depthScore = $waterFound && is_numeric($depthValue) ? $this->rangeScore((float) $depthValue, $profile['depth']) : 0;
        $wave = $conditions['marine']['waveHeightM'] ?? null;
        $conditionScore = is_numeric($wave) ? $this->rangeScore((float) $wave, [$profile['waves'][0], $profile['waves'][1], 0, $profile['waves'][2]]) : 58;
        $techniqueScore = $profile['fit']['fallback'];
        $score = $waterFound ? (int) round($techniqueScore * 0.2 + $depthScore * 0.5 + $conditionScore * 0.3) : 0;
        $depthRange = is_numeric($depthValue) ? $this->depthRange((float) $depthValue, $profile) : $this->unavailableDepthRange($profile);
        $summary = !$waterFound
            ? 'Δεν ήταν διαθέσιμη επιβεβαιωμένη υδάτινη ανάλυση για το ζητούμενο σημείο.'
            : ($waterDistanceM === 0
                ? sprintf('Μετρημένη ανάλυση του επιλεγμένου υδάτινου σημείου για %s.', $profile['label'])
                : sprintf('Η ανάλυση έγινε στο πλησιέστερο μετρημένο νερό, %dμ από το ζητούμενο σημείο, για %s.', $waterDistanceM, $profile['label']));
        $spot = [
            'id' => sprintf('point:%.6f,%.6f', $requested['lat'], $requested['lon']),
            'osmType' => 'fallback',
            'name' => 'Ανάλυση επιλεγμένου σημείου',
            'category' => 'fallback',
            'lat' => $analyzed['lat'],
            'lon' => $analyzed['lon'],
            'distanceKm' => $waterDistanceM / 1000,
            'tags' => [],
            'access' => ['rating' => 'unknown', 'notes' => ['Η πρόσβαση δεν αξιολογείται στην ανάλυση μεμονωμένου σημείου.']],
            'dataQuality' => 'generated',
            'rank' => 1,
            'score' => $score,
            'summary' => $summary,
            'depth' => $depth,
            'marine' => $conditions['marine'],
            'weather' => $conditions['weather'],
            'likelyFish' => $waterFound ? $profile['species'] : [],
            'recommendedTechniques' => [$profile['label']],
            'bait' => $waterFound ? $profile['bait'] : [],
            'castingAdvice' => $castRecommendation['rationale'] ?? ($pointWarnings[0] ?? 'Δεν δίνεται κατεύθυνση βολής χωρίς κατάλληλο μετρημένο δείγμα.'),
            'bestWindow' => implode(', ', $profile['times']),
            'depthStyle' => $depth['style'],
            'techniqueDepthRange' => $depthRange,
            'depthSourceLabel' => $waterFound ? 'OpenTopoData / GEBCO 2020, μετρημένη κατεύθυνση' : 'Μη διαθέσιμο μετρημένο βάθος',
            'seabedLabel' => 'άγνωστος',
            'snagRiskLabel' => 'άγνωστα',
            'confidenceLabel' => $waterFound ? 'Δημόσια δείγματα GEBCO γύρω από το ακριβές σημείο' : 'Δεν βρέθηκε επιβεβαιωμένο υδάτινο δείγμα',
            'conditionsLabel' => $this->conditionsLabel($conditions),
            'warnings' => $pointWarnings,
            'breakdown' => [
                ['key' => 'technique', 'label' => 'Καταλληλότητα τεχνικής', 'score' => $techniqueScore, 'weight' => 20, 'explanation' => sprintf('Ουδέτερη αξιολόγηση %s χωρίς υπόθεση τύπου ακτής.', $profile['label'])],
                ['key' => 'depth', 'label' => 'Βάθος για την τεχνική', 'score' => $depthScore, 'weight' => 50, 'explanation' => $depthRange['label']],
                ['key' => 'conditions', 'label' => 'Θαλάσσιες συνθήκες', 'score' => $conditionScore, 'weight' => 30, 'explanation' => $this->conditionsLabel($conditions)],
            ],
        ];
        $pointAnalysis = [
            'requestedPoint' => ['lat' => $requested['lat'], 'lon' => $requested['lon']],
            'analyzedPoint' => $analyzed,
            'adjustedToWater' => $waterFound && $waterDistanceM > 0,
            'waterDistanceM' => $waterDistanceM,
        ];
        if ($waterBearing !== null) {
            $pointAnalysis['waterBearingDeg'] = $waterBearing;
        }
        if ($gpsAccuracyM !== null) {
            $pointAnalysis['gpsAccuracyM'] = $gpsAccuracyM;
        }
        if ($castRecommendation !== null) {
            $pointAnalysis['castRecommendation'] = $castRecommendation;
        }

        return [
            'mode' => 'point',
            'intent' => $intent,
            'location' => $requested,
            'generatedAt' => gmdate('Y-m-d\TH:i:s.v\Z'),
            'resultLimit' => 1,
            'candidateCount' => 1,
            'cache' => ['hit' => false, 'source' => 'new', 'entries' => $this->cacheEntries(), 'maxAgeSeconds' => $cacheEnabled ? 3600 : 0, 'ageSeconds' => 0],
            'spots' => [$spot],
            'warnings' => $warnings,
            'attributions' => ['Open-Meteo', 'OpenTopoData / GEBCO'],
            'pointAnalysis' => $pointAnalysis,
        ];
    }

    private function choosePointCast(array $wetSamples, array $profile): ?array
    {
        $groups = [];
        foreach ($wetSamples as $sample) {
            if ($sample['distanceM'] > 0 && $sample['distanceM'] <= 150 && $sample['bearing'] !== null) {
                $groups[(int) $sample['bearing']][] = $sample;
            }
        }
        $choices = [];
        foreach ($groups as $bearing => $samples) {
            usort($samples, static fn (array $a, array $b): int => $a['distanceM'] <=> $b['distanceM']);
            $targets = $samples;
            usort($targets, fn (array $a, array $b): int => $this->rangeScore($b['depthM'], $profile['depth']) <=> $this->rangeScore($a['depthM'], $profile['depth']) ?: $b['distanceM'] <=> $a['distanceM']);
            $target = $targets[0];
            $standardCount = count(array_filter($samples, static fn (array $sample): bool => in_array($sample['distanceM'], [50, 100, 150], true)));
            $averageDepthScore = array_sum(array_map(fn (array $sample): int => $this->rangeScore($sample['depthM'], $profile['depth']), $samples)) / count($samples);
            $deepening = end($samples)['depthM'] - $samples[0]['depthM'];
            $suitable = $target['depthM'] >= $profile['depth'][2] && $target['depthM'] <= $profile['depth'][3];
            $choices[] = [
                'bearing' => $bearing,
                'samples' => $samples,
                'target' => $target,
                'standardCount' => $standardCount,
                'deepening' => $deepening,
                'suitable' => $suitable,
                'score' => $averageDepthScore + count($samples) * 4 + $standardCount * 8 + max(-5, min(12, $deepening * 2)) + ($suitable ? 100 : 0),
                'confidence' => $standardCount === 3 && $deepening > 0.5 ? 'high' : (count($samples) >= 2 ? 'medium' : 'low'),
            ];
        }
        usort($choices, static fn (array $a, array $b): int => $b['score'] <=> $a['score'] ?: $b['standardCount'] <=> $a['standardCount']);

        return $choices[0] ?? null;
    }

    private function pointDepthProfile(array $samples, array $wetSamples, ?bool $exactIsWater, ?array $waterSample, ?array $castChoice, int $measuredCount): array
    {
        $profileBearing = $castChoice['bearing'] ?? (($waterSample['distanceM'] ?? 0) > 0 ? $waterSample['bearing'] : null);
        if ($profileBearing === null) {
            foreach ($wetSamples as $sample) {
                if ($sample['distanceM'] > 0) {
                    $profileBearing = $sample['bearing'];
                    break;
                }
            }
        }
        $castingProfile = [];
        if ($profileBearing !== null) {
            foreach ([50, 100, 150] as $distanceM) {
                $sample = null;
                foreach ($samples as $candidate) {
                    if ($candidate['distanceM'] === $distanceM && $candidate['bearing'] === $profileBearing) {
                        $sample = $candidate;
                        break;
                    }
                }
                if ($sample === null) {
                    continue;
                }
                $point = ['distanceM' => $distanceM, 'confidence' => 'none'];
                if (is_numeric($sample['elevation'] ?? null) && (float) $sample['elevation'] < 0) {
                    $point = [...$point, 'lat' => $sample['lat'], 'lon' => $sample['lon'], 'depthM' => round(abs((float) $sample['elevation']), 1), 'confidence' => 'measured'];
                }
                $castingProfile[] = $point;
            }
        }
        $profileWet = array_values(array_filter($wetSamples, static fn (array $sample): bool => $sample['distanceM'] === 0 || ($profileBearing !== null && $sample['bearing'] === $profileBearing)));
        $depths = array_column($profileWet, 'depthM');
        $slope = 'unknown';
        if (count($profileWet) >= 2) {
            $range = max($depths) - min($depths);
            $maxDistance = max(array_column($profileWet, 'distanceM'));
            $ratio = $range / max(1, $maxDistance);
            $slope = $ratio > 0.045 ? 'steep' : ($ratio > 0.022 ? 'moderate' : ($ratio > 0.008 ? 'gentle' : 'flat'));
        }
        $waterFound = $waterSample !== null;
        $depth = [
            'source' => $waterFound ? 'opentopodata-gebco2020' : 'unavailable',
            'hasNearbyWater' => $waterFound,
            'castingProfile' => $castingProfile,
            'slope' => $slope,
            'seabedType' => 'unknown',
            'snagRisk' => 'unknown',
            'style' => $waterFound ? $this->depthStyle($slope) : 'μη διαθέσιμο μετρημένο βάθος',
            'sampleCount' => $measuredCount,
            'confidence' => !$waterFound ? 'none' : (count($profileWet) >= 3 ? 'medium' : 'low'),
        ];
        if ($exactIsWater !== null) {
            $depth['isSpotInWater'] = $exactIsWater;
        }
        if ($waterFound) {
            $depth['shoreDistanceM'] = $waterSample['distanceM'];
            if ($profileBearing !== null) {
                $depth['waterBearingDeg'] = $profileBearing;
            }
            if ($depths !== []) {
                $depth['closestFishableDepthM'] = min($depths);
                $depth['maxDepthM'] = max($depths);
            }
            if ($castChoice !== null) {
                $depth['castingDepthM'] = $castChoice['target']['depthM'];
            }
        }

        return $depth;
    }

    private function unavailableDepthRange(array $profile): array
    {
        return ['techniqueLabel' => $profile['label'], 'idealMinM' => $profile['depth'][0], 'idealMaxM' => $profile['depth'][1], 'softMinM' => $profile['depth'][2], 'softMaxM' => $profile['depth'][3], 'status' => 'unknown', 'label' => 'Δεν υπάρχει μετρημένο υδάτινο βάθος για αξιολόγηση της τεχνικής.'];
    }

    private function compassDirection(float $bearing): string
    {
        $directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

        return $directions[(int) round($bearing / 45) % 8];
    }

    private function conditions(array $location, bool $includeMarine = true): array
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
        if ($includeMarine) {
            try {
                $data = $this->http->request('GET', 'https://marine-api.open-meteo.com/v1/marine', ['query' => ['latitude' => $location['lat'], 'longitude' => $location['lon'], 'current' => 'wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature,ocean_current_velocity,ocean_current_direction,sea_level_height_msl', 'cell_selection' => 'sea', 'timezone' => 'auto'], 'timeout' => 15])->toArray(false);
                $current = $data['current'] ?? [];
                $marine = ['waveHeightM' => $current['wave_height'] ?? null, 'waveDirectionDeg' => $current['wave_direction'] ?? null, 'wavePeriodS' => $current['wave_period'] ?? null, 'swellHeightM' => $current['swell_wave_height'] ?? null, 'swellDirectionDeg' => $current['swell_wave_direction'] ?? null, 'swellPeriodS' => $current['swell_wave_period'] ?? null, 'seaSurfaceTemperatureC' => $current['sea_surface_temperature'] ?? null, 'currentSpeedKmh' => $current['ocean_current_velocity'] ?? null, 'currentDirectionDeg' => $current['ocean_current_direction'] ?? null, 'seaLevelMslM' => $current['sea_level_height_msl'] ?? null, 'confidence' => $current ? 'medium' : 'none'];
            } catch (\Throwable) {
                $warnings[] = 'Δεν ήταν διαθέσιμα τα τρέχοντα θαλάσσια δεδομένα.';
            }
        }

        return ['weather' => array_filter($weather, static fn (mixed $value): bool => $value !== null), 'marine' => array_filter($marine, static fn (mixed $value): bool => $value !== null), 'warnings' => $warnings];
    }

    private function depthProfiles(array $candidates): array
    {
        if ($candidates === []) {
            return [];
        }
        $bearings = count($candidates) > 36 ? [0, 90, 180, 270] : self::NEARBY_BEARINGS;
        $cacheData = [
            'version' => 3,
            'dataset' => $this->openTopoDataset,
            'interpolation' => 'bilinear',
            'bearings' => $bearings,
            'distancesM' => self::NEARBY_DISTANCES_M,
            'locations' => array_map(static fn (array $candidate): array => [$candidate['id'], round($candidate['lat'], 6), round($candidate['lon'], 6)], $candidates),
        ];
        $cacheKey = 'depth_'.hash('sha256', json_encode($cacheData, JSON_THROW_ON_ERROR));

        $cached = $this->upstreamCache->getItem($cacheKey);
        if ($cached->isHit() && is_array($cached->get())) {
            return $cached->get();
        }
        $profiles = (function () use ($candidates, $bearings): array {
            $samples = [];
            foreach ($candidates as $candidate) {
                $samples[] = ['spotId' => $candidate['id'], 'distanceM' => 0, 'bearing' => null, 'lat' => $candidate['lat'], 'lon' => $candidate['lon']];
                foreach ($bearings as $bearing) {
                    foreach (self::NEARBY_DISTANCES_M as $distanceM) {
                        $point = $this->destination($candidate['lat'], $candidate['lon'], $distanceM / 1000, $bearing);
                        $samples[] = ['spotId' => $candidate['id'], 'distanceM' => $distanceM, 'bearing' => $bearing, ...$point];
                    }
                }
            }

            $samples = $this->sampleElevations($samples);
            if ($samples === []) {
                return [];
            }

            $grouped = [];
            foreach ($samples as $sample) {
                if (!is_numeric($sample['elevation'] ?? null)) {
                    continue;
                }
                $grouped[$sample['spotId']][] = $sample;
            }
            $profiles = [];
            foreach ($candidates as $candidate) {
                $spotId = $candidate['id'];
                $measuredSamples = $grouped[$spotId] ?? [];
                if ($measuredSamples === []) {
                    continue;
                }
                $wetSamples = [];
                $drySamples = [];
                $exactIsWater = null;
                foreach ($measuredSamples as $sample) {
                    $elevation = (float) $sample['elevation'];
                    if ($sample['distanceM'] === 0) {
                        $exactIsWater = $elevation < 0 ? true : ($elevation > 0 ? false : null);
                    }
                    if ($elevation < 0) {
                        $wetSamples[] = [...$sample, 'depthM' => abs($elevation)];
                    } elseif ($elevation > 0) {
                        $drySamples[] = $sample;
                    }
                }
                $waterDistanceM = $wetSamples === [] ? null : min(array_column($wetSamples, 'distanceM'));
                $landDistanceM = $drySamples === [] ? null : min(array_column($drySamples, 'distanceM'));
                $bearingGroups = [];
                foreach ($wetSamples as $sample) {
                    if ($sample['distanceM'] > 0 && $sample['bearing'] !== null) {
                        $bearingGroups[(int) $sample['bearing']][] = $sample;
                    }
                }
                $choices = [];
                foreach ($bearingGroups as $bearing => $bearingSamples) {
                    usort($bearingSamples, static fn (array $a, array $b): int => $a['distanceM'] <=> $b['distanceM']);
                    $choices[] = [
                        'bearing' => $bearing,
                        'samples' => $bearingSamples,
                        'score' => count($bearingSamples) * 100 + max(array_column($bearingSamples, 'depthM')) - min(array_column($bearingSamples, 'distanceM')) / 100,
                    ];
                }
                usort($choices, static fn (array $a, array $b): int => $b['score'] <=> $a['score']);
                $choice = $choices[0] ?? null;
                $profileSamples = $choice['samples'] ?? [];
                if ($exactIsWater === true) {
                    foreach ($wetSamples as $sample) {
                        if ($sample['distanceM'] === 0) {
                            array_unshift($profileSamples, $sample);
                            break;
                        }
                    }
                }
                $depths = array_column($profileSamples, 'depthM');
                sort($depths);
                $middle = intdiv(count($depths), 2);
                $casting = $depths === [] ? null : (count($depths) % 2 ? $depths[$middle] : ($depths[$middle - 1] + $depths[$middle]) / 2);
                $slope = 'unknown';
                if (count($profileSamples) >= 2) {
                    $range = max($depths) - min($depths);
                    $slopeRatio = $range / max(1, max(array_column($profileSamples, 'distanceM')));
                    $slope = $slopeRatio > 0.045 ? 'steep' : ($slopeRatio > 0.022 ? 'moderate' : ($slopeRatio > 0.008 ? 'gentle' : 'flat'));
                }
                $profiles[$spotId] = [
                    'hasNearbyWater' => $wetSamples !== [],
                    'exactIsWater' => $exactIsWater,
                    'waterDistanceM' => $waterDistanceM,
                    'landDistanceM' => $landDistanceM,
                    'closest' => $depths === [] ? null : min($depths),
                    'casting' => $casting,
                    'max' => $depths === [] ? null : max($depths),
                    'slope' => $slope,
                    'bearing' => $choice['bearing'] ?? null,
                    'points' => array_map(static fn (array $sample): array => ['distanceM' => $sample['distanceM'], 'depthM' => round($sample['depthM'], 1), 'lat' => $sample['lat'], 'lon' => $sample['lon'], 'confidence' => 'measured'], array_values(array_filter($profileSamples, static fn (array $sample): bool => $sample['distanceM'] > 0))),
                    'sampleCount' => count($measuredSamples),
                    'confidence' => count($profileSamples) >= 4 ? 'high' : (count($profileSamples) >= 2 ? 'medium' : 'low'),
                ];
            }

            return $profiles;
        })();
        if ($profiles !== []) {
            $cached->set($profiles);
            $cached->expiresAfter(604800);
            $this->upstreamCache->save($cached);
        }

        return $profiles;
    }

    private function isValidatedNearbyCandidate(?array $depth, string $technique): bool
    {
        if ($depth === null || !$depth['hasNearbyWater']) {
            return false;
        }
        if ($technique === 'boat-fishing') {
            return $depth['exactIsWater'] === true;
        }

        return is_numeric($depth['waterDistanceM'])
            && $depth['waterDistanceM'] <= self::MAX_COAST_DISTANCE_M
            && is_numeric($depth['landDistanceM'])
            && $depth['landDistanceM'] <= self::MAX_COAST_DISTANCE_M;
    }

    private function sampleElevations(array $samples): array
    {
        $successfulBatches = 0;
        $batchCount = (int) ceil(count($samples) / 90);
        $lastRequestAt = null;
        for ($offset = 0; $offset < count($samples); $offset += 90) {
            $batch = array_slice($samples, $offset, 90);
            try {
                if ($lastRequestAt !== null) {
                    $waitMicroseconds = (int) max(0, (1 - (microtime(true) - $lastRequestAt)) * 1_000_000);
                    if ($waitMicroseconds > 0) {
                        usleep($waitMicroseconds);
                    }
                }
                $lastRequestAt = microtime(true);
                $payload = $this->http->request('POST', 'https://api.opentopodata.org/v1/'.rawurlencode($this->openTopoDataset), [
                    'json' => ['locations' => implode('|', array_map(static fn (array $sample): string => $sample['lat'].','.$sample['lon'], $batch)), 'interpolation' => 'bilinear'],
                    'headers' => ['Accept' => 'application/json'],
                    'timeout' => 22,
                ])->toArray(false);
                if (($payload['status'] ?? null) !== 'OK' || !is_array($payload['results'] ?? null) || count($payload['results']) !== count($batch)) {
                    continue;
                }
                $complete = true;
                foreach ($payload['results'] as $resultIndex => $result) {
                    if (!isset($batch[$resultIndex]) || !is_numeric($result['elevation'] ?? null)) {
                        $complete = false;
                        break;
                    }
                    $samples[$offset + $resultIndex]['elevation'] = (float) $result['elevation'];
                }
                if (!$complete) {
                    continue;
                }
                ++$successfulBatches;
            } catch (\Throwable) {
            }
        }

        return $successfulBatches === $batchCount ? $samples : [];
    }

    private function rank(array $candidates, array $intent, array $conditions, array $depthProfiles, int $limit): array
    {
        $profile = self::PROFILES[$intent['technique']];
        $spots = [];
        foreach ($candidates as $candidate) {
            [$closest, $casting, $max, $slope, $seabed, $snag] = self::DEPTHS[$candidate['category']] ?? self::DEPTHS['fallback'];
            $measuredDepth = $depthProfiles[$candidate['id']] ?? null;
            if ($measuredDepth === null || !is_numeric($measuredDepth['casting'])) {
                continue;
            }
            $closest = $measuredDepth['closest'];
            $casting = $measuredDepth['casting'];
            $max = $measuredDepth['max'];
            $slope = $measuredDepth['slope'];
            $depthScore = $this->rangeScore($casting, $profile['depth']);
            $fitScore = $profile['fit'][$candidate['category']] ?? 55;
            $accessScore = ['easy' => 92, 'moderate' => 70, 'hard' => 42, 'restricted' => 18, 'unknown' => 55][$candidate['access']['rating']] ?? 55;
            $wave = $conditions['marine']['waveHeightM'] ?? null;
            $conditionScore = is_numeric($wave) ? $this->rangeScore((float) $wave, [$profile['waves'][0], $profile['waves'][1], 0, $profile['waves'][2]]) : 58;
            $score = (int) round($fitScore * 0.4 + $depthScore * 0.3 + $accessScore * 0.15 + $conditionScore * 0.15);
            $depthRange = $this->depthRange($casting, $profile);
            $conditionsLabel = $this->conditionsLabel($conditions);
            $depth = ['source' => 'opentopodata-gebco2020', 'hasNearbyWater' => true, 'shoreDistanceM' => $measuredDepth['waterDistanceM'], 'closestFishableDepthM' => $closest, 'castingDepthM' => $casting, 'maxDepthM' => $max, 'castingProfile' => $measuredDepth['points'], 'slope' => $slope, 'seabedType' => $seabed, 'snagRisk' => $snag, 'style' => $this->depthStyle($slope), 'sampleCount' => $measuredDepth['sampleCount'], 'confidence' => $measuredDepth['confidence']];
            if ($measuredDepth['exactIsWater'] !== null) {
                $depth['isSpotInWater'] = $measuredDepth['exactIsWater'];
            }
            if ($measuredDepth['bearing'] !== null) {
                $depth['waterBearingDeg'] = $measuredDepth['bearing'];
            }
            $spots[] = [...$candidate,
                'score' => $score,
                'summary' => sprintf('%s για %s: %s, περίπου %.0fμ βάθος στη ζώνη βολής.', $score >= 75 ? 'Πολύ καλή προοπτική' : ($score >= 60 ? 'Καλή προοπτική' : 'Μέτρια προοπτική'), $profile['label'], $this->categoryName($candidate['category']), $casting),
                'depth' => $depth,
                'marine' => $conditions['marine'], 'weather' => $conditions['weather'], 'likelyFish' => $profile['species'], 'recommendedTechniques' => [$profile['label']], 'bait' => $profile['bait'], 'castingAdvice' => $profile['advice'], 'bestWindow' => implode(', ', $profile['times']), 'depthStyle' => $this->depthStyle($slope), 'techniqueDepthRange' => $depthRange, 'depthSourceLabel' => 'OpenTopoData / GEBCO 2020', 'seabedLabel' => $this->seabedLabel($seabed), 'snagRiskLabel' => ['low' => 'χαμηλά', 'medium' => 'μέτρια', 'high' => 'υψηλά', 'unknown' => 'άγνωστα'][$snag], 'confidenceLabel' => 'Δημόσια δείγματα GEBCO γύρω από το χαρτογραφημένο σημείο', 'conditionsLabel' => $conditionsLabel, 'warnings' => array_values(array_filter([$conditionScore < 35 ? 'Οι συνθήκες είναι έξω από το ασφαλές εύρος της τεχνικής.' : null])), 'breakdown' => [['key' => 'technique', 'label' => 'Καταλληλότητα τεχνικής', 'score' => $fitScore, 'weight' => 40, 'explanation' => 'Συνδυασμός τεχνικής και τύπου ακτής.'], ['key' => 'depth', 'label' => 'Βάθος', 'score' => $depthScore, 'weight' => 30, 'explanation' => $depthRange['label']], ['key' => 'access', 'label' => 'Πρόσβαση', 'score' => $accessScore, 'weight' => 15, 'explanation' => 'Εκτίμηση από τον τύπο σημείου.'], ['key' => 'conditions', 'label' => 'Συνθήκες', 'score' => $conditionScore, 'weight' => 15, 'explanation' => $conditionsLabel]],
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
