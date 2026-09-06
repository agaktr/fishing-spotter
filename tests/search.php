#!/usr/bin/env php
<?php

declare(strict_types=1);

require dirname(__DIR__).'/vendor/autoload.php';

use App\Exception\ApiException;
use App\Service\SpotSearchService;
use Psr\Cache\CacheItemInterface;
use Symfony\Component\Cache\Adapter\ArrayAdapter;
use Symfony\Component\Cache\CacheItem;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;

// Run with: ddev exec php tests/search.php. No network, database, or kernel boot.
set_error_handler(static function (int $severity, string $message, string $file, int $line): never {
    throw new ErrorException($message, 0, $severity, $file, $line);
});

final class SearchTestCache extends ArrayAdapter
{
    public array $reads = [];
    public array $writes = [];

    public function getItem(mixed $key): CacheItem
    {
        $this->reads[] = $key;

        return parent::getItem($key);
    }

    public function save(CacheItemInterface $item): bool
    {
        $this->writes[] = $item->getKey();

        return parent::save($item);
    }
}

$assertions = 0;
function check(bool $condition, string $message): void
{
    global $assertions;
    ++$assertions;
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function invoke(SpotSearchService $service, string $method, mixed ...$arguments): mixed
{
    return (new ReflectionMethod($service, $method))->invoke($service, ...$arguments);
}

function apiError(callable $call, int $status): void
{
    try {
        $call();
    } catch (ApiException $exception) {
        check($exception->status() === $status && $exception->getMessage() !== '', 'Expected a clear API error with status '.$status);

        return;
    }
    throw new RuntimeException('Expected API validation error '.$status);
}

function fixture(): array
{
    $state = (object) [
        'requests' => [], 'unexpected' => [], 'depthCalls' => 0, 'overpassCalls' => 0,
        'depthFailure' => false, 'partial' => false, 'gridMode' => 'coast', 'depth' => 6,
        'dryUntilLon' => 0, 'elements' => [], 'conditionsFailure' => false,
        'validTime' => (int) (floor(time() / 900) * 900),
        'hourlyTimes' => [(int) (floor((time() + 86400) / 3600) * 3600)],
        'hourlyWeather' => [], 'hourlyMarine' => [],
        'weather' => ['temperature_2m' => 20, 'wind_speed_10m' => 8, 'wind_gusts_10m' => 12, 'pressure_msl' => 1013, 'weather_code' => 0, 'visibility' => 20000],
        'marine' => ['wave_height' => 0.2, 'swell_wave_height' => 0.1, 'ocean_current_velocity' => 0.3, 'sea_surface_temperature' => 22],
    ];
    $personal = new SearchTestCache();
    $upstream = new SearchTestCache();
    $http = new MockHttpClient(static function (string $method, string $url, array $options) use ($state): MockResponse {
        $state->requests[] = [$method, $url, $options];
        if (str_starts_with($url, 'https://mock.test/geocode/search')) {
            return new MockResponse(json_encode([['lat' => 37, 'lon' => 24, 'display_name' => 'Mock coast']], JSON_THROW_ON_ERROR));
        }
        if (str_starts_with($url, 'https://mock.test/overpass')) {
            ++$state->overpassCalls;

            return new MockResponse(json_encode(['elements' => $state->elements], JSON_THROW_ON_ERROR));
        }
        if (str_starts_with($url, 'https://mock.test/depth')) {
            ++$state->depthCalls;
            if ($state->depthFailure) {
                return new MockResponse('unavailable', ['http_code' => 503]);
            }
            preg_match('/Long\(([-0-9.]+),([-0-9.]+)\)/', rawurldecode($url), $longitudes);
            preg_match('/Lat\(([-0-9.]+),([-0-9.]+)\)/', rawurldecode($url), $latitudes);
            $step = 1 / 960;
            $minLon = (int) floor((float) $longitudes[1] / $step);
            $maxLon = (int) ceil((float) $longitudes[2] / $step);
            $minLat = (int) floor((float) $latitudes[1] / $step);
            $maxLat = (int) ceil((float) $latitudes[2] / $step);
            $centerLon = ((float) $longitudes[1] + (float) $longitudes[2]) / 2;
            $rows = [];
            for ($lat = $minLat; $lat <= $maxLat; ++$lat) {
                $row = [];
                for ($lon = $minLon; $lon <= $maxLon; ++$lon) {
                    $dry = $state->gridMode === 'dry' || $centerLon < $state->dryUntilLon || ($state->gridMode === 'coast' && $lat >= 37 * 960);
                    $row[] = $state->partial && $lat === 37 * 960 && $lon === 24 * 960 ? 'NaN' : (string) ($dry ? 3 : -$state->depth);
                }
                $rows[] = implode(' ', $row);
            }
            $body = sprintf("PARAMETER[\"elt_0_0\",%.15F]\nPARAMETER[\"elt_0_2\",%.15F]\nPARAMETER[\"elt_1_1\",%.15F]\nPARAMETER[\"elt_1_2\",%.15F]\nGrid range: GridEnvelope2D[0..%d, 0..%d]\nContents:\nBand 0:\n%s", $step, $minLon * $step, $step, $minLat * $step, $maxLon - $minLon, $maxLat - $minLat, implode("\n", $rows));

            return new MockResponse($body);
        }
        if (str_starts_with($url, 'https://api.open-meteo.com/') || str_starts_with($url, 'https://marine-api.open-meteo.com/')) {
            if ($state->conditionsFailure) {
                return new MockResponse('unavailable', ['http_code' => 503]);
            }
            $marine = str_contains($url, 'marine-api');
            $values = $marine ? $state->marine : $state->weather;
            $hourly = ['time' => $state->hourlyTimes];
            foreach ($values as $key => $value) {
                $hourly[$key] = array_fill(0, count($state->hourlyTimes), $value);
            }
            $hourly = array_replace($hourly, $marine ? $state->hourlyMarine : $state->hourlyWeather);

            return new MockResponse(json_encode(['latitude' => $marine ? 36.95 : 37.04, 'longitude' => $marine ? 24.1 : 24.07, 'utc_offset_seconds' => 0, 'current' => ['time' => $marine ? ($state->marineValidTime ?? $state->validTime) : $state->validTime, ...$values], 'hourly' => $hourly], JSON_THROW_ON_ERROR));
        }
        $state->unexpected[] = $url;

        return new MockResponse('unexpected mock URL', ['http_code' => 503]);
    });

    return [new SpotSearchService($http, $personal, $upstream, 'https://mock.test/geocode', 'https://mock.test/overpass', 'https://mock.test/depth', '2024'), $state, $personal, $upstream];
}

function elements(int $count): array
{
    return array_map(static fn (int $index): array => ['type' => 'node', 'id' => $index, 'lat' => 37, 'lon' => 24 + $index * 0.003, 'tags' => ['natural' => 'beach', 'name' => 'Mock '.$index]], range(0, $count - 1));
}

$point = ['technique' => 'eging', 'location' => '', 'mode' => 'point', 'coordinates' => ['lat' => 37, 'lon' => 24], 'radiusKm' => 25, 'resultLimit' => 1];
$nearby = [...$point, 'mode' => 'nearby', 'resultLimit' => 5];
$profiles = (new ReflectionClass(SpotSearchService::class))->getConstant('PROFILES');
$beach = "\u{03a0}\u{03b1}\u{03c1}\u{03b1}\u{03bb}\u{03af}\u{03b1} \u{03a3}\u{03bf}\u{03c5}\u{03bd}\u{03af}\u{03bf}\u{03c5}";
$squid = "\u{03ba}\u{03b1}\u{03bb}\u{03b1}\u{03bc}\u{03ac}\u{03c1}\u{03b9}";

// Structured authority, separate geocoding, honest species boundary, real hourly data.
[$service, $state, $personal] = fixture();
$hour = $state->hourlyTimes[0];
$state->hourlyTimes = [$hour - 3600, $hour, $hour + 3600];
$state->hourlyWeather = ['wind_speed_10m' => [8, 40, 8]];
$state->elements = elements(2);
$body = ['technique' => 'eging', 'location' => $beach, 'query' => 'surfcasting beach tomorrow spinning', 'targetSpecies' => $squid, 'fishingAt' => gmdate('Y-m-d\TH:i:s', $hour + 1200).'.000Z', 'mode' => 'nearby', 'resultLimit' => 1];
$result = $service->search($body, false);
check($result['intent']['technique'] === 'eging' && $result['intent']['locationText'] === $beach, 'Explicit Eging must survive a Greek beach name and conflicting legacy query');
check($result['intent']['targetSpeciesCompatibility'] === 'typical' && $result['intent']['inputMode'] === 'structured', 'Species is only checked against the explicit technique');
parse_str((string) parse_url($state->requests[0][1], PHP_URL_QUERY), $query);
check($query['q'] === $beach, 'Species, time, and technique must not contaminate geocoding');
check($result['temporalMode'] === 'forecast' && $result['conditionsScope'] === 'regional', 'Forecast and regional scope must be explicit');
check($result['spots'][0]['weather']['windSpeedKmh'] === 40.0, 'Selected hourly value, not current data, must drive assessment');
check($result['spots'][0]['recommendationStatus'] === 'unsuitable', 'Forecast adverse wind must gate recommendations');
foreach (['weather', 'marine'] as $source) {
    $snapshot = $result['spots'][0][$source];
    check($snapshot['validAt'] === gmdate('Y-m-d\TH:i:s\Z', $hour) && $snapshot['temporalMode'] === 'forecast', 'Both providers must preserve selected validAt');
    check(abs(strtotime($snapshot['fetchedAt']) - time()) < 5 && $snapshot['fetchedAt'] !== $snapshot['validAt'], 'fetchedAt is retrieval time, not forecast time');
    check($snapshot['sourceCoordinates'] !== $snapshot['requestedCoordinates'], 'Keep provider grid coordinates instead of copying the search point');
}
check($result['spots'][0]['weather']['pressureTrend'] === 'unknown', 'One pressure value cannot establish a trend');
check($result['spots'][0]['likelyFish'] === [] && $result['spots'][0]['typicalSpecies'] === $profiles['eging']['species'], 'Legacy occurrence field must be empty; typical species are explicitly general');
check($personal->reads === [] && $personal->writes === [], 'Opt-out must avoid all personal query/result cache access');
foreach (array_filter($state->requests, static fn (array $request): bool => str_contains($request[1], 'open-meteo')) as $request) {
    parse_str((string) parse_url($request[1], PHP_URL_QUERY), $query);
    check(isset($query['hourly']) && !isset($query['current']) && $query['forecast_days'] === '8' && $query['timeformat'] === 'unixtime' && $query['timezone'] === 'GMT', 'Forecast must request hourly UTC data through the rolling seven-day horizon');
}
$intent = invoke($service, 'requestIntent', ['technique' => 'eging', 'location' => $beach, 'targetSpecies' => 'spinning surfcasting tomorrow'], 25.0);
check($intent['technique'] === 'eging' && $intent['locationText'] === $beach && $intent['targetSpeciesCompatibility'] === 'not-listed', 'Unlisted species must not select a different technique or imply occurrence');
$legacy = invoke($service, 'requestIntent', ['query' => 'spinning near Piraeus'], 25.0);
check($legacy['inputMode'] === 'legacy' && $legacy['technique'] === 'spinning' && $legacy['locationText'] === 'Piraeus', 'Shipped query-only Android callers retain their parser');
foreach ([['technique' => 'eging'], ['location' => $beach], ['technique' => 'unsupported', 'location' => $beach]] as $invalid) {
    apiError(fn () => $service->search($invalid, false), 400);
}
$coordinateOnly = $point;
unset($coordinateOnly['location']);
$coordinateOnly['locationLabel'] = 'Selected map point';
$coordinateResult = $service->search($coordinateOnly, false);
check($coordinateResult['intent']['technique'] === 'eging' && $coordinateResult['mode'] === 'point', 'Explicit coordinates do not require an unused place-name field');
check($coordinateResult['intent']['locationText'] === 'Selected map point', 'Coordinate-only point searches retain their display label');
foreach ([gmdate('Y-m-d\TH:i:s\Z', time() + 8 * 86400), gmdate('Y-m-d\TH:i:s\Z', time() - 86400), '2026-02-30T12:00:00Z', gmdate('Y-m-d\TH:i:s').' +03:00', 'tomorrow'] as $invalid) {
    apiError(fn () => $service->search([...$point, 'fishingAt' => $invalid], false), 400);
}
check(invoke($service, 'providerTime', '2026-02-30T12:00:00Z') === null, 'Invalid calendar dates must not roll over');
check(invoke($service, 'providerTime', '2026-09-05T15:00', 10800) === strtotime('2026-09-05T12:00:00Z'), 'Offset-bearing provider local timestamps must normalize to UTC');
check(invoke($service, 'providerTime', '2026-09-05T15:00:00+03:00', 10800) === strtotime('2026-09-05T12:00:00Z'), 'Explicit offsets must not be subtracted twice');
$state->hourlyTimes = [$hour - 7200];
apiError(fn () => $service->search($body, false), 422);
$state->conditionsFailure = true;
apiError(fn () => $service->search($body, false), 503);
[$service, $state] = fixture();
$lastDay = time() + 7 * 86400 - 120;
$state->hourlyTimes = [(int) (round($lastDay / 3600) * 3600)];
$result = $service->search([...$point, 'fishingAt' => gmdate('Y-m-d\TH:i:s\Z', $lastDay)], false);
check($result['spots'][0]['marine']['validAt'] === gmdate('Y-m-d\TH:i:s\Z', $state->hourlyTimes[0]), 'Forecast must actually work on day seven');

// Conditions and depth cannot be outweighed by fit or access scores.
foreach ([['marine', 'wave_height', 3], ['weather', 'wind_gusts_10m', 50], ['weather', 'wind_speed_10m', 40], ['marine', 'ocean_current_velocity', 4], ['weather', 'weather_code', 95], ['weather', 'visibility', 500]] as [$source, $field, $value]) {
    [$service, $state] = fixture();
    $state->{$source}[$field] = $value;
    $state->elements = elements(1);
    $state->elements[0]['tags'] += ['access' => 'yes', 'fishing' => 'yes'];
    $result = $service->search($nearby, false);
    $spot = $result['spots'][0];
    check($spot['recommendationStatus'] === 'unsuitable' && $spot['conditionsStatus'] === 'adverse' && $spot['score'] <= 24, 'Adverse '.$field.' must override every positive fit factor');
    check($spot['recommendedTechniques'] === [] && $spot['bait'] === [] && $spot['recommendationReasons'] !== [], 'Adverse results must not offer actionable technique/bait advice');
    check(str_starts_with($spot['summary'], $spot['actionabilityLabel']) && !str_contains($spot['summary'], "\u{03c0}\u{03c1}\u{03bf}\u{03bf}\u{03c0}\u{03c4}\u{03b9}\u{03ba}\u{03ae}"), 'Summary must lead with the non-recommendation, never a positive prospect');
    $pointResult = $service->search($point, false);
    check(!isset($pointResult['pointAnalysis']['castRecommendation']) && !isset($pointResult['pointAnalysis']['approximateZone']) && $pointResult['spots'][0]['conditionsStatus'] === 'adverse', 'Adverse point conditions must never generate a cast');
}
[$service, $state] = fixture();
$state->elements = elements(1);
unset($state->marine['ocean_current_velocity']);
$result = $service->search($nearby, false);
check($result['spots'][0]['conditionsStatus'] === 'unknown' && $result['spots'][0]['recommendationStatus'] === 'unverified' && $result['spots'][0]['score'] <= 39, 'Missing critical data is unknown, never implicitly benign');
check($result['spots'][0]['warnings'] !== [] && $result['cache']['maxAgeSeconds'] === 0, 'Per-spot warnings survive and incomplete conditions are not cached');
$result = $service->search($point, false);
check(!isset($result['pointAnalysis']['castRecommendation']) && !isset($result['pointAnalysis']['approximateZone']), 'Unknown point conditions block all casting zones');
foreach ([0.9, 60] as $depth) {
    [$service, $state] = fixture();
    $state->elements = elements(1);
    $state->depth = $depth;
    $result = $service->search($nearby, false);
    check($result['spots'][0]['recommendationStatus'] === 'unsuitable' && $result['spots'][0]['score'] <= 24, 'Unusable depth must be unsuitable, regardless of calm weather');
    check($result['spots'][0]['depth']['castingDepthM'] === (float) $depth, 'Do not round away useful-range boundary failures');
}
[$service, $state] = fixture();
$state->elements = elements(1);
$result = $service->search($nearby, false);
check($result['spots'][0]['access']['permission'] === 'unknown' && $result['spots'][0]['access']['rating'] === 'unknown' && $result['spots'][0]['recommendationStatus'] === 'unverified', 'No tags is not permission or an easy standing place');
check($result['spots'][0]['depth']['seabedType'] === 'unknown' && $result['spots'][0]['depth']['snagRisk'] === 'unknown', 'Beach category must not invent measured sand or snag risk');
foreach ([['fishing' => 'no'], ['access' => 'private'], ['foot' => 'no'], ['fishing:conditional' => 'no @ (May-Sep)'], ['access' => 'yes', 'fishing' => 'private']] as $tags) {
    check(invoke($service, 'isRestricted', $tags), 'Known mapped restrictions must be excluded');
}

// Fixed assessment budget, backfill beyond the requested count, and native-cell counts.
[$service, $state, $personal, $upstream] = fixture();
$state->elements = elements(55);
$state->elements[7]['tags']['fishing'] = 'no';
$state->dryUntilLon = 24 + 5.5 * 0.003;
$small = $service->search($nearby, false);
$depthCalls = $state->depthCalls;
$large = $service->search([...$nearby, 'resultLimit' => 48], false);
check($small['coverage']['assessedCount'] === 48 && $large['coverage']['assessedCount'] === 48, 'Assessment budget must not depend on resultLimit');
check($small['coverage']['rejectedCount'] === 7 && $small['coverage']['restrictedCount'] === 1 && $small['coverage']['unavailableCount'] === 0, 'Coverage distinguishes mapped restrictions, invalid coast, and unavailable data');
check(count($small['spots']) === 5 && count($large['spots']) === 41 && $large['candidateCount'] === 41, 'Backfill from the whole budget, not just the requested first five');
check(array_column($small['spots'], 'id') === array_slice(array_column($large['spots'], 'id'), 0, 5), 'Different limits must not change validation or ordering');
check(!in_array('node:7', array_column($large['spots'], 'id'), true), 'Restricted candidates must never reach results');
check($depthCalls === 47 && $state->depthCalls === $depthCalls, 'At most 48 bounded coverage calls, reusable geographic cache across limits');
foreach ($large['spots'] as $spot) {
    check($spot['depth']['requestedSampleCount'] === 65 && $spot['depth']['sampleCount'] < 65, 'Always sample 8 directions and count unique native cells, not repeated samples');
}
check(count($large['warnings']) > count($small['warnings']), 'Short results must add a coverage warning');
check($personal->reads === [] && $personal->writes === [] && $state->unexpected === [], 'All-mode opt-out avoids personal caches and mocked searches never escape expected providers');

// Point semantics: relocation, no boat shore-casts, short rock/float range, GPS confidence.
[$service, $state] = fixture();
$state->gridMode = 'water';
$result = $service->search($point, false);
check($result['pointAnalysis']['requiresRelocation'] && $result['pointAnalysis']['standingPointStatus'] === 'unverified' && $result['spots'][0]['recommendationStatus'] === 'unsuitable', 'Open-water shore user position requires relocation, not a cast');
$boat = $service->search([...$point, 'technique' => 'boat-fishing'], false);
check(!isset($boat['pointAnalysis']['castRecommendation']) && !isset($boat['pointAnalysis']['approximateZone']) && $boat['pointAnalysis']['standingPointStatus'] === 'not-applicable', 'Boat point analysis must never issue a shore-style cast');
$rock = $service->search([...$point, 'technique' => 'rock-fishing', 'gpsAccuracyM' => 150], false);
check($rock['pointAnalysis']['techniqueRangeM'] === [5, 30] && $rock['spots'][0]['depth']['confidence'] === 'low', 'Rock/float uses 5-30m and GPS uncertainty lowers confidence');
check(!isset($rock['pointAnalysis']['approximateZone']) && max(array_column($rock['spots'][0]['depth']['castingProfile'], 'distanceM')) <= 30, 'A 115m grid cannot resolve a 5-30m casting instruction');
$samples = [];
foreach ([5 => -6, 15 => -6, 30 => 3, 50 => -8, 100 => -9, 150 => -10] as $distance => $elevation) {
    $samples[] = ['distanceM' => $distance, 'bearing' => 90, 'lat' => 37, 'lon' => 24, 'elevation' => $elevation, 'cellId' => 'cell:'.$distance];
}
check(invoke($service, 'choosePointCast', $samples, $profiles['surfcasting'], [50, 150]) === null, 'No casting through an intermediate dry sample');
$samples[2]['elevation'] = null;
check(invoke($service, 'choosePointCast', $samples, $profiles['surfcasting'], [50, 150]) === null, 'No casting through an intermediate unavailable sample');
foreach ($samples as &$sample) {
    $sample['elevation'] = -6;
    $sample['cellId'] = 'same-native-cell';
}
unset($sample);
$choice = invoke($service, 'choosePointCast', $samples, $profiles['surfcasting'], [50, 150]);
check(count($choice['samples']) === 1 && $choice['confidence'] === 'low', 'Repeated points in one native cell cannot inflate evidence or confidence');
$samples[4]['elevation'] = 2;
$choice = invoke($service, 'choosePointCast', $samples, $profiles['surfcasting'], [50, 150]);
check($choice['pathBlocked'] && $choice['target']['distanceM'] === 50, 'An earlier usable depth must not extend an approximate zone beyond a dry sample');

// No persistent empty or partial-failure caches, and recovery without a seven-day wait.
foreach (['nearby', 'point'] as $mode) {
    [$service, $state, $personal, $upstream] = fixture();
    $state->elements = elements(2);
    $state->depthFailure = true;
    $request = [...$point, 'mode' => $mode];
    $first = $service->search($request, true);
    $calls = $state->depthCalls;
    $second = $service->search($request, true);
    check($state->depthCalls === 2 * $calls && $personal->writes === [], 'Unavailable '.$mode.' depths must be retried, never negative-cached');
    check($second['coverage']['unavailableCount'] === ($mode === 'point' ? 1 : 2), 'Response must expose unavailable coverage');
    if ($mode === 'point') {
        check(!isset($second['spots'][0]['depth']['castingDepthM']) && !isset($second['spots'][0]['depth']['closestFishableDepthM']), 'Unavailable point depths are omitted, never fabricated');
    }
    $state->depthFailure = false;
    $recovered = $service->search($request, true);
    check($recovered['spots'] !== [] && $recovered['coverage']['unavailableCount'] === 0, 'Recovery must be visible immediately');
    [$service, $state, $personal, $upstream] = fixture();
    $state->elements = elements(2);
    $state->partial = true;
    $service->search($request, true);
    $calls = $state->depthCalls;
    $partial = $service->search($request, true);
    check($state->depthCalls === 2 * $calls && $personal->writes === [] && $partial['coverage']['unavailableCount'] > 0, 'Partial '.$mode.' grids must not persist for seven days');
}
[$service, $state, $personal, $upstream] = fixture();
$service->search($nearby, true);
$empty = $service->search($nearby, true);
check($state->overpassCalls === 2 && $personal->writes === [] && $upstream->writes === [] && $empty['spots'] === [], 'Empty OSM discovery must not be negative-cached');

// Cache provenance, stale provider timestamps, and opt-out even with populated caches.
foreach (['nearby', 'point'] as $mode) {
    [$service, $state, $personal] = fixture();
    $state->elements = elements(1);
    $request = [...$point, 'mode' => $mode];
    $fresh = $service->search($request, true);
    $count = count($state->requests);
    $hit = $service->search($request, true);
    check($hit['cache']['hit'] && $hit['cache']['maxAgeSeconds'] <= 300 && count($state->requests) === $count, 'Complete '.$mode.' results may use a short personal cache');
    check($hit['generatedAt'] === $fresh['generatedAt'] && $hit['spots'][0]['weather'] === $fresh['spots'][0]['weather'] && $hit['spots'][0]['marine'] === $fresh['spots'][0]['marine'], 'Cache reads must never refresh model or fetch timestamps');
    $reads = count($personal->reads);
    $writes = count($personal->writes);
    $bypass = $service->search($request, false);
    check(!$bypass['cache']['hit'] && $bypass['cache']['maxAgeSeconds'] === 0 && count($personal->reads) === $reads && count($personal->writes) === $writes, 'False must bypass populated personal caches for '.$mode);
    $service->search([...$request, 'saveHistory' => false], true);
    check(count($personal->reads) === $reads && count($personal->writes) === $writes, 'saveHistory=false must also disable personal caching');
}
[$service, $state, $personal] = fixture();
$state->validTime = time() - 7200;
$old = $service->search($point, true);
check($old['spots'][0]['conditionsStatus'] === 'unknown' && $old['spots'][0]['weather']['stale'] && $personal->writes === [], 'A just-fetched old model timestamp is not fresh conditions');
check($old['spots'][0]['weather']['validAt'] === gmdate('Y-m-d\TH:i:s\Z', $state->validTime), 'Stale validAt must remain visible, not replaced with now');
[$service, $state] = fixture();
$state->validTime = time();
$state->marineValidTime = time() - 2700;
$mismatched = $service->search($point, false);
check($mismatched['spots'][0]['conditionsStatus'] === 'unknown', 'Individually recent but temporally mismatched sources cannot establish one conditions check');

// Eligible sorts before higher raw-fit but unverified/unsuitable candidates.
[$service, $state] = fixture();
$intent = invoke($service, 'requestIntent', ['technique' => 'boat-fishing', 'location' => 'Mock'], 25.0);
$conditions = invoke($service, 'conditions', ['lat' => 37, 'lon' => 24]);
$candidate = ['id' => 'eligible', 'category' => 'beach', 'distanceKm' => 3, 'tags' => ['access' => 'yes', 'fishing' => 'yes']];
$depth = ['closest' => 20, 'casting' => 20, 'max' => 20, 'slope' => 'flat', 'hasNearbyWater' => true, 'exactIsWater' => true, 'waterDistanceM' => 0, 'landDistanceM' => null, 'points' => [], 'sampleCount' => 5, 'confidence' => 'medium', 'complete' => true, 'requestedSampleCount' => 65, 'availableSampleCount' => 65, 'fetchedAt' => gmdate('Y-m-d\TH:i:s\Z'), 'bearing' => null];
$ranked = invoke($service, 'rank', [[...$candidate, 'id' => 'unsuitable', 'category' => 'reef'], [...$candidate, 'id' => 'unverified', 'category' => 'reef', 'tags' => []], $candidate], $intent, $conditions, ['eligible' => $depth, 'unverified' => $depth, 'unsuitable' => [...$depth, 'casting' => 150]], 3);
check(array_column($ranked, 'recommendationStatus') === ['eligible', 'unverified', 'unsuitable'] && $ranked[0]['scoreMeaning'] === 'heuristic-fit', 'Status gates must determine rank before fit score');

fwrite(STDOUT, sprintf("search.php: %d assertions passed (mocked HTTP only).\n", $assertions));
