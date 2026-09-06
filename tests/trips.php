<?php

declare(strict_types=1);

use App\Exception\ApiException;
use App\Repository\FishingRepository;
use App\Service\TripMediaStorage;
use App\Service\TripRules;
use Doctrine\DBAL\DriverManager;
use Symfony\Component\HttpFoundation\File\UploadedFile;
use Symfony\Component\Uid\Uuid;

require dirname(__DIR__).'/vendor/autoload.php';

if (!getenv('IS_DDEV_PROJECT')) {
    throw new RuntimeException('Run through local DDEV: ddev exec php tests/trips.php');
}

// Never load DATABASE_URL. Every touched table is shadowed on this single local connection.
$db = DriverManager::getConnection([
    'driver' => 'pdo_mysql', 'host' => 'db', 'port' => 3306,
    'dbname' => 'db', 'user' => 'db', 'password' => 'db', 'charset' => 'utf8mb4',
]);
$checks = 0;
$check = static function (bool $condition, string $message) use (&$checks): void {
    ++$checks;
    if (!$condition) {
        throw new RuntimeException($message);
    }
};
$expect = static function (callable $action, int $status = 400) use ($check): void {
    try {
        $action();
    } catch (ApiException $error) {
        $check($error->status() === $status, 'Expected HTTP '.$status.', got '.$error->status().': '.$error->getMessage());

        return;
    }
    throw new RuntimeException('Expected HTTP '.$status.', but the operation succeeded.');
};
$uuid = static fn (): string => Uuid::v4()->toRfc4122();
$testRoot = sys_get_temp_dir().'/opencode';
$mediaDir = $testRoot.'/trip-tests-'.$uuid();
$storage = new TripMediaStorage($mediaDir);
$rules = new TripRules();
$repository = new FishingRepository($db, $storage, $rules);
$base = [
    'tripDate' => '2025-06-01T10:00:00Z', 'technique' => 'spinning', 'techniqueLabel' => 'Spinning',
    'locationName' => 'Private reef at 37.9876543,23.7654321', 'lat' => 37.9876543, 'lon' => 23.7654321,
    'spotId' => 'private-source:37.9876543,23.7654321', 'score' => 62, 'notes' => 'Coordinates 37.9876543,23.7654321',
];
$historical = [...$base, 'recordingMode' => 'historical', 'endedAt' => '2025-06-01T12:00:00Z', 'outcome' => 'not-recorded'];
$fish = ['id' => 'stable-fish', 'species' => 'Sea bass', 'count' => 2, 'released' => true, 'weightKg' => 1.5, 'weightBasis' => 'total', 'lengthCm' => 32, 'lengthBasis' => 'average', 'notes' => 'Caught at 37.9876543,23.7654321'];
$json = static fn (mixed $value): string => json_encode($value, JSON_THROW_ON_ERROR);

