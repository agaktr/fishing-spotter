<?php

namespace App\Service;

use App\Exception\ApiException;
use Psr\Cache\CacheItemPoolInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

final class SpotSearchService
{
    private const POINT_BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];
    private const POINT_DISTANCES_M = [5, 15, 30, 50, 80, 100, 150, 300, 650, 1200];
    private const NEARBY_BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];
    private const NEARBY_DISTANCES_M = [5, 15, 30, 50, 80, 100, 150, 200];
    private const MAX_COAST_DISTANCE_M = 200;
    private const EMODNET_GRID_DEGREES = 1 / 960;
    private const EMODNET_CONCURRENCY = 6;
    private const MAX_CANDIDATES = 48;
    private const SEARCH_TTL = 300;
    private const TECHNIQUE_RANGES_M = [
        'surfcasting' => [50, 150], 'spinning' => [20, 100], 'shore-jigging' => [30, 100],
        'eging' => [10, 80], 'bottom-fishing' => [20, 120], 'rock-fishing' => [5, 30],
        'boat-fishing' => [0, 1200],
    ];

    private const PROFILES = [
        'surfcasting' => ['label' => 'Surfcasting', 'aliases' => ['surfcasting', 'surf casting', 'beach casting', 'casting', 'ψάρεμα παραλίας', 'παραλία'], 'depth' => [4, 12, 2, 18], 'waves' => [0.35, 1.25, 1.9], 'species' => ['τσιπούρα', 'λαβράκι', 'σαργός', 'κέφαλος', 'μελανούρι', 'σαλάχια'], 'bait' => ['σκουλήκι', 'καλαμάρι', 'γαρίδα', 'φιλέτο σαρδέλας', 'μύδι'], 'times' => ['σούρουπο', 'πρώτες ώρες νύχτας', 'ξημέρωμα'], 'advice' => 'Ξεκίνα στα 60-120μ και μετά μίκρυνε τη βολή αν τα ψάρια τρώνε στο πρώτο αυλάκι.', 'fit' => ['beach' => 98, 'bay' => 82, 'estuary' => 84, 'shoal' => 78, 'headland' => 58, 'breakwater' => 52, 'rocky' => 45, 'harbour' => 40, 'pier' => 62, 'reef' => 48, 'marina' => 25, 'fallback' => 55]],
        'spinning' => ['label' => 'Spinning', 'aliases' => ['spinning', 'lure fishing', 'lures', 'σπινινγκ', 'σπίνινγκ', 'τεχνητά'], 'depth' => [2, 15, 1, 28], 'waves' => [0.15, 0.9, 1.6], 'species' => ['λαβράκι', 'λούτσος', 'γοφάρι', 'λίτσα', 'παλαμίδα', 'ζαργάνα'], 'bait' => ['τεχνητά σε χρώματα αφρόψαρων', 'λευκές σιλικόνες', 'minnow τύπου σαρδέλας'], 'times' => ['ξημέρωμα', 'σούρουπο', 'δραστηριότητα αφρόψαρων'], 'advice' => 'Κάνε βολές βεντάλια πρώτα στα ρεύματα και μετά δούλεψε παράλληλα σε βράχια ή μώλους.', 'fit' => ['headland' => 95, 'rocky' => 92, 'breakwater' => 88, 'estuary' => 82, 'pier' => 75, 'reef' => 84, 'harbour' => 68, 'beach' => 62, 'bay' => 58, 'shoal' => 66, 'marina' => 42, 'fallback' => 55]],
        'shore-jigging' => ['label' => 'Shore Jigging', 'aliases' => ['shore jigging', 'shorejigging', 'jigging', 'τζιγκινγκ', 'τζίγκινγκ'], 'depth' => [10, 35, 5, 55], 'waves' => [0.1, 0.85, 1.45], 'species' => ['μαγιάτικο', 'παλαμίδα', 'συναγρίδα', 'λούτσος', 'γοφάρι'], 'bait' => ['metal jigs', 'jigs σε χρώματα αφρόψαρων', 'glow jigs'], 'times' => ['ανατολή', 'δύση', 'ζωντανό ρεύμα'], 'advice' => 'Προτίμησε βαθιά νερά στα 30-80μ από την ακτή και μέτρα το βύθισμα του jig για να βρεις τη ζώνη.', 'fit' => ['headland' => 98, 'rocky' => 94, 'breakwater' => 90, 'reef' => 88, 'pier' => 70, 'harbour' => 60, 'beach' => 35, 'bay' => 44, 'shoal' => 74, 'marina' => 28, 'fallback' => 50]],
        'eging' => ['label' => 'Eging', 'aliases' => ['eging', 'squid fishing', 'squid', 'egi', 'cuttlefish', 'καλαμάρια', 'σουπιές'], 'depth' => [3, 10, 1.5, 18], 'waves' => [0, 0.45, 0.9], 'species' => ['καλαμάρι', 'σουπιά', 'θράψαλο'], 'bait' => ['φυσικά χρώματα γαρίδας', 'πορτοκαλί/ροζ egi', 'glow egi τη νύχτα'], 'times' => ['νύχτα', 'σούρουπο', 'φωτισμένα λιμάνια'], 'advice' => 'Δούλεψε όρια φυκιάδας και γραμμές φωτός με παύσεις αρκετές ώστε το egi να πλησιάζει τον βυθό.', 'fit' => ['harbour' => 92, 'marina' => 86, 'pier' => 88, 'breakwater' => 86, 'rocky' => 76, 'reef' => 72, 'bay' => 70, 'beach' => 45, 'headland' => 70, 'shoal' => 60, 'fallback' => 54]],
        'bottom-fishing' => ['label' => 'Ψάρεμα Βυθού', 'aliases' => ['bottom fishing', 'bottom', 'ledgering', 'bait fishing', 'ψάρεμα βυθού', 'πατωτό', 'δολωτό'], 'depth' => [5, 22, 2, 40], 'waves' => [0, 0.9, 1.7], 'species' => ['τσιπούρα', 'σαργός', 'λυθρίνι', 'κέφαλος', 'χειλού'], 'bait' => ['γαρίδα', 'σκουλήκι', 'μύδι', 'καλαμάρι', 'σαρδέλα'], 'times' => ['ξημέρωμα', 'σούρουπο', 'νύχτα'], 'advice' => 'Κράτα πρώτα βυθό και μετά ελάφρυνε το μολύβι αν το ρεύμα αφήνει το δόλωμα να δουλεύει φυσικά.', 'fit' => ['pier' => 90, 'breakwater' => 88, 'harbour' => 82, 'beach' => 76, 'rocky' => 78, 'reef' => 80, 'bay' => 66, 'headland' => 72, 'marina' => 44, 'shoal' => 70, 'fallback' => 56]],
        'rock-fishing' => ['label' => 'Ψάρεμα στα Βράχια', 'aliases' => ['rock fishing', 'rockfishing', 'rocks', 'float fishing', 'βράχια', 'ψάρεμα στα βράχια', 'απίκο', 'φελλός'], 'depth' => [3, 18, 1, 35], 'waves' => [0, 0.65, 1.15], 'species' => ['χειλού', 'σαργός', 'τσιπούρα', 'σκορπίνα', 'ροφός', 'λαβράκι'], 'bait' => ['γαρίδα', 'μύδι', 'σκουλήκι', 'μικρό καβούρι'], 'times' => ['ήρεμα πρωινά', 'σούρουπο', 'καθαρό νερό'], 'advice' => 'Ψάρεψε πρώτα κοντά: ακμές βράχων, λωρίδες αφρού και αλλαγές βάθους στα 5-30μ.', 'fit' => ['rocky' => 98, 'headland' => 92, 'reef' => 86, 'breakwater' => 78, 'pier' => 72, 'harbour' => 62, 'beach' => 30, 'bay' => 52, 'shoal' => 62, 'fallback' => 50]],
        'boat-fishing' => ['label' => 'Ψάρεμα από Βάρκα', 'aliases' => ['boat fishing', 'boat', 'kayak', 'offshore', 'βάρκα', 'ψάρεμα από βάρκα', 'καγιάκ'], 'depth' => [15, 60, 8, 120], 'waves' => [0, 0.7, 1.2], 'species' => ['συναγρίδα', 'μαγιάτικο', 'ροφός', 'λυθρίνι', 'παλαμίδα', 'καλαμάρι'], 'bait' => ['ζωντανό', 'καλαμάρι', 'σαρδέλα', 'jigs', 'inchiku'], 'times' => ['στρωμένος καιρός', 'ανατολή', 'δομή επιβεβαιωμένη με βυθόμετρο'], 'advice' => 'Χρησιμοποίησε τον χάρτη μόνο για προγραμματισμό. Επιβεβαίωσε βάθος και ασφάλεια με ναυτικούς χάρτες και όργανα σκάφους.', 'fit' => ['reef' => 94, 'shoal' => 88, 'headland' => 78, 'rocky' => 76, 'harbour' => 62, 'marina' => 64, 'bay' => 58, 'breakwater' => 54, 'pier' => 45, 'beach' => 35, 'fallback' => 50]],
    ];

    public function __construct(
        private readonly HttpClientInterface $http,
        private readonly CacheItemPoolInterface $spotCache,
        private readonly CacheItemPoolInterface $upstreamCache,
        private readonly string $nominatimEndpoint,
        private readonly string $overpassEndpoint,
        private readonly string $emodnetDepthEndpoint,
        private readonly string $emodnetDepthRelease,
    ) {
    }

    public function search(array $body, bool $cacheSearch = true): array
    {
        $mode = $body['mode'] ?? 'nearby';
        if (!is_string($mode) || !in_array($mode, ['nearby', 'point'], true)) {
            throw new ApiException('Ο τρόπος ανάλυσης δεν είναι έγκυρος.');
        }
        foreach (['radiusKm' => [1, 60], 'resultLimit' => [1, self::MAX_CANDIDATES]] as $field => [$min, $max]) {
            if (array_key_exists($field, $body) && (!is_numeric($body[$field]) || !is_finite((float) $body[$field]) || $body[$field] < $min || $body[$field] > $max || ($field === 'resultLimit' && (float) $body[$field] !== (float) (int) $body[$field]))) {
                throw new ApiException(sprintf('Το %s πρέπει να είναι %s από %d έως %d.', $field, $field === 'resultLimit' ? 'ακέραιος' : 'αριθμός', $min, $max));
            }
        }
        if (array_key_exists('saveHistory', $body) && !is_bool($body['saveHistory'])) {
            throw new ApiException('Το saveHistory πρέπει να είναι boolean.');
        }
        $cacheEnabled = $cacheSearch && ($body['saveHistory'] ?? true);
        $radius = (float) ($body['radiusKm'] ?? 25);
        $limit = $mode === 'point' ? 1 : (int) ($body['resultLimit'] ?? 24);
        $intent = $this->requestIntent($body, $radius);
        $coordinates = $body['coordinates'] ?? null;
        if ($coordinates !== null && !is_array($coordinates)) {
            throw new ApiException('Οι συντεταγμένες δεν είναι έγκυρες.');
        }
        if ($mode === 'point' && !is_array($coordinates)) {
            throw new ApiException('Οι συντεταγμένες είναι υποχρεωτικές για ανάλυση σημείου.');
        }
        $gpsAccuracyM = null;
        if (isset($body['gpsAccuracyM'])) {
            if (!is_numeric($body['gpsAccuracyM']) || !is_finite((float) $body['gpsAccuracyM']) || (float) $body['gpsAccuracyM'] < 0) {
                throw new ApiException('Η ακρίβεια GPS δεν είναι έγκυρη.');
            }
            $gpsAccuracyM = (float) $body['gpsAccuracyM'];
        }
        if (is_array($coordinates)) {
            $lat = $this->coordinate($coordinates['lat'] ?? null, -90, 90);
            $lon = $this->coordinate($coordinates['lon'] ?? null, -180, 180);
            if (isset($body['locationLabel']) && !is_string($body['locationLabel'])) {
                throw new ApiException('Η ετικέτα τοποθεσίας δεν είναι έγκυρη.');
            }
            $location = ['lat' => $lat, 'lon' => $lon, 'displayName' => trim($body['locationLabel'] ?? '') ?: ($intent['locationText'] ?: 'Επιλεγμένο σημείο χάρτη')];
            $intent['confidence'] = max(0.95, $intent['confidence']);
            if ($intent['locationText'] === '') {
                $intent['locationText'] = $location['displayName'];
            }
        } else {
            if ($intent['locationText'] === '') {
                throw new ApiException('Δεν βρέθηκε τοποθεσία στην αναζήτηση.');
            }
            $location = $this->geocode($intent['locationText'], $cacheEnabled);
        }

        $keyData = ['version' => 20, 'depthDataset' => 'emodnet-dtm-'.$this->emodnetDepthRelease, 'mode' => $mode, 'intent' => $intent, 'radiusKm' => $radius, 'resultLimit' => $limit, 'location' => $location, 'gpsAccuracyM' => $gpsAccuracyM];
        $cacheKey = 'spots_'.hash('sha256', json_encode($keyData, JSON_THROW_ON_ERROR));
        $cached = null;
        if ($cacheEnabled) {
            $cached = $this->spotCache->getItem($cacheKey);
            if ($cached->isHit()) {
                $response = $cached->get();
                $response['cache'] = [...$response['cache'], 'hit' => true, 'source' => 'server', 'entries' => $this->cacheEntries(), 'ageSeconds' => max(0, time() - $response['_cachedAt'])];
                unset($response['_cachedAt']);
                $response['warnings'][] = 'Αποθηκευμένη ανάλυση: ισχύουν οι αρχικές ώρες validAt/fetchedAt, όχι η ώρα ανάγνωσης.';

                return $response;
            }
        }

        if ($mode === 'point') {
            $response = $this->analyzePoint($location, $intent, $gpsAccuracyM, $cacheEnabled);
        } else {
            $candidates = $this->candidates($location, $radius, self::MAX_CANDIDATES);
            $allowedCandidates = array_values(array_filter($candidates, fn (array $candidate): bool => !$this->isRestricted($candidate['tags'])));
            $restrictedCount = count($candidates) - count($allowedCandidates);
            $depthProfiles = $this->depthProfiles($allowedCandidates, $intent['technique']);
            $validatedCandidates = array_values(array_filter(
                $allowedCandidates,
                fn (array $candidate): bool => $this->isValidatedNearbyCandidate($depthProfiles[$candidate['id']] ?? null, $intent['technique']),
            ));
            $conditions = $this->conditions($location, true, $intent['fishingAt'] ?? null, 'regional');
            $spots = $this->rank($validatedCandidates, $intent, $conditions, $depthProfiles, $limit);
            $unavailableCount = count(array_filter($allowedCandidates, static fn (array $candidate): bool => !($depthProfiles[$candidate['id']]['complete'] ?? false)));
            $rejectedCoastCount = count(array_filter($allowedCandidates, fn (array $candidate): bool => ($depthProfiles[$candidate['id']]['complete'] ?? false) && !$this->isValidatedNearbyCandidate($depthProfiles[$candidate['id']], $intent['technique'])));
            $warnings = [...$conditions['warnings'], 'Οι συνθήκες είναι περιφερειακές, όχι έλεγχος σε κάθε ακτή. Απαιτείται νέα ανάλυση στο επιλεγμένο σημείο πριν από τοπική αξιολόγηση.', 'Η μετάβαση ξηράς/νερού σε κελιά ~115μ δεν επιβεβαιώνει θέση στάσης ή διαδρομή πρόσβασης.'];
            if ($restrictedCount > 0) {
                $warnings[] = sprintf('Εξαιρέθηκαν %d σημεία με χαρτογραφημένο περιορισμό αλιείας ή πρόσβασης (OpenStreetMap).', $restrictedCount);
            }
            if ($unavailableCount > 0) {
                $warnings[] = sprintf('Ελλιπή ή μη διαθέσιμα δείγματα βυθομετρίας σε %d σημεία. Δεν συμπληρώνονται τεχνητά βάθη.', $unavailableCount);
            }
            if ($candidates === []) {
                $warnings[] = 'Δεν βρέθηκαν χαρτογραφημένα παράκτια σημεία στην επιλεγμένη ακτίνα.';
            } elseif ($rejectedCoastCount > 0) {
                $warnings[] = $intent['technique'] === 'boat-fishing'
                    ? sprintf('Απορρίφθηκαν %d σημεία χωρίς κελί νερού EMODnet στη θέση.', $rejectedCoastCount)
                    : sprintf('Απορρίφθηκαν %d σημεία χωρίς μετάβαση ξηράς/νερού EMODnet εντός %dμ.', $rejectedCoastCount, self::MAX_COAST_DISTANCE_M);
            }
            if (count($spots) < $limit) {
                $warnings[] = sprintf('Εμφανίζονται μόνο %d αξιολογημένες ζώνες αντί για %d, όχι κατ’ ανάγκη προτεινόμενα σημεία.', count($spots), $limit);
            }
            $warnings[] = 'Εξετάζονται έως 48 χαρτογραφημένα σημεία με 8 κατευθύνσεις ανά σημείο, ανεξάρτητα από το πλήθος αποτελεσμάτων. Η κάλυψη δεν είναι εξαντλητική.';
            $response = [
                'mode' => 'nearby',
                'intent' => $intent,
                'location' => $location,
                'generatedAt' => gmdate('Y-m-d\TH:i:s.v\Z'),
                'resultLimit' => $limit,
                'candidateCount' => count($validatedCandidates),
                'coverage' => ['assessedCount' => count($candidates), 'rejectedCount' => $restrictedCount + $rejectedCoastCount, 'restrictedCount' => $restrictedCount, 'unavailableCount' => $unavailableCount, 'returnedCount' => count($spots), 'assessmentLimit' => self::MAX_CANDIDATES, 'directionsPerCandidate' => 8],
                'conditionsScope' => $conditions['conditionsScope'],
                'conditionsAt' => $conditions['conditionsAt'],
                'temporalMode' => $conditions['temporalMode'],
                'cache' => ['hit' => false, 'source' => 'new', 'entries' => $cacheEnabled ? $this->cacheEntries() : 0, 'maxAgeSeconds' => 0, 'ageSeconds' => 0],
                'spots' => $spots,
                'warnings' => $warnings,
                'attributions' => ['© OpenStreetMap contributors', 'Open-Meteo', 'EMODnet Bathymetry Consortium ('.$this->emodnetDepthRelease.'), CC BY 4.0 · Not for navigation'],
            ];
        }
        $response['coverage']['recommendationCounts'] = array_replace(['eligible' => 0, 'caution' => 0, 'unsuitable' => 0, 'unverified' => 0], array_count_values(array_column($response['spots'], 'recommendationStatus')));
        $response['warnings'][] = 'Οι ετικέτες OpenStreetMap δεν αποτελούν νομική επιβεβαίωση. Άγνωστη πρόσβαση δεν σημαίνει άδεια αλιείας. Ελέγξτε τοπικούς κανόνες και σήμανση.';
        $response['warnings'][] = $intent['speciesLabel'];
        $response['warnings'] = array_values(array_unique($response['warnings']));
        $ttl = self::SEARCH_TTL;
        foreach ($response['spots'] as $spot) {
            if ($spot['conditionsStatus'] === 'unknown') {
                $ttl = 0;
            }
            if ($intent['temporalMode'] === 'current') {
                foreach (['weather', 'marine'] as $source) {
                    $ttl = min($ttl, max(0, ($this->providerTime($spot[$source]['validAt'] ?? null) ?? 0) + 3600 - time()));
                }
            }
        }
        if ($cached !== null && $response['spots'] !== [] && $response['coverage']['unavailableCount'] === 0 && $ttl > 0) {
            $response['cache']['maxAgeSeconds'] = $ttl;
            $cached->set([...$response, '_cachedAt' => time()]);
            $cached->expiresAfter($ttl);
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

    private function requestIntent(array $body, float $radius): array
    {
        // Only shipped query-only clients use the ambiguous free-text parser.
        $structured = array_key_exists('technique', $body) || array_key_exists('location', $body);
        if ($structured) {
            if (!array_key_exists('location', $body) && is_array($body['coordinates'] ?? null)) {
                $body['location'] = '';
            }
            if (!is_string($body['technique'] ?? null) || !isset(self::PROFILES[$body['technique']])) {
                throw new ApiException('Επιλέξτε μία από τις υποστηριζόμενες τεχνικές.');
            }
            if (!is_string($body['location'] ?? null)) {
                throw new ApiException('Η τοποθεσία πρέπει να δοθεί χωριστά ως κείμενο.');
            }
            $technique = $body['technique'];
            $location = trim($body['location']);
            $intent = ['raw' => self::PROFILES[$technique]['label'].' '.$location, 'technique' => $technique, 'techniqueLabel' => self::PROFILES[$technique]['label'], 'locationText' => $location, 'radiusKm' => $radius, 'confidence' => 1.0];
        } else {
            if (!is_string($body['query'] ?? '')) {
                throw new ApiException('Η παλαιού τύπου αναζήτηση πρέπει να είναι κείμενο.');
            }
            $intent = $this->parseIntent(trim($body['query'] ?? ''), $radius, ($body['locationOnly'] ?? false) === true);
        }
        $intent['inputMode'] = $structured ? 'structured' : 'legacy';
        $intent['temporalMode'] = 'current';
        $intent['speciesBasis'] = 'general-technique-compatibility';
        $intent['targetSpeciesCompatibility'] = 'not-requested';
        $intent['speciesLabel'] = 'Τα είδη είναι γενική συσχέτιση με την τεχνική, όχι πρόβλεψη παρουσίας, εποχικότητας ή πιθανότητας αλιεύματος.';
        if (isset($body['targetSpecies'])) {
            if (!is_string($body['targetSpecies']) || mb_strlen($body['targetSpecies']) > 100) {
                throw new ApiException('Το είδος-στόχος πρέπει να είναι σύντομο κείμενο.');
            }
            $species = trim($body['targetSpecies']);
            if ($species !== '') {
                $normalize = static fn (string $value): string => strtr(mb_strtolower(trim($value)), ['ά' => 'α', 'έ' => 'ε', 'ή' => 'η', 'ί' => 'ι', 'ό' => 'ο', 'ύ' => 'υ', 'ώ' => 'ω', 'ς' => 'σ']);
                $intent['targetSpecies'] = $species;
                $intent['targetSpeciesCompatibility'] = in_array($normalize($species), array_map($normalize, self::PROFILES[$intent['technique']]['species']), true) ? 'typical' : 'not-listed';
                if ($intent['targetSpeciesCompatibility'] === 'not-listed') {
                    $intent['speciesLabel'] .= ' Το επιλεγμένο είδος δεν περιλαμβάνεται στη γενική λίστα της τεχνικής· αυτό δεν αποδεικνύει απουσία του.';
                }
            }
        }
        if (isset($body['fishingAt'])) {
            $value = $body['fishingAt'];
            if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/D', $value) || ($timestamp = $this->providerTime($value)) === null) {
                throw new ApiException('Το fishingAt πρέπει να είναι έγκυρη ημερομηνία ISO 8601 σε UTC (Z ή +00:00).');
            }
            if ($timestamp < time() - 300 || $timestamp > time() + 7 * 86400) {
                throw new ApiException('Υποστηρίζονται μόνο τωρινές συνθήκες ή ωριαία πρόγνωση εντός των επόμενων 7 ημερών, όχι ιστορικές ή πιο μακρινές ημερομηνίες.');
            }
            $intent['fishingAt'] = gmdate('Y-m-d\TH:i:s\Z', $timestamp);
            $intent['temporalMode'] = 'forecast';
        }

        return $intent;
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

    private function geocode(string $query, bool $cacheSearch): array
    {
        $key = 'geocode_'.hash('sha256', mb_strtolower($query));

        $loader = function () use ($query): array {
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
        };

        return $cacheSearch ? $this->cachedUpstream($key, 604800, $loader) : $loader();
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
        $overpassCache = $this->upstreamCache->getItem('overpass_v4_'.hash('sha256', $query));
        $data = $overpassCache->isHit() ? $overpassCache->get() : null;
        if (!is_array($data)) {
            foreach ($endpoints as $endpoint) {
                try {
                    $httpResponse = $this->http->request('POST', $endpoint, ['body' => ['data' => $query], 'headers' => ['User-Agent' => 'FishingSpotter/1.0 Symfony'], 'timeout' => 24]);
                    $response = $httpResponse->getStatusCode() === 200 ? $httpResponse->toArray(false) : null;
                    if (is_array($response) && is_array($response['elements'] ?? null) && empty($response['remark'])) {
                        $data = $response;
                        if ($data['elements'] !== []) {
                            $overpassCache->set($data);
                            $overpassCache->expiresAfter(86400);
                            $this->upstreamCache->save($overpassCache);
                        }
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
            $candidates[$id] = ['id' => $id, 'osmType' => $element['type'] ?? 'node', 'osmId' => isset($element['id']) ? (int) $element['id'] : null, 'name' => $tags['name'] ?? $this->categoryName($category), 'category' => $category, 'lat' => (float) $lat, 'lon' => (float) $lon, 'distanceKm' => round($distance, 2), 'tags' => array_map('strval', $tags), 'access' => $this->accessSummary($tags), 'dataQuality' => 'osm'];
        }
        $candidates = array_values($candidates);
        usort($candidates, static fn (array $a, array $b): int => $a['distanceKm'] <=> $b['distanceKm'] ?: strcmp($a['id'], $b['id']));

        return array_slice($candidates, 0, $target);
    }

    private function isRestricted(array $tags): bool
    {
        foreach (['fishing', 'fishing:access', 'access', 'foot', 'fishing:conditional', 'access:conditional', 'foot:conditional'] as $key) {
            if (preg_match('/(?:^|[;\s])(no|private)(?:$|[;\s@])/i', trim((string) ($tags[$key] ?? '')))) {
                return true;
            }
        }

        return false;
    }

    private function accessSummary(array $tags): array
    {
        $allowed = ['yes', 'public', 'permissive', 'designated'];
        $permission = in_array(strtolower($tags['access'] ?? ''), $allowed, true) ? 'mapped-allowed' : 'unknown';
        $fishingPermission = in_array(strtolower($tags['fishing'] ?? ''), $allowed, true) ? 'mapped-allowed' : 'unknown';

        return [
            'rating' => $this->isRestricted($tags) ? 'restricted' : 'unknown',
            'permission' => $permission,
            'fishingPermission' => $fishingPermission,
            'standingPointStatus' => 'unverified',
            'source' => 'OpenStreetMap tags, not legal verification',
            'notes' => ['Η φυσική πρόσβαση και η θέση στάσης δεν έχουν ελεγχθεί.', $permission === 'unknown' || $fishingPermission === 'unknown' ? 'Άγνωστη άδεια πρόσβασης ή αλιείας· δεν τεκμαίρεται άδεια.' : 'Χαρτογραφημένη ένδειξη πρόσβασης/αλιείας, όχι επιβεβαίωση τοπικών κανόνων.'],
        ];
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
            'version' => 4,
            'algorithm' => 'point-8-bearings-native-cells',
            'dataset' => 'emodnet-dtm-'.$this->emodnetDepthRelease,
            'sampling' => 'native-cell-mean',
            'bearings' => self::POINT_BEARINGS,
            'distancesM' => self::POINT_DISTANCES_M,
            'locations' => array_map(static fn (array $sample): array => [round($sample['lat'], 7), round($sample['lon'], 7)], $samples),
        ];
        $depthCache = $this->upstreamCache->getItem('point_depth_'.hash('sha256', json_encode($depthCacheData, JSON_THROW_ON_ERROR)));
        $depthSamples = $depthCache->isHit() ? $depthCache->get() : $this->sampleElevations($samples);
        $availableSamples = array_values(array_filter($depthSamples, static fn (array $sample): bool => is_numeric($sample['elevation'] ?? null)));
        $complete = count($availableSamples) === count($samples);
        if (!$depthCache->isHit() && $complete) {
            $depthCache->set($depthSamples);
            $depthCache->expiresAfter(604800);
            $this->upstreamCache->save($depthCache);
        }
        $measuredCount = count(array_unique(array_column($availableSamples, 'cellId')));
        $exactSample = $depthSamples[0] ?? null;
        $exactIsWater = is_numeric($exactSample['elevation'] ?? null) && (float) $exactSample['elevation'] != 0 ? (float) $exactSample['elevation'] < 0 : null;
        $wetSamples = [];
        foreach ($depthSamples as $sample) {
            if (is_numeric($sample['elevation'] ?? null) && (float) $sample['elevation'] < 0) {
                $wetSamples[] = [...$sample, 'depthM' => abs((float) $sample['elevation'])];
            }
        }
        usort($wetSamples, static fn (array $a, array $b): int => $a['distanceM'] <=> $b['distanceM'] ?: (($a['bearing'] ?? 0) <=> ($b['bearing'] ?? 0)));
        $waterSample = $wetSamples[0] ?? null;
        $waterFound = $waterSample !== null;
        $waterDistanceM = $waterFound ? (int) $waterSample['distanceM'] : 0;
        $waterBearing = $waterFound && $waterDistanceM > 0 ? (float) $waterSample['bearing'] : null;
        $analyzed = $waterFound ? ['lat' => $waterSample['lat'], 'lon' => $waterSample['lon']] : ['lat' => $requested['lat'], 'lon' => $requested['lon']];
        $conditions = $this->conditions($analyzed, $waterFound, $intent['fishingAt'] ?? null);
        $profile = self::PROFILES[$intent['technique']];
        $range = self::TECHNIQUE_RANGES_M[$intent['technique']];
        $boat = $intent['technique'] === 'boat-fishing';
        $castChoice = $waterFound && !$boat ? $this->choosePointCast($depthSamples, $profile, $range) : null;
        $requiresRelocation = $boat ? $exactIsWater === false : ($exactIsWater === true || ($waterFound && $waterDistanceM > $range[1]));

        $pointWarnings = ['Κελιά DTM ~115μ: μόνο χονδρική εκτίμηση ζώνης, όχι ακριβής στόχος ή επαληθευμένη θέση στάσης.'];
        if ($waterFound && $waterDistanceM > 0) {
            $pointWarnings[] = sprintf('Η ανάλυση συνθηκών έγινε σε γειτονικό δείγμα νερού, %dμ από το ζητούμενο σημείο, όχι σε επιβεβαιωμένη θέση χρήστη.', $waterDistanceM);
        }
        if (!$complete) {
            $pointWarnings[] = sprintf('Διαθέσιμα %d από %d δείγματα αιτήματος (%d μοναδικά κελιά). Τα ελλιπή δεδομένα δεν αποθηκεύονται.', count($availableSamples), count($samples), $measuredCount);
        }
        if ($measuredCount === 0) {
            $pointWarnings[] = 'Η υπηρεσία EMODnet δεν επέστρεψε δείγματα DTM για το σημείο.';
        } elseif (!$waterFound) {
            $pointWarnings[] = 'Δεν εντοπίστηκε νερό στα δείγματα DTM έως 1200μ από το ζητούμενο σημείο.';
        } elseif (!$boat && $waterDistanceM > $range[1]) {
            $pointWarnings[] = sprintf('Το πλησιέστερο κελί νερού είναι στα %dμ, πέρα από τη γενική ζώνη %d-%dμ της τεχνικής.', $waterDistanceM, $range[0], $range[1]);
        } elseif (!$boat && $castChoice === null) {
            $pointWarnings[] = 'Δεν τεκμηριώνεται συνεχής υδάτινη διαδρομή δειγμάτων στη ζώνη της τεχνικής. Ξηρά ή άγνωστα ενδιάμεσα δείγματα αποκλείουν κατεύθυνση βολής.';
        } elseif ($castChoice !== null && !$castChoice['suitable']) {
            $pointWarnings[] = sprintf('Τα εκτιμώμενα βάθη στη ζώνη %d-%dμ είναι έξω από το χρήσιμο εύρος %.1f-%.1fμ για %s.', $range[0], $range[1], $profile['depth'][2], $profile['depth'][3], $profile['label']);
        }
        if (!$boat && $range[1] < 115) {
            $pointWarnings[] = sprintf('Η ζώνη %d-%dμ είναι μικρότερη από το κελί DTM ~115μ. Δεν επιλύεται αξιόπιστα κατεύθυνση ή απόσταση.', $range[0], $range[1]);
        }
        $depth = $this->pointDepthProfile($depthSamples, $wetSamples, $exactIsWater, $waterSample, $castChoice, $measuredCount, $range);
        $depth = [...$depth, 'complete' => $complete, 'availableSampleCount' => count($availableSamples), 'requestedSampleCount' => count($samples), 'spatialResolutionM' => 115, 'sampling' => 'native-cell-mean', 'techniqueRangeM' => $range];
        if ($availableSamples !== []) {
            $depth['fetchedAt'] = $availableSamples[0]['fetchedAt'];
        }
        $depthValue = $castChoice['target']['depthM'] ?? (($waterSample['distanceM'] ?? PHP_INT_MAX) <= $range[1] ? $waterSample['depthM'] : null);
        $depthScore = $waterFound && is_numeric($depthValue) ? $this->rangeScore((float) $depthValue, $profile['depth']) : 0;
        $wave = $conditions['marine']['waveHeightM'] ?? null;
        $conditionScore = is_numeric($wave) ? $this->rangeScore((float) $wave, [$profile['waves'][0], $profile['waves'][1], 0, $profile['waves'][2]]) : 0;
        $techniqueScore = $profile['fit']['fallback'];
        $score = $waterFound ? (int) round($techniqueScore * 0.2 + $depthScore * 0.5 + $conditionScore * 0.3) : 0;
        $depthRange = is_numeric($depthValue) ? $this->depthRange((float) $depthValue, $profile) : $this->unavailableDepthRange($profile);
        $spot = [
            'id' => sprintf('point:%.6f,%.6f', $requested['lat'], $requested['lon']),
            'osmType' => 'fallback',
            'name' => 'Ανάλυση επιλεγμένου σημείου',
            'category' => 'fallback',
            'lat' => $analyzed['lat'],
            'lon' => $analyzed['lon'],
            'distanceKm' => $waterDistanceM / 1000,
            'tags' => [],
            'access' => [...$this->accessSummary([]), 'source' => 'unverified-point', 'standingPointStatus' => $boat ? 'not-applicable' : 'unverified'],
            'dataQuality' => 'generated',
            'rank' => 1,
            'score' => $score,
            'depth' => $depth,
            'marine' => $conditions['marine'],
            'weather' => $conditions['weather'],
            'depthStyle' => $depth['style'],
            'techniqueDepthRange' => $depthRange,
            'depthSourceLabel' => $waterFound ? 'EMODnet DTM '.$this->emodnetDepthRelease.', μέση τιμή κελιού ~115μ' : 'Μη διαθέσιμη εκτίμηση βάθους',
            'seabedLabel' => 'άγνωστος',
            'snagRiskLabel' => 'άγνωστα',
            'confidenceLabel' => $waterFound ? 'Κάλυψη δειγμάτων EMODnet γύρω από το σημείο, όχι μέτρηση βυθομέτρου' : 'Δεν βρέθηκε υδάτινο δείγμα DTM',
            'conditionsLabel' => $this->conditionsLabel($conditions),
            'warnings' => $pointWarnings,
            'breakdown' => [
                ['key' => 'technique', 'label' => 'Καταλληλότητα τεχνικής', 'score' => $techniqueScore, 'weight' => 20, 'explanation' => sprintf('Ουδέτερη αξιολόγηση %s χωρίς υπόθεση τύπου ακτής.', $profile['label'])],
                ['key' => 'depth', 'label' => 'Βάθος για την τεχνική', 'score' => $depthScore, 'weight' => 50, 'explanation' => $depthRange['label']],
                ['key' => 'conditions', 'label' => 'Θαλάσσιες συνθήκες', 'score' => $conditionScore, 'weight' => 30, 'explanation' => $this->conditionsLabel($conditions)],
            ],
        ];
        $spot = $this->applySuitability($spot, $intent, $conditions, $requiresRelocation, $gpsAccuracyM);
        $pointAnalysis = [
            'requestedPoint' => ['lat' => $requested['lat'], 'lon' => $requested['lon']],
            'analyzedPoint' => $analyzed,
            'adjustedToWater' => $waterFound && $waterDistanceM > 0,
            'waterDistanceM' => $waterDistanceM,
            'waterFound' => $waterFound,
            'requiresRelocation' => $requiresRelocation,
            'standingPointStatus' => $boat ? 'not-applicable' : 'unverified',
            'techniqueRangeM' => $range,
            'spatialResolutionM' => 115,
        ];
        if ($waterBearing !== null) {
            $pointAnalysis['waterBearingDeg'] = $waterBearing;
        }
        if ($gpsAccuracyM !== null) {
            $pointAnalysis['gpsAccuracyM'] = $gpsAccuracyM;
        }
        // An informational zone is not a casting instruction; standing/access remain unverified.
        if ($castChoice !== null && $castChoice['suitable'] && !$castChoice['pathBlocked'] && !$requiresRelocation && $complete && $spot['conditionsStatus'] === 'no-adverse-signal' && ($gpsAccuracyM ?? 0) <= 30 && $range[1] >= 115) {
            $pointAnalysis['approximateZone'] = ['bearingDeg' => $castChoice['bearing'], 'direction' => $this->compassDirection($castChoice['bearing']), 'distanceRangeM' => $range, 'depthRangeM' => [min(array_column($castChoice['samples'], 'depthM')), max(array_column($castChoice['samples'], 'depthM'))], 'confidence' => 'low', 'actionable' => false, 'label' => 'Χονδρική ζώνη μοντέλου, όχι στόχος βολής. Απαιτείται επιτόπιος έλεγχος.'];
        }

        return [
            'mode' => 'point',
            'intent' => $intent,
            'location' => $requested,
            'generatedAt' => gmdate('Y-m-d\TH:i:s.v\Z'),
            'resultLimit' => 1,
            'candidateCount' => 1,
            'coverage' => ['assessedCount' => 1, 'rejectedCount' => 0, 'restrictedCount' => 0, 'unavailableCount' => $complete ? 0 : 1, 'returnedCount' => 1, 'assessmentLimit' => 1, 'directionsPerCandidate' => 8],
            'conditionsScope' => $conditions['conditionsScope'],
            'conditionsAt' => $conditions['conditionsAt'],
            'temporalMode' => $conditions['temporalMode'],
            'cache' => ['hit' => false, 'source' => 'new', 'entries' => $cacheEnabled ? $this->cacheEntries() : 0, 'maxAgeSeconds' => 0, 'ageSeconds' => 0],
            'spots' => [$spot],
            'warnings' => $spot['warnings'],
            'attributions' => ['Open-Meteo', 'EMODnet Bathymetry Consortium ('.$this->emodnetDepthRelease.'), CC BY 4.0 · Not for navigation'],
            'pointAnalysis' => $pointAnalysis,
        ];
    }

    private function choosePointCast(array $allSamples, array $profile, array $range): ?array
    {
        $groups = [];
        foreach ($allSamples as $sample) {
            if ($sample['distanceM'] > 0 && $sample['distanceM'] <= $range[1] && $sample['bearing'] !== null) {
                $groups[(int) $sample['bearing']][] = $sample;
            }
        }
        $choices = [];
        foreach ($groups as $bearing => $samples) {
            usort($samples, static fn (array $a, array $b): int => $a['distanceM'] <=> $b['distanceM']);
            $wet = [];
            $pathBlocked = false;
            foreach ($samples as $sample) {
                if (!is_numeric($sample['elevation'] ?? null) || $sample['elevation'] >= 0) {
                    $pathBlocked = true;
                    break;
                }
                if ($sample['distanceM'] >= $range[0]) {
                    $wet[$sample['cellId']] = [...$sample, 'depthM' => abs((float) $sample['elevation'])];
                }
            }
            $samples = array_values($wet);
            if ($samples === []) {
                continue;
            }
            $targets = $samples;
            usort($targets, fn (array $a, array $b): int => $this->rangeScore($b['depthM'], $profile['depth']) <=> $this->rangeScore($a['depthM'], $profile['depth']) ?: $b['distanceM'] <=> $a['distanceM']);
            $target = $targets[0];
            $averageDepthScore = array_sum(array_map(fn (array $sample): int => $this->rangeScore($sample['depthM'], $profile['depth']), $samples)) / count($samples);
            $suitable = $target['depthM'] >= $profile['depth'][2] && $target['depthM'] <= $profile['depth'][3];
            $choices[] = [
                'bearing' => $bearing,
                'samples' => $samples,
                'target' => $target,
                'suitable' => $suitable,
                'pathBlocked' => $pathBlocked,
                'score' => $averageDepthScore + count($samples) * 4 + ($suitable ? 100 : 0),
                'confidence' => 'low',
            ];
        }
        usort($choices, static fn (array $a, array $b): int => $b['score'] <=> $a['score'] ?: $a['bearing'] <=> $b['bearing']);

        return $choices[0] ?? null;
    }

    private function pointDepthProfile(array $samples, array $wetSamples, ?bool $exactIsWater, ?array $waterSample, ?array $castChoice, int $measuredCount, array $range): array
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
            foreach (array_filter(self::POINT_DISTANCES_M, static fn (int $distance): bool => $distance >= $range[0] && $distance <= $range[1]) as $distanceM) {
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
                    $point = [...$point, 'lat' => $sample['lat'], 'lon' => $sample['lon'], 'depthM' => abs((float) $sample['elevation']), 'cellId' => $sample['cellId'], 'confidence' => 'estimated'];
                }
                $castingProfile[$sample['cellId'] ?? 'unavailable:'.$distanceM] = $point;
            }
        }
        $profileWet = array_values(array_column(array_filter($wetSamples, static fn (array $sample): bool => $sample['distanceM'] === 0 || ($sample['distanceM'] >= $range[0] && $sample['distanceM'] <= $range[1] && $profileBearing !== null && $sample['bearing'] === $profileBearing)), null, 'cellId'));
        $depths = array_column($profileWet, 'depthM');
        $slope = 'unknown';
        if (count($profileWet) >= 2) {
            $depthSpan = max($depths) - min($depths);
            $maxDistance = max(array_column($profileWet, 'distanceM'));
            $ratio = $depthSpan / max(1, $maxDistance);
            $slope = $ratio > 0.045 ? 'steep' : ($ratio > 0.022 ? 'moderate' : ($ratio > 0.008 ? 'gentle' : 'flat'));
        }
        $waterFound = $waterSample !== null;
        $depth = [
            'source' => $waterFound ? 'emodnet-dtm-'.$this->emodnetDepthRelease : 'unavailable',
            'hasNearbyWater' => $waterFound,
            'castingProfile' => array_values($castingProfile),
            'slope' => $slope,
            'seabedType' => 'unknown',
            'snagRisk' => 'unknown',
            'style' => $waterFound ? $this->depthStyle($slope) : 'μη διαθέσιμη εκτίμηση βάθους',
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
        return ['techniqueLabel' => $profile['label'], 'idealMinM' => $profile['depth'][0], 'idealMaxM' => $profile['depth'][1], 'softMinM' => $profile['depth'][2], 'softMaxM' => $profile['depth'][3], 'status' => 'unknown', 'label' => 'Δεν υπάρχει διαθέσιμη εκτίμηση υδάτινου βάθους για αξιολόγηση της τεχνικής.'];
    }

    private function compassDirection(float $bearing): string
    {
        $directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

        return $directions[(int) round($bearing / 45) % 8];
    }

    private function conditions(array $location, bool $includeMarine = true, ?string $fishingAt = null, string $scope = 'point'): array
    {
        $temporalMode = $fishingAt === null ? 'current' : 'forecast';
        $targetTime = $fishingAt === null ? time() : $this->providerTime($fishingAt);
        $fields = [
            'weather' => ['temperature_2m' => 'airTemperatureC', 'apparent_temperature' => 'apparentTemperatureC', 'relative_humidity_2m' => 'relativeHumidityPct', 'wind_speed_10m' => 'windSpeedKmh', 'wind_direction_10m' => 'windDirectionDeg', 'wind_gusts_10m' => 'gustKmh', 'pressure_msl' => 'pressureHpa', 'precipitation' => 'precipitationMm', 'weather_code' => 'weatherCode', 'cloud_cover' => 'cloudCoverPct', 'visibility' => 'visibilityM', 'is_day' => 'isDay'],
            'marine' => ['wave_height' => 'waveHeightM', 'wave_direction' => 'waveDirectionDeg', 'wave_period' => 'wavePeriodS', 'swell_wave_height' => 'swellHeightM', 'swell_wave_direction' => 'swellDirectionDeg', 'swell_wave_period' => 'swellPeriodS', 'sea_surface_temperature' => 'seaSurfaceTemperatureC', 'ocean_current_velocity' => 'currentSpeedKmh', 'ocean_current_direction' => 'currentDirectionDeg', 'sea_level_height_msl' => 'seaLevelMslM'],
        ];
        $snapshots = ['weather' => ['pressureTrend' => 'unknown', 'confidence' => 'none', 'temporalMode' => $temporalMode], 'marine' => ['confidence' => 'none', 'temporalMode' => $temporalMode]];
        $warnings = [];
        $responses = [];
        // Dispatch both model requests before reading either response (bounded concurrency).
        foreach (['weather' => 'https://api.open-meteo.com/v1/forecast', 'marine' => 'https://marine-api.open-meteo.com/v1/marine'] as $source => $url) {
            if ($source === 'marine' && !$includeMarine) {
                continue;
            }
            $query = ['latitude' => $location['lat'], 'longitude' => $location['lon'], 'timezone' => 'GMT', 'timeformat' => 'unixtime', $fishingAt === null ? 'current' : 'hourly' => implode(',', array_keys($fields[$source]))];
            if ($source === 'marine') {
                $query['cell_selection'] = 'sea';
                $query['velocity_unit'] = 'kmh';
            } else {
                $query['wind_speed_unit'] = 'kmh';
            }
            if ($fishingAt !== null) {
                // Eight UTC calendar days include the rolling now + 7 day boundary.
                $query['forecast_days'] = 8;
            }
            try {
                $responses[$source] = $this->http->request('GET', $url, ['query' => $query, 'timeout' => 15]);
            } catch (\Throwable) {
                $warnings[] = sprintf('Η υπηρεσία %s δεν είναι προσωρινά διαθέσιμη.', $source);
            }
        }
        foreach ($responses as $source => $response) {
            try {
                $data = $response->toArray();
                $values = $data['current'] ?? [];
                $validTime = $this->providerTime($values['time'] ?? null, (int) ($data['utc_offset_seconds'] ?? 0));
                if ($fishingAt !== null) {
                    $hourly = $data['hourly'] ?? [];
                    $selected = null;
                    $difference = PHP_INT_MAX;
                    foreach ($hourly['time'] ?? [] as $index => $value) {
                        $timestamp = $this->providerTime($value, (int) ($data['utc_offset_seconds'] ?? 0));
                        if ($timestamp !== null && abs($timestamp - $targetTime) < $difference) {
                            $selected = $index;
                            $validTime = $timestamp;
                            $difference = abs($timestamp - $targetTime);
                        }
                    }
                    if ($selected === null || $difference > 1800) {
                        throw new ApiException(sprintf('Δεν υπάρχει ωριαία πρόγνωση %s κοντά στο %s εντός του ορίζοντα του παρόχου. Επιλέξτε άλλη ώρα εντός 7 ημερών ή τωρινές συνθήκες.', $source, $fishingAt), 422);
                    }
                    $values = [];
                    foreach ($fields[$source] as $field => $unused) {
                        $values[$field] = $hourly[$field][$selected] ?? null;
                    }
                }
                $snapshot = $snapshots[$source];
                foreach ($fields[$source] as $field => $name) {
                    if (is_numeric($values[$field] ?? null) && is_finite((float) $values[$field])) {
                        $snapshot[$name] = $name === 'isDay' ? (bool) $values[$field] : (float) $values[$field];
                    }
                }
                $snapshot['source'] = 'Open-Meteo';
                $snapshot['fetchedAt'] = gmdate('Y-m-d\TH:i:s\Z');
                if ($validTime !== null) {
                    $snapshot['validAt'] = gmdate('Y-m-d\TH:i:s\Z', $validTime);
                }
                if (is_numeric($data['latitude'] ?? null) && is_numeric($data['longitude'] ?? null) && is_finite((float) $data['latitude']) && is_finite((float) $data['longitude']) && abs((float) $data['latitude']) <= 90 && abs((float) $data['longitude']) <= 180) {
                    $snapshot['sourceCoordinates'] = ['lat' => (float) $data['latitude'], 'lon' => (float) $data['longitude']];
                }
                $snapshot['requestedCoordinates'] = ['lat' => $location['lat'], 'lon' => $location['lon']];
                $required = $source === 'weather' ? ['windSpeedKmh', 'gustKmh'] : ['waveHeightM', 'currentSpeedKmh'];
                $complete = $validTime !== null && isset($snapshot['sourceCoordinates']);
                foreach ($required as $field) {
                    $complete = $complete && isset($snapshot[$field]) && $snapshot[$field] >= 0;
                }
                $snapshot['confidence'] = $complete ? 'medium' : 'low';
                $snapshot['stale'] = $fishingAt === null && ($validTime === null || abs($validTime - time()) > 3600);
                if (!$complete || $snapshot['stale']) {
                    $warnings[] = sprintf('Ελλιπή ή χρονικά μη έγκυρα δεδομένα %s: δεν τεκμηριώνεται απουσία δυσμενών συνθηκών.', $source);
                }
                $snapshots[$source] = $snapshot;
            } catch (ApiException $exception) {
                throw $exception;
            } catch (\Throwable) {
                $warnings[] = sprintf('Δεν ήταν διαθέσιμα τα δεδομένα %s για την επιλεγμένη ώρα.', $source);
            }
        }
        if ($fishingAt !== null && (!isset($snapshots['weather']['validAt']) || ($includeMarine && !isset($snapshots['marine']['validAt'])))) {
            throw new ApiException('Η ωριαία πρόγνωση για την επιλεγμένη ώρα δεν είναι προσωρινά διαθέσιμη. Δεν αντικαθίσταται με τωρινά δεδομένα.', 503);
        }
        if ($fishingAt !== null) {
            $warnings[] = 'Ωριαία πρόγνωση στο πλησιέστερο διαθέσιμο βήμα (έως 30 λεπτά από την επιλογή), όχι παρατήρηση ούτε πρόβλεψη ψαριών. Επανέλεγχος κοντά στην αναχώρηση.';
        }

        return [...$snapshots, 'warnings' => $warnings, 'conditionsScope' => $scope, 'conditionsAt' => $snapshots['weather']['validAt'] ?? $snapshots['marine']['validAt'] ?? null, 'temporalMode' => $temporalMode];
    }

    private function providerTime(mixed $value, int $utcOffset = 0): ?int
    {
        if (is_numeric($value) && is_finite((float) $value)) {
            return (int) $value;
        }
        if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?$/D', $value)) {
            return null;
        }
        try {
            $date = new \DateTimeImmutable($value, new \DateTimeZone('UTC'));
            $errors = \DateTimeImmutable::getLastErrors();
            if ($errors !== false && ($errors['warning_count'] > 0 || $errors['error_count'] > 0)) {
                return null;
            }

            return $date->getTimestamp() - (preg_match('/(?:Z|[+-]\d{2}:\d{2})$/D', $value) ? 0 : $utcOffset);
        } catch (\Throwable) {
            return null;
        }
    }

    private function depthProfiles(array $candidates, string $technique): array
    {
        if ($candidates === []) {
            return [];
        }
        $bearings = self::NEARBY_BEARINGS;
        $cacheData = [
            'version' => 7,
            'technique' => $technique,
            'dataset' => 'emodnet-dtm-'.$this->emodnetDepthRelease,
            'sampling' => 'native-cell-mean',
            'bearings' => $bearings,
            'distancesM' => self::NEARBY_DISTANCES_M,
            'locations' => array_map(static fn (array $candidate): array => [$candidate['id'], round($candidate['lat'], 6), round($candidate['lon'], 6)], $candidates),
        ];
        $cacheKey = 'depth_'.hash('sha256', json_encode($cacheData, JSON_THROW_ON_ERROR));

        $cached = $this->upstreamCache->getItem($cacheKey);
        if ($cached->isHit() && is_array($cached->get())) {
            return $cached->get();
        }
        $profiles = (function () use ($candidates, $bearings, $technique): array {
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
            [$rangeMin, $rangeMax] = self::TECHNIQUE_RANGES_M[$technique];
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
                    if ($sample['distanceM'] > 0 && $sample['distanceM'] >= $rangeMin && $sample['distanceM'] <= $rangeMax && $sample['bearing'] !== null) {
                        $bearingGroups[(int) $sample['bearing']][] = $sample;
                    }
                }
                $choices = [];
                foreach ($bearingGroups as $bearing => $bearingSamples) {
                    usort($bearingSamples, static fn (array $a, array $b): int => $a['distanceM'] <=> $b['distanceM']);
                    $bearingSamples = array_values(array_column($bearingSamples, null, 'cellId'));
                    $choices[] = [
                        'bearing' => $bearing,
                        'samples' => $bearingSamples,
                        'score' => count($bearingSamples) * 100 + max(array_column($bearingSamples, 'depthM')) - min(array_column($bearingSamples, 'distanceM')) / 100,
                    ];
                }
                usort($choices, static fn (array $a, array $b): int => $b['score'] <=> $a['score']);
                $choice = $choices[0] ?? null;
                $profileSamples = $choice['samples'] ?? [];
                if ($exactIsWater === true && $technique === 'boat-fishing') {
                    foreach ($wetSamples as $sample) {
                        if ($sample['distanceM'] === 0) {
                            array_unshift($profileSamples, $sample);
                            break;
                        }
                    }
                }
                $profileSamples = array_values(array_column($profileSamples, null, 'cellId'));
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
                    'points' => array_map(static fn (array $sample): array => ['distanceM' => $sample['distanceM'], 'depthM' => $sample['depthM'], 'lat' => $sample['lat'], 'lon' => $sample['lon'], 'cellId' => $sample['cellId'], 'confidence' => 'estimated'], array_values(array_filter($profileSamples, static fn (array $sample): bool => $sample['distanceM'] > 0))),
                    'sampleCount' => count(array_unique(array_column($measuredSamples, 'cellId'))),
                    'availableSampleCount' => count($measuredSamples),
                    'requestedSampleCount' => 1 + count($bearings) * count(self::NEARBY_DISTANCES_M),
                    'complete' => count($measuredSamples) === 1 + count($bearings) * count(self::NEARBY_DISTANCES_M),
                    'fetchedAt' => $measuredSamples[0]['fetchedAt'],
                    'confidence' => count($profileSamples) >= 3 ? 'medium' : 'low',
                ];
            }

            return $profiles;
        })();
        if (count($profiles) === count($candidates) && array_filter($profiles, static fn (array $profile): bool => !$profile['complete']) === []) {
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
        $groups = [];
        foreach ($samples as $index => $sample) {
            $groups[$sample['spotId'] ?? '_point'][$index] = $sample;
        }

        foreach (array_chunk($groups, self::EMODNET_CONCURRENCY, true) as $groupBatch) {
            $responses = [];
            foreach ($groupBatch as $groupId => $groupSamples) {
                $latitudes = array_column($groupSamples, 'lat');
                $longitudes = array_column($groupSamples, 'lon');
                $margin = self::EMODNET_GRID_DEGREES;
                $query = http_build_query([
                    'service' => 'WCS',
                    'version' => '2.0.1',
                    'request' => 'GetCoverage',
                    'coverageId' => 'emodnet__mean',
                    'format' => 'text/plain',
                ], '', '&', PHP_QUERY_RFC3986);
                $query .= '&subset='.rawurlencode(sprintf('Long(%.8F,%.8F)', min($longitudes) - $margin, max($longitudes) + $margin));
                $query .= '&subset='.rawurlencode(sprintf('Lat(%.8F,%.8F)', min($latitudes) - $margin, max($latitudes) + $margin));
                try {
                    $responses[$groupId] = $this->http->request('GET', rtrim($this->emodnetDepthEndpoint, '?').'?' . $query, [
                        'headers' => ['Accept' => 'text/plain', 'User-Agent' => 'FishingSpotter/1.0 Symfony'],
                        'timeout' => 22,
                    ]);
                } catch (\Throwable) {
                }
            }

            foreach ($responses as $groupId => $response) {
                try {
                    if ($response->getStatusCode() !== 200) {
                        continue;
                    }
                    $grid = $this->parseEmodnetCoverage($response->getContent());
                    $fetchedAt = gmdate('Y-m-d\TH:i:s\Z');
                    foreach ($groupBatch[$groupId] as $index => $sample) {
                        $cell = $this->emodnetCellAt($grid, (float) $sample['lat'], (float) $sample['lon']);
                        if ($cell === null) {
                            continue;
                        }
                        $samples[$index] = [...$sample, ...$cell, 'fetchedAt' => $fetchedAt];
                    }
                } catch (\Throwable) {
                }
            }
        }

        return $samples;
    }

    /** @return array{originLon: float, originLat: float, stepLon: float, stepLat: float, minColumn: int, minRow: int, rows: list<list<string>>} */
    private function parseEmodnetCoverage(string $body): array
    {
        $parameters = [];
        foreach (['elt_0_0' => 'stepLon', 'elt_0_2' => 'originLon', 'elt_1_1' => 'stepLat', 'elt_1_2' => 'originLat'] as $source => $target) {
            if (!preg_match('/PARAMETER\["'.preg_quote($source, '/').'",\s*([-+0-9.eE]+)\]/', $body, $match)) {
                throw new \RuntimeException('EMODnet returned an unreadable grid transform.');
            }
            $parameters[$target] = (float) $match[1];
        }
        if (!preg_match('/Grid range:\s*GridEnvelope2D\[(\d+)\.\.(\d+),\s*(\d+)\.\.(\d+)\]/', $body, $range)) {
            throw new \RuntimeException('EMODnet returned an unreadable grid range.');
        }
        if (!preg_match('/Contents:\s*Band 0:\s*(.+)\s*$/s', $body, $contents)) {
            throw new \RuntimeException('EMODnet returned no depth values.');
        }

        $rows = array_values(array_filter(array_map(
            static fn (string $line): array => preg_split('/\s+/', trim($line)) ?: [],
            preg_split('/\R/', trim($contents[1])) ?: [],
        )));
        $minColumn = (int) $range[1];
        $minRow = (int) $range[3];
        $width = (int) $range[2] - $minColumn + 1;
        $height = (int) $range[4] - $minRow + 1;
        if (count($rows) !== $height || array_filter($rows, static fn (array $row): bool => count($row) !== $width) !== []) {
            throw new \RuntimeException('EMODnet returned an incomplete depth grid.');
        }

        return [...$parameters, 'minColumn' => $minColumn, 'minRow' => $minRow, 'rows' => $rows];
    }

    private function emodnetCellAt(array $grid, float $lat, float $lon): ?array
    {
        if ($grid['stepLon'] == 0 || $grid['stepLat'] == 0) {
            return null;
        }
        $column = (int) round(($lon - $grid['originLon']) / $grid['stepLon']) - $grid['minColumn'];
        $row = (int) round(($lat - $grid['originLat']) / $grid['stepLat']) - $grid['minRow'];
        $value = $grid['rows'][$row][$column] ?? null;

        if (!is_string($value) || !is_numeric($value) || !is_finite((float) $value) || (float) $value < -12000 || (float) $value > 9000) {
            return null;
        }

        return ['elevation' => (float) $value, 'cellId' => sprintf('%s:%.7F,%.7F', $this->emodnetDepthRelease, $grid['originLat'] + ($row + $grid['minRow']) * $grid['stepLat'], $grid['originLon'] + ($column + $grid['minColumn']) * $grid['stepLon'])];
    }

    private function rank(array $candidates, array $intent, array $conditions, array $depthProfiles, int $limit): array
    {
        $profile = self::PROFILES[$intent['technique']];
        $spots = [];
        foreach ($candidates as $candidate) {
            if ($this->isRestricted($candidate['tags'])) {
                continue;
            }
            $measuredDepth = $depthProfiles[$candidate['id']] ?? null;
            if ($measuredDepth === null) {
                continue;
            }
            $closest = $measuredDepth['closest'];
            $casting = $measuredDepth['casting'];
            $max = $measuredDepth['max'];
            $slope = $measuredDepth['slope'];
            $depthScore = is_numeric($casting) ? $this->rangeScore($casting, $profile['depth']) : 0;
            $fitScore = $profile['fit'][$candidate['category']] ?? 55;
            $candidate['access'] = $this->accessSummary($candidate['tags']);
            $accessScore = $candidate['access']['permission'] === 'mapped-allowed' ? 70 : 0;
            $wave = $conditions['marine']['waveHeightM'] ?? null;
            $conditionScore = is_numeric($wave) ? $this->rangeScore((float) $wave, [$profile['waves'][0], $profile['waves'][1], 0, $profile['waves'][2]]) : 0;
            $score = (int) round($fitScore * 0.4 + $depthScore * 0.3 + $accessScore * 0.15 + $conditionScore * 0.15);
            $depthRange = is_numeric($casting) ? $this->depthRange($casting, $profile) : $this->unavailableDepthRange($profile);
            $conditionsLabel = $this->conditionsLabel($conditions);
            $depth = ['source' => 'emodnet-dtm-'.$this->emodnetDepthRelease, 'hasNearbyWater' => true, 'shoreDistanceM' => $measuredDepth['waterDistanceM'], 'castingProfile' => $measuredDepth['points'], 'slope' => $slope, 'seabedType' => 'unknown', 'snagRisk' => 'unknown', 'style' => $this->depthStyle($slope), 'sampleCount' => $measuredDepth['sampleCount'], 'confidence' => $measuredDepth['confidence'], 'complete' => $measuredDepth['complete'], 'requestedSampleCount' => $measuredDepth['requestedSampleCount'], 'availableSampleCount' => $measuredDepth['availableSampleCount'], 'fetchedAt' => $measuredDepth['fetchedAt'], 'spatialResolutionM' => 115, 'sampling' => 'native-cell-mean', 'techniqueRangeM' => self::TECHNIQUE_RANGES_M[$intent['technique']]];
            foreach (['closestFishableDepthM' => $closest, 'castingDepthM' => $casting, 'maxDepthM' => $max] as $field => $value) {
                if (is_numeric($value)) {
                    $depth[$field] = (float) $value;
                }
            }
            if ($measuredDepth['exactIsWater'] !== null) {
                $depth['isSpotInWater'] = $measuredDepth['exactIsWater'];
            }
            if ($measuredDepth['bearing'] !== null) {
                $depth['waterBearingDeg'] = $measuredDepth['bearing'];
            }
            $spot = [...$candidate,
                'score' => $score,
                'depth' => $depth,
                'marine' => $conditions['marine'],
                'weather' => $conditions['weather'],
                'depthStyle' => $depth['style'],
                'techniqueDepthRange' => $depthRange,
                'depthSourceLabel' => 'EMODnet DTM '.$this->emodnetDepthRelease.', μέση τιμή κελιού ~115μ',
                'seabedLabel' => 'άγνωστος (δεν μετράται από το DTM)',
                'snagRiskLabel' => 'άγνωστα',
                'confidenceLabel' => 'Χονδρική ζώνη από μοναδικά κελιά EMODnet, όχι μέτρηση βυθομέτρου ή επαληθευμένη θέση στάσης',
                'conditionsLabel' => $conditionsLabel,
                'warnings' => [],
                'breakdown' => [['key' => 'technique', 'label' => 'Συσχέτιση τεχνικής', 'score' => $fitScore, 'weight' => 40, 'explanation' => 'Γενικός συνδυασμός τεχνικής και τύπου ακτής.'], ['key' => 'depth', 'label' => 'Βάθος', 'score' => $depthScore, 'weight' => 30, 'explanation' => $depthRange['label']], ['key' => 'access', 'label' => 'Πρόσβαση', 'score' => $accessScore, 'weight' => 15, 'explanation' => 'Ένδειξη OSM, όχι επαλήθευση πρόσβασης ή νομιμότητας.'], ['key' => 'conditions', 'label' => 'Συνθήκες', 'score' => $conditionScore, 'weight' => 15, 'explanation' => $conditionsLabel]],
            ];
            $spots[] = $this->applySuitability($spot, $intent, $conditions);
        }
        $order = ['eligible' => 0, 'caution' => 1, 'unverified' => 2, 'unsuitable' => 3];
        usort($spots, static fn (array $a, array $b): int => $order[$a['recommendationStatus']] <=> $order[$b['recommendationStatus']] ?: $b['score'] <=> $a['score'] ?: $a['distanceKm'] <=> $b['distanceKm'] ?: strcmp($a['id'], $b['id']));
        $spots = array_slice($spots, 0, $limit);
        foreach ($spots as $index => &$spot) {
            $spot['rank'] = $index + 1;
        }

        return $spots;
    }

    private function applySuitability(array $spot, array $intent, array $conditions, bool $requiresRelocation = false, ?float $gpsAccuracyM = null): array
    {
        $profile = self::PROFILES[$intent['technique']];
        $boat = $intent['technique'] === 'boat-fishing';
        $policy = ['basis' => 'conservative-heuristic-not-certified-safety', 'waveMaxM' => $profile['waves'][2], 'windMaxKmh' => $boat ? 20 : 25, 'gustMaxKmh' => $boat ? 30 : 35, 'currentMaxKmh' => $boat ? 1.5 : 2];
        $reasons = [];
        $adverse = false;
        $unknown = false;
        foreach ([['marine', 'waveHeightM', $policy['waveMaxM'], 'κύμα'], ['marine', 'swellHeightM', $policy['waveMaxM'], 'αποθαλασσία'], ['weather', 'windSpeedKmh', $policy['windMaxKmh'], 'άνεμος'], ['weather', 'gustKmh', $policy['gustMaxKmh'], 'ριπές'], ['marine', 'currentSpeedKmh', $policy['currentMaxKmh'], 'ρεύμα']] as [$source, $field, $threshold, $label]) {
            $value = $conditions[$source][$field] ?? null;
            if (!is_numeric($value) || !is_finite((float) $value) || $value < 0) {
                $unknown = $unknown || $field !== 'swellHeightM';
            } elseif ($value > $threshold) {
                $adverse = true;
                $reasons[] = sprintf('Δυσμενής ένδειξη: %s %.1f, πάνω από το συντηρητικό όριο %.1f της ευρετικής πολιτικής.', $label, $value, $threshold);
            }
        }
        if (in_array((int) ($conditions['weather']['weatherCode'] ?? -1), [95, 96, 99], true) || (isset($conditions['weather']['visibilityM']) && $conditions['weather']['visibilityM'] < 1000)) {
            $adverse = true;
            $reasons[] = 'Δυσμενής ένδειξη καταιγίδας ή περιορισμένης ορατότητας από το μοντέλο.';
        }
        foreach (['weather', 'marine'] as $source) {
            $snapshot = $conditions[$source];
            $validAt = $this->providerTime($snapshot['validAt'] ?? null);
            $fetchedAt = $this->providerTime($snapshot['fetchedAt'] ?? null);
            $target = ($intent['temporalMode'] ?? 'current') === 'forecast' ? $this->providerTime($intent['fishingAt'] ?? null) : time();
            if ($validAt === null || $fetchedAt === null || $target === null || abs($validAt - $target) > (($intent['temporalMode'] ?? 'current') === 'forecast' ? 1800 : 3600) || time() - $fetchedAt > 1800 || $fetchedAt > time() + 60 || !isset($snapshot['sourceCoordinates']) || ($snapshot['confidence'] ?? 'none') === 'none') {
                $unknown = true;
                $reasons[] = sprintf('Άγνωστη χρονική ή χωρική εγκυρότητα %s· ελέγξτε validAt, fetchedAt και συντεταγμένες μοντέλου.', $source);
            }
        }
        $weatherTime = $this->providerTime($conditions['weather']['validAt'] ?? null);
        $marineTime = $this->providerTime($conditions['marine']['validAt'] ?? null);
        if ($weatherTime !== null && $marineTime !== null && abs($weatherTime - $marineTime) > 1800) {
            $unknown = true;
            $reasons[] = 'Οι ώρες ισχύος καιρού και θάλασσας διαφέρουν πάνω από 30 λεπτά· δεν τεκμηριώνεται ενιαίος έλεγχος συνθηκών.';
        }
        $conditionsStatus = $adverse ? 'adverse' : ($unknown ? 'unknown' : 'no-adverse-signal');
        if ($unknown) {
            $reasons[] = 'Λείπουν ή έχουν παλιώσει κρίσιμα δεδομένα συνθηκών. Δεν δίνεται οδηγία βολής.';
        }
        $depthStatus = $spot['techniqueDepthRange']['status'];
        $unusableDepth = in_array($depthStatus, ['too-shallow', 'too-deep'], true);
        if ($unusableDepth) {
            $reasons[] = 'Το εκτιμώμενο βάθος είναι έξω από το χρήσιμο εύρος της τεχνικής.';
        }
        $depthUnknown = $depthStatus === 'unknown' || !($spot['depth']['complete'] ?? false);
        if ($depthUnknown) {
            $reasons[] = 'Δεν υπάρχει πλήρης εκτίμηση βάθους στη χρήσιμη ζώνη της τεχνικής.';
        }
        if ($requiresRelocation) {
            $reasons[] = $boat ? 'Το επιλεγμένο σημείο δεν επιβεβαιώνεται ως κελί νερού για ανάλυση από σκάφος.' : 'Απαιτείται μετακίνηση και νέα επιβεβαίωση θέσης στην ακτή· η θέση χρήστη δεν αποτελεί επαληθευμένο σημείο στάσης.';
        }
        $permissionUnknown = ($spot['access']['permission'] ?? 'unknown') !== 'mapped-allowed' || ($spot['access']['fishingPermission'] ?? 'unknown') !== 'mapped-allowed';
        if ($permissionUnknown) {
            $reasons[] = 'Άγνωστη άδεια πρόσβασης ή αλιείας. Δεν σημαίνει ότι επιτρέπεται.';
        }
        if (!$boat) {
            $reasons[] = 'Η γειτονική ακτογραμμή δεν επιβεβαιώνει θέση στάσης, βατή πρόσβαση ή ελεύθερη διαδρομή βολής.';
        }
        $regional = $conditions['conditionsScope'] === 'regional';
        if ($regional) {
            $reasons[] = 'Περιφερειακές συνθήκες: χρειάζεται επανέλεγχος καιρού και θάλασσας στο επιλεγμένο σημείο.';
        }
        if ($gpsAccuracyM !== null && $gpsAccuracyM > 30) {
            $spot['depth']['confidence'] = ($spot['depth']['confidence'] ?? 'none') === 'none' ? 'none' : 'low';
            $spot['confidenceLabel'] .= sprintf(' · Αβεβαιότητα GPS ±%.0fμ, μειωμένη χωρική εμπιστοσύνη.', $gpsAccuracyM);
            $reasons[] = 'Η ακρίβεια GPS δεν υποστηρίζει λεπτομερή χωρική καθοδήγηση.';
        }
        $speciesMismatch = ($intent['targetSpeciesCompatibility'] ?? 'not-requested') === 'not-listed';
        if ($speciesMismatch) {
            $reasons[] = $intent['speciesLabel'];
        }
        $restricted = $this->isRestricted($spot['tags']);
        if ($restricted) {
            $reasons[] = 'Χαρτογραφημένος περιορισμός αλιείας ή πρόσβασης: δεν προτείνεται.';
        }
        $status = $adverse || $unusableDepth || $requiresRelocation || $restricted ? 'unsuitable'
            : ($unknown || $depthUnknown || $permissionUnknown ? 'unverified'
                : ($regional || !$boat || $speciesMismatch || ($gpsAccuracyM ?? 0) > 30 ? 'caution' : 'eligible'));
        $labels = ['eligible' => 'Περνά τον ευρετικό έλεγχο, απαιτείται τοπική επιβεβαίωση', 'caution' => 'Μόνο προκαταρκτική ζώνη, απαιτείται επιτόπιος έλεγχος', 'unverified' => 'Μη επαληθευμένο: όχι οδηγία για ψάρεμα ή βολή', 'unsuitable' => 'Δεν προτείνεται για την επιλεγμένη τεχνική και συνθήκες'];
        $spot['score'] = min($spot['score'], ['eligible' => 95, 'caution' => 59, 'unverified' => 39, 'unsuitable' => 24][$status]);
        $spot['recommendationStatus'] = $status;
        $spot['recommendationReasons'] = $reasons ?: ['Δεν εντοπίστηκε δυσμενής ένδειξη στους διαθέσιμους ευρετικούς ελέγχους. Αυτό δεν πιστοποιεί ασφάλεια ή νομιμότητα.'];
        $spot['conditionsStatus'] = $conditionsStatus;
        $spot['scoreMeaning'] = 'heuristic-fit';
        $spot['actionabilityLabel'] = $labels[$status];
        $spot['conditionsPolicy'] = $policy;
        $spot['conditionsScope'] = $conditions['conditionsScope'];
        $spot['conditionsAt'] = $conditions['conditionsAt'];
        $spot['temporalMode'] = $conditions['temporalMode'];
        $spot['requiresRelocation'] = $requiresRelocation;
        $spot['summary'] = $labels[$status].'. '.$spot['techniqueDepthRange']['label'].' Ο βαθμός είναι ευρετική συσχέτιση, όχι πιθανότητα αλιεύματος.';
        $spot['likelyFish'] = [];
        $spot['typicalSpecies'] = $profile['species'];
        $spot['speciesBasis'] = 'general-technique-compatibility';
        $spot['speciesLabel'] = $intent['speciesLabel'];
        $spot['recommendedTechniques'] = in_array($status, ['eligible', 'caution'], true) ? [$profile['label']] : [];
        $spot['bait'] = in_array($status, ['eligible', 'caution'], true) ? $profile['bait'] : [];
        $spot['bestWindow'] = 'Δεν προβλέπεται ώρα παρουσίας ή δραστηριότητας ψαριών.';
        $spot['castingAdvice'] = $boat ? 'Ανάλυση ζώνης για σκάφος, όχι βολή από ακτή ή οδηγία ναυσιπλοΐας. Απαιτούνται ναυτικοί χάρτες, όργανα και τοπικός έλεγχος.' : 'Δεν δίνεται ακριβής βολή: κελιά DTM ~115μ και άγνωστη θέση στάσης δεν επαρκούν. Επιβεβαιώστε τοπικά πρόσβαση, συνθήκες και εμπόδια.';
        $spot['warnings'] = array_values(array_unique([...$spot['warnings'], ...$conditions['warnings'], ...$spot['recommendationReasons'], 'Συντηρητική ευρετική πολιτική, όχι πιστοποίηση ασφάλειας. Η απουσία δυσμενούς ένδειξης δεν σημαίνει ασφαλές σημείο.', 'Το DTM δεν μετρά σύσταση βυθού ή σκαλώματα και δεν είναι κατάλληλο για ναυσιπλοΐα.']));

        return $spot;
    }

    private function depthRange(float $value, array $profile): array
    {
        [$idealMin, $idealMax, $softMin, $softMax] = $profile['depth'];
        $status = $value < $softMin ? 'too-shallow' : ($value < $idealMin ? 'shallow' : ($value <= $idealMax ? 'ideal' : ($value <= $softMax ? 'deep' : 'too-deep')));
        $labels = ['ideal' => sprintf('Εκτίμηση %.1fμ: μέσα στο τυπικό %.0f-%.0fμ για %s.', $value, $idealMin, $idealMax, $profile['label']), 'shallow' => sprintf('Εκτίμηση %.1fμ: ρηχότερα από το τυπικό εύρος.', $value), 'deep' => sprintf('Εκτίμηση %.1fμ: βαθύτερα από το τυπικό, εντός χρήσιμου εύρους βάθους μόνο.', $value), 'too-shallow' => sprintf('Εκτίμηση %.1fμ: πολύ ρηχά για την τεχνική.', $value), 'too-deep' => sprintf('Εκτίμηση %.1fμ: πολύ βαθιά για την τεχνική.', $value)];

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

        $label = ($conditions['temporalMode'] ?? 'current') === 'forecast' ? 'Ωριαία πρόγνωση μοντέλου' : 'Στιγμιότυπο μοντέλου';
        if ($conditions['conditionsAt'] ?? null) {
            $label .= ' '.$conditions['conditionsAt'];
        }

        return $parts ? $label.' · '.implode(' · ', $parts) : 'Δεν υπάρχουν διαθέσιμα δεδομένα συνθηκών για την επιλεγμένη ώρα.';
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

    private function depthStyle(string $slope): string
    {
        return ['flat' => 'σχεδόν επίπεδος βυθός', 'gentle' => 'ήπια κλίση', 'moderate' => 'μέτρια κλίση', 'steep' => 'απότομο κατέβασμα'][$slope] ?? 'άγνωστη μορφολογία';
    }

    private function coordinate(mixed $value, float $min, float $max): float
    {
        if (!is_numeric($value) || !is_finite($number = (float) $value) || $number < $min || $number > $max) {
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