try {
    $db->executeStatement("SET time_zone = '+00:00'");
    $schemas = [
        'users' => "id CHAR(36) PRIMARY KEY, username VARCHAR(64) NOT NULL UNIQUE, display_name VARCHAR(100) NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, password_hash VARCHAR(255) NULL, role VARCHAR(16) NOT NULL DEFAULT 'user'",
        'places' => "id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, external_key VARCHAR(160) NOT NULL UNIQUE, name VARCHAR(255) NOT NULL, category VARCHAR(40) NOT NULL, latitude DECIMAL(10,7) NOT NULL, longitude DECIMAL(10,7) NOT NULL, data_quality VARCHAR(24) NOT NULL DEFAULT 'generated', tags_json JSON NULL, provenance VARCHAR(16) NOT NULL DEFAULT 'legacy'",
        'trips' => "id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, place_id BIGINT UNSIGNED NULL, visibility ENUM('private','public') NOT NULL DEFAULT 'private', status ENUM('active','completed') NOT NULL DEFAULT 'completed', trip_date DATETIME NOT NULL, completed_at DATETIME(3) NULL, technique VARCHAR(40) NOT NULL, technique_label VARCHAR(100) NOT NULL, location_name VARCHAR(255) NOT NULL, latitude DECIMAL(10,7) NOT NULL, longitude DECIMAL(10,7) NOT NULL, source_spot_id VARCHAR(160) NULL, score SMALLINT UNSIGNED NOT NULL DEFAULT 0, fish_records_json JSON NOT NULL, notes TEXT NOT NULL, conditions_label TEXT NOT NULL, depth_label TEXT NOT NULL, seabed_label VARCHAR(255) NOT NULL, weather_json JSON NOT NULL, marine_json JSON NOT NULL, recording_mode VARCHAR(16) NOT NULL DEFAULT 'live', ended_at DATETIME NULL, outcome VARCHAR(20) NOT NULL DEFAULT 'not-recorded', fishing_minutes INT UNSIGNED NULL, angler_count SMALLINT UNSIGNED NULL, conditions_recorded_at DATETIME NULL, public_location_precision VARCHAR(16) NOT NULL DEFAULT 'approximate', share_notes BOOLEAN NOT NULL DEFAULT FALSE, shared_media_json JSON NULL",
        'trip_media' => 'id CHAR(36) PRIMARY KEY, trip_id CHAR(36) NOT NULL, fish_record_id VARCHAR(160) NULL, file_name VARCHAR(255) NOT NULL, thumbnail_name VARCHAR(255) NOT NULL, original_name VARCHAR(255) NOT NULL, mime_type VARCHAR(64) NOT NULL, file_size BIGINT UNSIGNED NOT NULL, width INT UNSIGNED NOT NULL, height INT UNSIGNED NOT NULL, sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0',
        'scans' => 'id CHAR(36) PRIMARY KEY, user_id CHAR(36) NULL, query_text VARCHAR(500) NOT NULL, technique VARCHAR(40) NOT NULL, location_label VARCHAR(255) NOT NULL, center_latitude DECIMAL(10,7) NOT NULL, center_longitude DECIMAL(10,7) NOT NULL, radius_km SMALLINT UNSIGNED NOT NULL, result_limit SMALLINT UNSIGNED NOT NULL, result_count SMALLINT UNSIGNED NOT NULL, request_json JSON NOT NULL, response_json JSON NOT NULL',
        'scan_places' => 'scan_id CHAR(36) NOT NULL, place_id BIGINT UNSIGNED NOT NULL, rank_number SMALLINT UNSIGNED NOT NULL, score SMALLINT UNSIGNED NOT NULL, snapshot_json JSON NOT NULL, PRIMARY KEY (scan_id, place_id)',
        'saved_places' => 'id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, name VARCHAR(255) NOT NULL, latitude DECIMAL(10,7) NOT NULL, longitude DECIMAL(10,7) NOT NULL, technique VARCHAR(40) NOT NULL, notes TEXT NOT NULL, UNIQUE KEY saved_coordinates (user_id, latitude, longitude, technique)',
    ];
    foreach ($schemas as $table => $columns) {
        // Temporary tables do not support foreign keys. Repository cleanup is tested explicitly.
        $db->executeStatement('CREATE TEMPORARY TABLE '.$table.' ('.$columns.', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
    }
    $users = [];
    foreach (['owner', 'other', 'insights', 'disabled'] as $name) {
        $users[$name] = ['id' => $uuid(), 'username' => $name, 'displayName' => $name, 'active' => $name !== 'disabled'];
        $db->insert('users', ['id' => $users[$name]['id'], 'username' => $name, 'display_name' => $name, 'active' => (int) $users[$name]['active']]);
    }
    $owner = $users['owner'];
    $other = $users['other'];

    $defaults = $rules->create($base);
    $check($defaults['recordingMode'] === 'live' && $defaults['visibility'] === 'private' && $defaults['outcome'] === 'not-recorded', 'Live private unlogged defaults.');
    $check($defaults['endedAt'] === null && $defaults['fishingMinutes'] === null && $defaults['anglerCount'] === null && $defaults['conditionsRecordedAt'] === null, 'No invented time or effort.');
    $check($defaults['publicLocationPrecision'] === 'approximate' && !$defaults['shareNotes'] && $defaults['sharedMediaIds'] === [], 'Conservative sharing defaults.');
    $check($rules->create($defaults) === $defaults, 'API normalization is idempotent when repository revalidates.');
    foreach (['recordingMode', 'visibility', 'outcome', 'shareNotes', 'sharedMediaIds', 'fishRecords', 'publicLocationPrecision', 'notes', 'weather', 'score'] as $field) {
        $expect(fn () => $rules->create([...$historical, $field => null]));
    }
    foreach (['2025-02-29T10:00:00Z', '2025-04-31T10:00:00Z', '2025-01-01T24:00:00Z', '2025-01-01T10:60:00Z', '2025-01-01T10:00:60Z', '2025-01-01T10:00:00+14:01', '2025-01-01', 'tomorrow', '2025-01-01T10:00:00', '0000-01-01T10:00:00Z', gmdate('Y-m-d\TH:i:s\Z', time() + 120)] as $date) {
        $expect(fn () => $rules->create([...$base, 'tripDate' => $date]));
        $expect(fn () => $rules->update(['endedAt' => $date]));
    }
    $check($rules->create([...$base, 'tripDate' => '2024-02-29T12:00:00.123+02:00'])['tripDate'] === '2024-02-29T10:00:00.123Z', 'Real leap day and explicit offset normalize to UTC.');
    $check($rules->create([...$base, 'tripDate' => gmdate('Y-m-d\TH:i:s\Z', time() + 30)])['tripDate'] !== '', 'Small client clock skew is tolerated.');
    foreach ([true, false, NAN, INF, -INF, 'NaN', '1e999', [], 91] as $number) {
        $expect(fn () => $rules->create([...$base, 'lat' => $number]));
    }
    foreach ([0, -1, 1.5, true, 101] as $anglers) {
        $expect(fn () => $rules->update(['anglerCount' => $anglers]));
    }
    foreach ([0, -1, 1.5, true, INF, 4294967296] as $minutes) {
        $expect(fn () => $rules->update(['fishingMinutes' => $minutes]));
    }
    $expect(fn () => $rules->update(['shareNotes' => 'false']));
    $expect(fn () => $rules->update(['recordingMode' => 'historical']));
    $expect(fn () => $rules->update(['status' => 'active']));
    $expect(fn () => $rules->update([]));
    $expect(fn () => $rules->create([...$base, 'visibility' => 'public']));
    $expect(fn () => $rules->create([...$historical, 'endedAt' => null]));
    $withoutOutcome = $historical;
    unset($withoutOutcome['outcome']);
    $expect(fn () => $rules->create($withoutOutcome));
    $expect(fn () => $rules->create([...$historical, 'endedAt' => '2025-06-01T09:59:59Z']));
    $expect(fn () => $rules->create([...$historical, 'fishingMinutes' => 122]));
    $check($rules->create([...$historical, 'fishingMinutes' => 121, 'anglerCount' => 100])['fishingMinutes'] === 121, 'One minute effort rounding and maximum anglers.');
    $expect(fn () => $rules->create([...$base, 'fishingMinutes' => 1]));
    $expect(fn () => $rules->create([...$historical, 'outcome' => 'recorded']));
    $expect(fn () => $rules->create([...$historical, 'outcome' => 'zero', 'fishRecords' => [$fish]]));
    $expect(fn () => $rules->create([...$historical, 'fishRecords' => [$fish]]));
    foreach ([0, 1000, true, 1.1, INF] as $count) {
        $expect(fn () => $rules->create([...$base, 'fishRecords' => [[...$fish, 'count' => $count]]]));
    }
    foreach (['true', 1, [true, false], null] as $released) {
        $expect(fn () => $rules->update(['fishRecords' => [[...$fish, 'released' => $released]]]));
    }
    $legacyFish = $fish;
    unset($legacyFish['weightBasis'], $legacyFish['lengthBasis']);
    $expect(fn () => $rules->create([...$base, 'fishRecords' => [$legacyFish]]));
    $expect(fn () => $rules->create([...$base, 'fishRecords' => [$fish, $fish]]));
    $expect(fn () => $rules->update(['fishRecords' => ['not-a-list' => $fish]]));
    $expect(fn () => $rules->update(['fishRecords' => array_fill(0, 501, $fish)]));
    $expect(fn () => $rules->update(['fishRecords' => [[...$fish, 'weightKg' => true]]]));
    $expect(fn () => $rules->update(['fishRecords' => [[...$fish, 'lengthCm' => 1001]]]));
    $expect(fn () => $rules->update(['fishRecords' => [[...$fish, 'lengthBasis' => 'total']]]));
    $check($rules->create([...$base, 'fishRecords' => [[...$fish, 'weightBasis' => 'unknown']]])['fishRecords'][0]['weightBasis'] === 'unknown', 'Explicit unknown is not a fabricated group basis.');
    $check($rules->create([...$base, 'fishRecords' => [[...$legacyFish, 'count' => 1]]])['fishRecords'][0]['weightBasis'] === 'individual', 'Single-fish measurement has an unambiguous basis.');
    $expect(fn () => $rules->create([...$base, 'notes' => str_repeat('x', 20001)]));
    $expect(fn () => $rules->create([...$base, 'weather' => ['windSpeedKmh' => true]]));
    $expect(fn () => $rules->create([...$base, 'weather' => ['extra' => NAN]]));
    $expect(fn () => $rules->create([...$base, 'weather' => ['extra' => str_repeat('x', 32769)]]));
    $expect(fn () => $rules->update(['sharedMediaIds' => ['not-a-uuid']]));
    $mediaId = $uuid();
    $expect(fn () => $rules->update(['sharedMediaIds' => [$mediaId, strtoupper($mediaId)]]));
    $expect(fn () => $rules->update(['sharedMediaIds' => array_fill(0, 2521, $mediaId)]));
    $expect(fn () => $rules->create([...$historical, 'sharedMediaIds' => [$mediaId]]));

    $live = $repository->createTrip($owner, $rules->create($base));
    $check($live['status'] === 'active' && $live['completedAt'] === null && $live['endedAt'] === null, 'Live creation never completes or invents an end.');
    $expect(fn () => $repository->createTrip($owner, $base), 409);
    $expect(fn () => $repository->createTrip($users['disabled'], $base), 401);
    $expect(fn () => $repository->getTrip($live['id'], null), 404);
    $expect(fn () => $repository->getTrip($live['id'], $other), 404);
    $expect(fn () => $repository->updateTrip($live['id'], $other, ['notes' => 'IDOR']), 404);
    $expect(fn () => $repository->deleteTrip($live['id'], $other), 404);
    $expect(fn () => $repository->listTrips(null, 'mine'), 401);
    $expect(fn () => $repository->updateTrip($live['id'], $owner, ['visibility' => 'public']));
    $expect(fn () => $repository->updateTrip($live['id'], $owner, ['fishRecords' => [$legacyFish]]));
    $expect(fn () => $repository->updateTrip($live['id'], $owner, ['status' => 'completed']));
    $expect(fn () => $repository->updateTrip($live['id'], $owner, ['status' => 'completed', 'fishRecords' => []]));
    $historicalTrip = $repository->createTrip($owner, [...$historical, 'visibility' => 'public', 'outcome' => 'recorded', 'fishRecords' => [$fish], 'fishingMinutes' => 90, 'anglerCount' => 2]);
    $check($historicalTrip['status'] === 'completed' && $historicalTrip['endedAt'] === '2025-06-01T12:00:00.000Z', 'Historical insertion completes directly alongside an active trip.');
    $check($repository->getActiveTrip($owner)['id'] === $live['id'], 'Historical insertion does not disturb active trip.');
    $check((int) $db->fetchOne('SELECT COUNT(*) FROM places') === 0, 'Public personal trip never upserts a catalog place.');
    $public = $repository->getTrip($historicalTrip['id'], null);
    $check($public['lat'] === 37.99 && $public['lon'] === 23.77 && $public['locationName'] !== $base['locationName'], 'Public coordinates approximate and personal name hidden.');
    $check($public['spotId'] !== $base['spotId'] && $public['userId'] === '' && $public['username'] === '' && $public['displayName'] === '', 'Public source and personal identity hidden.');
    $check($public['notes'] === '' && !isset($public['fishRecords'][0]['notes']), 'Trip and fish coordinate notes are not shared by default.');
    $check($repository->getTrip($historicalTrip['id'], $other) === $public, 'Other authenticated users get the same public projection as anonymous users.');
    $check($repository->getTrip($historicalTrip['id'], $owner)['lat'] === $base['lat'], 'Owner always sees original precision.');
    $check(count($repository->listTrips($owner, 'mine')) === 2 && count($repository->listTrips($other, 'visible')) === 1, 'Trip list visibility is owner scoped.');
    $check($repository->listTrips(null, 'public')[0] === $public, 'List and detail use identical public transformations.');

    // Files are generated only in this test's unique temporary directory, never application media storage.
    if (!is_dir($testRoot)) {
        mkdir($testRoot, 0700);
    }
    mkdir($mediaDir, 0700);
    $image = imagecreatetruecolor(2, 2);
    imagepng($image, $mediaDir.'/upload.png');
    imagedestroy($image);
    $upload = static fn (): UploadedFile => new UploadedFile($mediaDir.'/upload.png', '37.9876543-23.7654321.png', 'image/png', null, true);
    $expect(fn () => $repository->addTripMedia($historicalTrip['id'], $other, null, $upload()), 404);
    $expect(fn () => $repository->addTripMedia($historicalTrip['id'], $owner, 'missing-fish', $upload()), 404);
    $withPhoto = $repository->addTripMedia(strtoupper($historicalTrip['id']), $owner, null, $upload());
    $photo = $withPhoto['images'][0];
    $withFishPhoto = $repository->addTripMedia($historicalTrip['id'], $owner, $fish['id'], $upload());
    $fishPhoto = $withFishPhoto['fishRecords'][0]['images'][0];
    $expect(fn () => $repository->getTripMediaFile($photo['id'], null, false), 404);
    $expect(fn () => $repository->getTripMediaFile($photo['id'], $other, true), 404);
    $check(!$repository->getTripMediaFile($photo['id'], $owner, false)['public'], 'Owner can view unselected media without making it public.');
    $check($repository->getTrip($historicalTrip['id'], null)['images'] === [], 'Public JSON hides unselected media.');
    $repository->updateTrip($historicalTrip['id'], $owner, ['sharedMediaIds' => [$photo['id'], $fishPhoto['id']]]);
    $check($repository->getTripMediaFile($photo['id'], null, false)['public'] && $repository->getTripMediaFile($fishPhoto['id'], $other, true)['public'], 'Selected media origins and thumbnails follow completed-public policy.');
    $public = $repository->getTrip($historicalTrip['id'], null);
    $check(count($public['images']) === 1 && count($public['fishRecords'][0]['images']) === 1 && $public['images'][0]['originalName'] === 'Shared image', 'Only selected photos exposed; filename cannot leak GPS.');
    $otherTrip = $repository->createTrip($other, $historical);
    $otherPhoto = $repository->addTripMedia($otherTrip['id'], $other, null, $upload())['images'][0];
    $expect(fn () => $repository->updateTrip($historicalTrip['id'], $owner, ['sharedMediaIds' => [$otherPhoto['id']]]));
    $expect(fn () => $repository->updateTrip($otherTrip['id'], $other, ['sharedMediaIds' => [$photo['id']]]));
    $expect(fn () => $repository->deleteTripMedia($historicalTrip['id'], $photo['id'], $other), 404);
    $sameOwnerTrip = $repository->createTrip($owner, $historical);
    $expect(fn () => $repository->updateTrip($sameOwnerTrip['id'], $owner, ['sharedMediaIds' => [$photo['id']]]));
    $correction = $repository->updateTrip($historicalTrip['id'], $owner, ['fishRecords' => [[...$fish, 'weightKg' => 1.8]]]);
    $check($correction['fishRecords'][0]['id'] === $fish['id'] && $correction['fishRecords'][0]['images'][0]['id'] === $fishPhoto['id'], 'Stable fish correction preserves its photo.');
    $repository->updateTrip($historicalTrip['id'], $owner, ['publicLocationPrecision' => 'exact', 'shareNotes' => true]);
    $public = $repository->getTrip($historicalTrip['id'], null);
    $check($public['lat'] === $base['lat'] && $public['lon'] === $base['lon'] && $public['notes'] === $base['notes'] && $public['fishRecords'][0]['notes'] === $fish['notes'], 'Exact coordinates and notes require explicit separate consent.');
    $db->update('users', ['active' => 0], ['id' => $owner['id']]);
    $expect(fn () => $repository->getTrip($historicalTrip['id'], null), 404);
    $expect(fn () => $repository->getTripMediaFile($photo['id'], null, false), 404);
    $check($repository->listTrips(null, 'public') === [], 'Inactive owners disappear from public lists.');
    $check($repository->getTrip($historicalTrip['id'], $owner)['id'] === $historicalTrip['id'], 'Owner projection is separate from public eligibility (authentication is API-owned).');
    $db->update('users', ['active' => 1], ['id' => $owner['id']]);
    $repository->updateTrip($historicalTrip['id'], $owner, ['visibility' => 'private']);
    $expect(fn () => $repository->getTripMediaFile($photo['id'], null, true), 404);
    $repository->updateTrip($historicalTrip['id'], $owner, ['visibility' => 'public', 'sharedMediaIds' => []]);
    $expect(fn () => $repository->getTripMediaFile($photo['id'], null, false), 404);
    $repository->updateTrip($historicalTrip['id'], $owner, ['sharedMediaIds' => [$photo['id'], $fishPhoto['id']]]);
    $removed = $repository->updateTrip($historicalTrip['id'], $owner, ['fishRecords' => []]);
    $check($removed['outcome'] === 'not-recorded' && $removed['sharedMediaIds'] === [$photo['id']], 'Removing the last catch restores unknown, not zero, and removes stale shared fish media.');
    $expect(fn () => $repository->getTripMediaFile($fishPhoto['id'], $owner, false), 404);
    $removed = $repository->deleteTripMedia($historicalTrip['id'], $photo['id'], $owner);
    $check($removed['sharedMediaIds'] === [] && $removed['images'] === [], 'Deleting media clears selection metadata too.');
    $expect(fn () => $repository->getTripMediaFile($photo['id'], null, false), 404);

    $db->update('trips', ['visibility' => 'public'], ['id' => $live['id']]);
    $livePhoto = $repository->addTripMedia($live['id'], $owner, null, $upload())['images'][0];
    $db->update('trips', ['shared_media_json' => $json([$livePhoto['id']])], ['id' => $live['id']]);
    $expect(fn () => $repository->getTrip($live['id'], null), 404);
    $expect(fn () => $repository->getTripMediaFile($livePhoto['id'], null, false), 404);
    $check(!in_array($live['id'], array_column($repository->listTrips(null, 'public'), 'id'), true), 'Legacy public active trip filtered from public lists.');
    $check($repository->updateTrip($live['id'], $owner, ['notes' => 'Legacy correction'])['visibility'] === 'public', 'Filtering legacy active public trips never overwrites persisted visibility.');
    $finished = $repository->updateTrip($live['id'], $owner, ['status' => 'completed', 'outcome' => 'zero']);
    $check($finished['endedAt'] === null && $finished['completedAt'] !== null, 'Completion action timestamp is never fabricated as actual endedAt.');
    $check($repository->getActiveTrip($owner) === null, 'Completed trip no longer active.');
    $suppliedEnd = $repository->createTrip($owner, $base);
    $suppliedEnd = $repository->updateTrip($suppliedEnd['id'], $owner, ['status' => 'completed', 'outcome' => 'zero', 'endedAt' => '2025-06-01T12:00:00+02:00', 'fishingMinutes' => 1]);
    $check($suppliedEnd['endedAt'] === '2025-06-01T10:00:00.000Z' && $suppliedEnd['fishingMinutes'] === 1, 'Client-supplied end is honored in UTC, including the one-minute rounding boundary.');
    $expect(fn () => $repository->updateTrip($suppliedEnd['id'], $owner, ['fishingMinutes' => 2]));
    $legacy = $repository->createTrip($owner, $historical);
    $db->update('trips', ['ended_at' => null, 'outcome' => 'not-recorded', 'fish_records_json' => $json([$legacyFish])], ['id' => $legacy['id']]);
    $readLegacy = $repository->getTrip($legacy['id'], $owner);
    $check($readLegacy['outcome'] === 'recorded' && $readLegacy['fishRecords'][0]['weightBasis'] === 'unknown' && $readLegacy['endedAt'] === null, 'Persisted legacy fish get sensible read mapping without invented end or measurement basis.');
    $legacy = $repository->updateTrip($legacy['id'], $owner, ['fishRecords' => [$legacyFish]]);
    $check($legacy['fishRecords'][0]['weightBasis'] === 'unknown', 'Unchanged legacy measured groups remain editable.');
    $expect(fn () => $repository->updateTrip($legacy['id'], $owner, ['fishRecords' => [[...$legacyFish, 'weightKg' => 2]]]));
    $legacy = $repository->updateTrip($legacy['id'], $owner, ['fishRecords' => [[...$legacyFish, 'weightKg' => 2, 'weightBasis' => 'total', 'lengthBasis' => 'average']]]);
    $check((float) $legacy['fishRecords'][0]['weightKg'] === 2.0, 'Corrected legacy measurement accepts explicit group basis.');
    $repository->updateTrip($legacy['id'], $owner, ['fishRecords' => []]);
    $check($repository->updateTrip($legacy['id'], $owner, ['notes' => 'Legacy empty correction', 'endedAt' => null])['outcome'] === 'not-recorded', 'Legacy completed unknown outcome and missing end allow unrelated corrections.');
    $expect(fn () => $repository->updateTrip($historicalTrip['id'], $owner, ['endedAt' => null]));

    $snapshot = ['confidence' => 'medium', 'windSpeedKmh' => 12, 'pressureTrend' => 'stable', 'validAt' => '2025-06-01T10:00:00Z', 'fetchedAt' => '2025-06-01T09:59:00Z', 'sourceCoordinates' => ['lat' => 37.9876543, 'lon' => 23.7654321], 'requestedCoordinates' => ['lat' => 37.9876543, 'lon' => 23.7654321], 'source' => 'private GPS', 'extra' => ['gps' => 'private GPS']];
    $weatherTrip = $repository->createTrip($owner, [...$historical, 'visibility' => 'public', 'conditionsRecordedAt' => '2025-06-01T10:00:00Z', 'weather' => $snapshot]);
    $check((float) $weatherTrip['weather']['windSpeedKmh'] === 12.0 && !$weatherTrip['weather']['tripConditions'] && $weatherTrip['weather']['context'] === 'search-snapshot', 'Aligned explicit snapshot is preserved only as search metadata.');
    $public = $repository->getTrip($weatherTrip['id'], null);
    $check((float) $public['weather']['windSpeedKmh'] === 12.0 && array_intersect(['sourceCoordinates', 'requestedCoordinates', 'source', 'extra'], array_keys($public['weather'])) === [], 'Public snapshot allowlist strips source and nested GPS metadata.');
    $check(!str_contains($json($public), '37.9876543') && !str_contains($json($public), 'private GPS'), 'No exact coordinates leak through alternate public fields.');
    $changed = $repository->updateTrip($weatherTrip['id'], $owner, ['tripDate' => '2025-06-02T10:00:00Z', 'endedAt' => '2025-06-02T12:00:00Z']);
    $check($changed['weather']['confidence'] === 'none' && !isset($changed['weather']['windSpeedKmh']) && str_contains($changed['conditionsLabel'], 'unknown'), 'Correcting trip date invalidates old snapshot rather than retiming it.');
    $expect(fn () => $repository->updateTrip($weatherTrip['id'], $owner, ['tripDate' => '2025-06-03T10:00:00Z']));
    $check($repository->getTrip($weatherTrip['id'], $owner)['tripDate'] === $changed['tripDate'], 'Invalid partial time correction rolls back.');
    foreach ([null, '2025-06-01T10:00:00Z'] as $recordedAt) {
        $current = $rules->create([...$historical, 'conditionsRecordedAt' => $recordedAt, 'weather' => [...$snapshot, 'validAt' => gmdate('Y-m-d\TH:i:s\Z')]]);
        $check($current['weather']['confidence'] === 'none' && !isset($current['weather']['windSpeedKmh']), 'Current forecast is never attached to past historical trip.');
    }
    $check($rules->create([...$historical, 'weather' => $snapshot])['weather']['confidence'] === 'none', 'Even aligned provider time requires explicit conditionsRecordedAt.');
    $unknownSnapshot = $rules->create([...$historical, 'weather' => $snapshot]);
    $check($unknownSnapshot['weather']['sourceSnapshot'] === [...$snapshot, 'windSpeedKmh' => 12.0], 'Unaligned evidence is preserved privately instead of being erased on ordinary diary edits.');
    $check($rules->create($unknownSnapshot)['weather'] === $unknownSnapshot['weather'], 'Unaligned snapshot preservation is idempotent and never nests repeated archives.');

    $scanResponse = ['intent' => ['raw' => 'private query', 'technique' => 'spinning', 'locationText' => 'private GPS', 'radiusKm' => 5], 'location' => ['lat' => 37.1234567, 'lon' => 23.1234567], 'resultLimit' => 10, 'spots' => [
        ['id' => 'node:123', 'name' => 'Public OSM pier', 'category' => 'pier', 'lat' => 37.5, 'lon' => 23.5, 'dataQuality' => 'osm', 'tags' => ['name' => 'Public OSM pier'], 'rank' => 1, 'score' => 50],
        ['id' => 'point:37.1234567,23.1234567', 'name' => 'private GPS', 'category' => 'fallback', 'lat' => 37.1234567, 'lon' => 23.1234567, 'dataQuality' => 'generated', 'tags' => [], 'rank' => 2, 'score' => 40],
    ]];
    $scanRequest = ['mode' => 'nearby', 'saveHistory' => true, 'location' => 'private GPS'];
    $expect(fn () => $repository->recordScan($scanResponse, $scanRequest, null), 401);
    $expect(fn () => $repository->recordScan($scanResponse, $scanRequest, $users['disabled']), 401);
    $scanId = $repository->recordScan($scanResponse, $scanRequest, $owner);
    $scan = $repository->getScan($scanId, $owner);
    $check($scan['request'] === $scanRequest && $scan['response'] === $scanResponse && $scan['mode'] === 'nearby', 'Owner scan detail contains original request, response, and summary mode.');
    $check(array_intersect(['username', 'userId'], array_keys($scan)) === [], 'Scan responses do not emit shared user traces.');
    $expect(fn () => $repository->getScan($scanId, $other), 404);
    $expect(fn () => $repository->deleteScans($other, $scanId), 404);
    $check($repository->listScans($other, 100) === [], 'Scan lists are owner protected.');
    $check(count($repository->listPlaces(500)) === 1 && $repository->listPlaces(500)[0]['name'] === 'Public OSM pier', 'Only trusted OSM candidates enter catalog, never private fallback labels.');
    $pointScan = $repository->recordScan($scanResponse, [...$scanRequest, 'mode' => 'point'], $owner);
    $otherScan = $repository->recordScan($scanResponse, [...$scanRequest, 'mode' => 'point'], $other);
    $check($repository->getScan($pointScan, $owner)['mode'] === 'point' && (int) $db->fetchOne('SELECT COUNT(*) FROM scan_places WHERE scan_id = ?', [$pointScan]) === 0, 'Point history stays private and never updates catalog.');
    $repository->deleteScans($owner, $pointScan);
    $expect(fn () => $repository->getScan($pointScan, $owner), 404);
    $repository->deleteScans($owner);
    $check($repository->listScans($owner, 100) === [] && $repository->getScan($otherScan, $other)['id'] === $otherScan, 'Delete-all search history affects only the owner.');
    $check((int) $db->fetchOne('SELECT COUNT(*) FROM scan_places WHERE scan_id = ?', [$scanId]) === 0 && count($repository->listPlaces(500)) === 1, 'History deletion clears joins but preserves independent OSM catalog.');

    $placeInput = ['name' => 'Private saved coordinates', 'lat' => 37.11111111, 'lon' => 23.22222222, 'technique' => 'eging', 'notes' => 'Secret personal notes'];
    $saved = $repository->savePlace($owner, $placeInput);
    $check(Uuid::isValid($saved['id']) && array_intersect(['userId', 'user_id'], array_keys($saved)) === [], 'Saved place uses private UUID and never returns owner IDs.');
    $same = $repository->savePlace($owner, [...$placeInput, 'lat' => 37.11111112, 'notes' => 'Updated']);
    $check($same['id'] === $saved['id'] && $same['notes'] === $saved['notes'] && count($repository->listSavedPlaces($owner)) === 1, 'Duplicate saves use schema precision and preserve private notes.');
    $check($repository->savePlace($owner, [...$placeInput, 'notes' => ''])['notes'] === $saved['notes'], 'Rechecking then saving with an empty form does not erase notes.');
    foreach ([['lat' => 'invalid'], ['lat' => 91], ['lon' => -181], ['lat' => true], ['lon' => INF], ['technique' => 'unsupported'], ['name' => ''], ['name' => str_repeat('x', 256)], ['notes' => str_repeat('x', 2001)]] as $invalid) {
        $expect(fn () => $repository->savePlace($owner, [...$placeInput, ...$invalid]));
    }
    $otherSaved = $repository->savePlace($other, $placeInput);
    $check($otherSaved['id'] !== $saved['id'] && count($repository->listSavedPlaces($other)) === 1, 'Saved coordinates are independent per user.');
    $expect(fn () => $repository->deleteSavedPlace($saved['id'], $other), 404);
    $check(count($repository->listPlaces(500)) === 1, 'Saved personal places never enter public catalog.');
    $repository->deleteSavedPlace($saved['id'], $owner);
    $check($repository->listSavedPlaces($owner) === [] && count($repository->listSavedPlaces($other)) === 1, 'Saved place deletion is owner scoped.');
    $expect(fn () => $repository->deleteSavedPlace($saved['id'], $owner), 404);

    foreach (['orphan', 'trip-reference', 'scan-reference', 'osm'] as $kind) {
        $db->insert('places', ['external_key' => $kind, 'name' => 'Legacy personal GPS', 'category' => 'custom', 'latitude' => 37, 'longitude' => 23, 'provenance' => $kind === 'osm' ? 'osm' : 'legacy']);
        $placeId = (int) $db->lastInsertId();
        if ($kind !== 'osm') {
            $expect(fn () => $repository->getPlace($placeId), 404);
        }
        $linked = $repository->createTrip($owner, [...$historical, 'visibility' => 'public']);
        $db->update('trips', ['place_id' => $placeId], ['id' => $linked['id']]);
        if ($kind === 'trip-reference') {
            $db->update('trips', ['place_id' => $placeId], ['id' => $otherTrip['id']]);
        } elseif ($kind === 'scan-reference') {
            $db->insert('scan_places', ['scan_id' => $otherScan, 'place_id' => $placeId, 'rank_number' => 1, 'score' => 50, 'snapshot_json' => '{}']);
        }
        $repository->updateTrip($linked['id'], $owner, ['visibility' => 'private']);
        $check($db->fetchOne('SELECT place_id FROM trips WHERE id = ?', [$linked['id']]) === null, 'Privatizing detaches old personal catalog linkage.');
        $check((bool) $db->fetchOne('SELECT id FROM places WHERE id = ?', [$placeId]) === ($kind !== 'orphan'), 'Orphan cleanup preserves independent trip, scan, and OSM references.');
        $repository->deleteTrip($linked['id'], $owner);
    }
    $check(!in_array('trip-reference', array_column($repository->listPlaces(500), 'externalKey'), true), 'Anonymous catalog never lists legacy provenance even when referenced.');

    $insightUser = $users['insights'];
    $check($repository->personalInsights($insightUser)['summary']['catchPerAnglerHour'] === null, 'Empty samples have no invented rate.');
    $rateBase = [...$historical, 'spotId' => 'node:rate', 'locationName' => 'Same label', 'lat' => 37.1, 'lon' => 23.1];
    $repository->createTrip($insightUser, [...$rateBase, 'outcome' => 'recorded', 'fishRecords' => [[...$fish, 'count' => 6]], 'fishingMinutes' => 60, 'anglerCount' => 2]);
    $repository->createTrip($insightUser, [...$rateBase, 'outcome' => 'zero', 'fishingMinutes' => 120, 'anglerCount' => 1]);
    $repository->createTrip($insightUser, [...$rateBase, 'outcome' => 'recorded', 'fishRecords' => [[...$fish, 'count' => 90]]]);
    $repository->createTrip($insightUser, [...$rateBase, 'outcome' => 'not-recorded', 'fishingMinutes' => 120, 'anglerCount' => 100]);
    $repository->createTrip($insightUser, [...$rateBase, 'outcome' => 'zero', 'fishingMinutes' => 120]);
    $repository->createTrip($insightUser, [...$rateBase, 'outcome' => 'zero', 'anglerCount' => 2]);
    $repository->createTrip($insightUser, [...$rateBase, 'lat' => 38.1, 'outcome' => 'zero']);
    $repository->createTrip($insightUser, [...$rateBase, 'technique' => 'eging', 'outcome' => 'zero']);
    $repository->createTrip($insightUser, [...$base, 'fishRecords' => [[...$fish, 'count' => 999]], 'endedAt' => '2025-06-01T12:00:00Z', 'fishingMinutes' => 120, 'anglerCount' => 100]);
    $insights = $repository->personalInsights($insightUser);
    $summary = $insights['summary'];
    $check($summary['completedTrips'] === 8 && $summary['knownOutcomeTrips'] === 7 && $summary['fishCount'] === 96, 'Insights count completed known outcomes, exclude active and retain zero outcomes.');
    $check($summary['effortTrips'] === 2 && $summary['effortHours'] === 3.0 && $summary['anglerHours'] === 4.0 && $summary['catchPerAnglerHour'] === 1.5, 'Rate numerator is six fish from precisely the same two rows as four angler-hours, not all 96 fish.');
    $check(count($insights['groups']) === 3, 'Same labels at different coordinates and different techniques never merge.');
    $groups = array_values(array_filter($insights['groups'], static fn (array $group): bool => $group['tripCount'] === 6));
    $check(count($groups) === 1 && $groups[0]['fishCount'] === 96 && $groups[0]['knownOutcomeTrips'] === 5 && $groups[0]['effortTrips'] === 2 && $groups[0]['catchPerAnglerHour'] === 1.5, 'Group rate and sample counts use matched known-outcome/effort rows.');
    $check(count(array_filter($insights['groups'], static fn (array $group): bool => $group['catchPerAnglerHour'] === null)) === 2, 'Groups without effort do not report zero or fabricated rates.');
    $zeroUser = ['id' => $uuid()];
    $db->insert('users', ['id' => $zeroUser['id'], 'username' => 'zero-sample', 'display_name' => 'Zero sample']);
    $repository->createTrip($zeroUser, [...$rateBase, 'outcome' => 'zero', 'fishingMinutes' => 60, 'anglerCount' => 1]);
    $check($repository->personalInsights($zeroUser)['summary']['catchPerAnglerHour'] === 0.0, 'Observed zero catch with valid effort reports a real zero rate.');
    $deleteId = $otherTrip['id'];
    $repository->deleteTrip($deleteId, $other);
    $expect(fn () => $repository->getTrip($deleteId, $other), 404);
    $expect(fn () => $repository->getTripMediaFile($otherPhoto['id'], $other, false), 404);
    $check((int) $db->fetchOne('SELECT COUNT(*) FROM trip_media WHERE trip_id = ?', [$deleteId]) === 0, 'Trip deletion clears its media metadata.');

    fwrite(STDOUT, 'Trip domain checks passed: '.$checks.". Only connection-local temporary tables and isolated temporary media were used.\n");
} finally {
    $db->close();
    foreach (glob($mediaDir.'/*', GLOB_ONLYDIR) ?: [] as $directory) {
        $storage->deleteTrip(basename($directory));
    }
    if (is_file($mediaDir.'/upload.png')) {
        unlink($mediaDir.'/upload.png');
    }
    if (is_dir($mediaDir)) {
        rmdir($mediaDir);
    }
}
