<?php

declare(strict_types=1);

use App\Repository\FishingRepository;
use App\Service\AuthService;
use App\Service\TripMediaStorage;
use App\Service\TripRules;
use Doctrine\DBAL\DriverManager;
use Symfony\Component\Uid\Uuid;

require dirname(__DIR__).'/vendor/autoload.php';

// This suite commits disposable fixtures so the real HTTP process can see them.
// Never load .env/DATABASE_URL, accept a remote URL, follow redirects, or print credentials.
ini_set('zend.exception_ignore_args', '1');
if (!getenv('IS_DDEV_PROJECT') || getenv('DDEV_SITENAME') !== 'fishing') {
    throw new RuntimeException('Run only in local fishing DDEV: ddev exec php tests/http.php');
}
if (!extension_loaded('curl') || !extension_loaded('gd')) {
    throw new RuntimeException('The local HTTP suite requires the existing curl and GD extensions.');
}

$baseUrl = 'http://127.0.0.1';
$db = DriverManager::getConnection([
    'driver' => 'pdo_mysql', 'host' => 'db', 'port' => 3306,
    'dbname' => 'db', 'user' => 'db', 'password' => 'db', 'charset' => 'utf8mb4',
]);
$mediaRoot = dirname(__DIR__).'/var/trip-media';
$storage = new TripMediaStorage($mediaRoot);
$repository = new FishingRepository($db, $storage, new TripRules());
$auth = new AuthService($db);
$run = 'qa-http-'.bin2hex(random_bytes(8));
$secret = 'private-'.$run;
$uuid = static fn (): string => Uuid::v4()->toRfc4122();
$password = static fn (): string => '  '.bin2hex(random_bytes(20)).'  ';
$json = static fn (mixed $value): string => json_encode($value, JSON_THROW_ON_ERROR);
$checks = 0;
$requests = 0;
$users = [];
$plannedNames = [];
$attemptKeys = [];
$fixtureTrips = [];
$before = null;
$filesBefore = null;
$locked = false;
$failure = null;
$cleanupErrors = [];

$check = static function (bool $condition, string $message) use (&$checks): void {
    if (!$condition) {
        throw new RuntimeException($message);
    }
    ++$checks;
};
$snapshot = static function () use ($db, $json): array {
    $snapshot = [];
    foreach ([
        'users' => ['id'], 'trips' => ['id'], 'scans' => ['id'], 'trip_media' => ['id'],
        'places' => ['id'], 'scan_places' => ['scan_id', 'place_id'], 'saved_places' => ['id'],
        'auth_tokens' => ['token_hash'], 'auth_invitations' => ['token_hash'],
        'auth_login_attempts' => ['attempt_key'], 'doctrine_migration_versions' => ['version'],
    ] as $table => $keys) {
        $snapshot[$table] = [];
        foreach ($db->fetchAllAssociative('SELECT * FROM '.$table.' ORDER BY '.implode(', ', $keys)) as $row) {
            $key = $json(array_intersect_key($row, array_flip($keys)));
            $snapshot[$table][$key] = hash('sha256', $json($row));
        }
    }

    return $snapshot;
};
$mediaSnapshot = static function () use ($mediaRoot): array {
    if (!is_dir($mediaRoot)) {
        throw new RuntimeException('Expected the configured local var/trip-media directory.');
    }
    $files = [];
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($mediaRoot, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::SELF_FIRST);
    foreach ($iterator as $file) {
        if ($file->isLink()) {
            throw new RuntimeException('Refusing HTTP media QA with symlinks in the media directory.');
        }
        $files[substr($file->getPathname(), strlen($mediaRoot) + 1)] = $file->isDir() ? 'directory' : hash_file('sha256', $file->getPathname());
    }
    ksort($files);

    return $files;
};

try {
    $db->executeStatement("SET time_zone = '+00:00'");
    $locked = (int) $db->fetchOne("SELECT GET_LOCK('fishing-http-qa', 0)") === 1;
    if (!$locked) {
        throw new RuntimeException('Another local HTTP QA run is active.');
    }
    $before = $snapshot();
    $filesBefore = $mediaSnapshot();
    fwrite(STDOUT, sprintf("Before: users=%d trips=%d scans=%d media=%d.\n", count($before['users']), count($before['trips']), count($before['scans']), count($before['trip_media'])));

    // A unique, previously unused 127/8 source avoids shared localhost throttling.
    do {
        $sourceIp = '127.'.random_int(32, 250).'.'.random_int(0, 255).'.'.random_int(1, 254);
        $ipKeys = array_map(static fn (string $operation): string => hash('sha256', $operation."\0ip\0".$sourceIp), ['login', 'activate']);
    } while ((int) $db->fetchOne('SELECT COUNT(*) FROM auth_login_attempts WHERE attempt_key IN (?, ?)', $ipKeys) !== 0);
    $attemptKeys = $ipKeys;
    foreach (['admin', 'owner', 'other', 'insights', 'zero', 'missing'] as $role) {
        $name = $run.'-'.$role;
        $check(!$db->fetchOne('SELECT id FROM users WHERE username = ?', [$name]), 'Fixture usernames must not match any existing account.');
        foreach (['login', 'activate'] as $operation) {
            $key = hash('sha256', $operation."\0username\0".$name);
            $check(!$db->fetchOne('SELECT attempt_key FROM auth_login_attempts WHERE attempt_key = ?', [$key]), 'Fixture rate keys must be new.');
            $attemptKeys[] = $key;
        }
        $plannedNames[$role] = $name;
    }

    $http = static function (
        string $method,
        string $path,
        int $expected,
        #[SensitiveParameter] ?string $token = null,
        #[SensitiveParameter] array|string|null $body = null,
        array $extraHeaders = [],
        bool $multipart = false,
    ) use ($baseUrl, $sourceIp, $check, $json, &$requests): array {
        if (!str_starts_with($path, '/api') || str_contains($path, '://') || str_contains($path, "\r") || str_contains($path, "\n")) {
            throw new RuntimeException('Only local /api paths are permitted.');
        }
        $headers = ['Accept: application/json', 'Expect:'];
        if ($token !== null) {
            $headers[] = 'Authorization: Bearer '.$token;
        }
        if ($body !== null && !$multipart) {
            $headers[] = 'Content-Type: application/json';
            $body = is_string($body) ? $body : $json((object) $body);
        }
        $responseHeaders = [];
        $curl = curl_init($baseUrl.$path);
        curl_setopt_array($curl, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP,
            CURLOPT_PROXY => '',
            CURLOPT_INTERFACE => $sourceIp,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_HTTPHEADER => [...$headers, ...$extraHeaders],
            CURLOPT_HEADERFUNCTION => static function ($curl, string $line) use (&$responseHeaders): int {
                if (str_contains($line, ':')) {
                    [$name, $value] = explode(':', $line, 2);
                    $responseHeaders[strtolower(trim($name))][] = trim($value);
                }

                return strlen($line);
            },
        ]);
        if ($body !== null) {
            curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
        }
        ++$requests;
        $content = curl_exec($curl);
        $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $localIp = curl_getinfo($curl, CURLINFO_LOCAL_IP);
        $errorCode = curl_errno($curl);
        curl_close($curl);
        if (!is_string($content)) {
            throw new RuntimeException($method.' '.$path.': local HTTP transport failed (curl '.$errorCode.').');
        }
        $check($localIp === $sourceIp, 'HTTP requests must use the unique fixture loopback address.');
        $check($status === $expected, $method.' '.$path.': expected HTTP '.$expected.', got '.$status.'.');
        $check(str_contains(implode(', ', $responseHeaders['cache-control'] ?? []), 'no-store'), $method.' '.$path.': API responses must be no-store.');
        $check(!isset($responseHeaders['set-cookie']), 'Bearer API responses must not create cookie sessions.');
        $decoded = null;
        if ($status !== 204 && str_contains(implode(', ', $responseHeaders['content-type'] ?? []), 'application/json')) {
            $decoded = json_decode($content, true, 32, JSON_THROW_ON_ERROR);
            $check(is_array($decoded), $method.' '.$path.': expected a JSON object.');
        }
        if ($status >= 400) {
            $check(is_string($decoded['error'] ?? null), $method.' '.$path.': errors must have the JSON error contract.');
        }
        if ($status === 204) {
            $check($content === '', $method.' '.$path.': 204 must have no response body.');
        }

        return ['json' => $decoded, 'headers' => $responseHeaders, 'body' => $content];
    };
    $api = $http('GET', '/api', 200);
    $check(($api['json']['name'] ?? null) === 'Fishing Spotter API' && str_contains($api['json']['identity'] ?? '', 'Bearer'), 'Local server must be the integrated Fishing Spotter API.');
    $cors = $http('OPTIONS', '/api/session', 204, extraHeaders: [
        'Origin: https://localhost', 'Access-Control-Request-Method: POST', 'Access-Control-Request-Headers: authorization,content-type',
    ]);
    $check(($cors['headers']['access-control-allow-origin'][0] ?? null) === 'https://localhost', 'Android localhost origin is allowed explicitly.');
    $check(str_contains(implode(', ', $cors['headers']['access-control-allow-headers'] ?? []), 'Authorization'), 'CORS allows bearer authorization.');
    $check(!isset($cors['headers']['access-control-allow-credentials']), 'CORS must not enable cookie credentials.');
    $cors = $http('GET', '/api', 200, extraHeaders: ['Origin: https://localhost.attacker.invalid']);
    $check(!isset($cors['headers']['access-control-allow-origin']), 'Untrusted origins receive no CORS grant.');

    // Seed only a new UUID administrator. All remaining account operations go through HTTP.
    $adminId = $uuid();
    $db->insert('users', ['id' => $adminId, 'username' => $plannedNames['admin'], 'display_name' => $secret.' admin', 'role' => 'admin', 'active' => 1, 'password_hash' => null]);
    $users['admin'] = ['id' => $adminId, 'username' => $plannedNames['admin']];
    $invite = $auth->invite($plannedNames['admin'], true);
    $adminPassword = $password();
    $activation = $http('POST', '/api/activate', 200, body: ['username' => $plannedNames['admin'], 'invitationToken' => $invite['invitationToken'], 'password' => $adminPassword])['json'];
    $admin = $activation['token'];
    $check($activation['user']['id'] === $adminId && $activation['user']['role'] === 'admin', 'Operator invitation activates the new administrator.');
    $check((bool) $db->fetchOne('SELECT attempt_key FROM auth_login_attempts WHERE attempt_key = ?', [$ipKeys[1]]), 'Server-side limiter uses this test\'s private loopback bucket.');
    $check($db->fetchOne('SELECT token_hash FROM auth_tokens WHERE user_id = ?', [$adminId]) === hash('sha256', $admin), 'HTTP activation stores only a bearer hash.');

    $http('GET', '/api/session', 401, extraHeaders: ['X-Fishing-User: '.$plannedNames['admin']]);
    foreach (['/api/users', '/api/trips?scope=mine', '/api/trips/active', '/api/scans', '/api/saved-places', '/api/insights'] as $path) {
        $http('GET', $path, 401, extraHeaders: ['X-Fishing-User: '.$plannedNames['admin']]);
    }
    $http('POST', '/api/users', 401, body: ['username' => $plannedNames['owner']]);
    $http('POST', '/api/users', 400, $admin, ['username' => $plannedNames['owner'], 'role' => 'admin']);
    $tokens = [];
    $passwords = [];
    foreach (['owner', 'other', 'insights', 'zero'] as $role) {
        $created = $http('POST', '/api/users', 201, $admin, ['username' => $plannedNames[$role], 'displayName' => $secret.' '.$role])['json'];
        $users[$role] = $created['user'];
        $check($created['user']['username'] === $plannedNames[$role] && $created['user']['role'] === 'user' && $created['user']['active'] === true, 'API creates an active ordinary user.');
        $passwords[$role] = $password();
        if ($role === 'owner') {
            $unactivatedError = $http('POST', '/api/session', 401, body: ['username' => $plannedNames[$role], 'password' => $passwords[$role]])['json'];
        }
        $session = $http('POST', '/api/activate', 200, body: ['username' => $plannedNames[$role], 'invitationToken' => $created['invitationToken'], 'password' => $passwords[$role]])['json'];
        $tokens[$role] = $session['token'];
        $check(array_keys($session['user']) === ['id', 'username', 'displayName', 'active', 'role', 'createdAt', 'updatedAt'], 'HTTP ApiUser exposes only approved fields.');
        if ($role === 'owner') {
            $http('POST', '/api/activate', 401, body: ['username' => $plannedNames[$role], 'invitationToken' => $created['invitationToken'], 'password' => $passwords[$role]]);
        }
    }
    $owner = $tokens['owner'];
    $other = $tokens['other'];
    $ownerId = $users['owner']['id'];
    $otherId = $users['other']['id'];
    $http('POST', '/api/users', 409, $admin, ['username' => strtoupper($plannedNames['owner'])]);
    $http('GET', '/api/users', 403, $owner);
    $http('POST', '/api/users', 403, $owner, ['username' => $plannedNames['missing']]);
    $http('PATCH', '/api/users/'.$ownerId, 403, $owner, ['role' => 'admin']);
    $http('POST', '/api/users/'.$adminId.'/invitation', 403, $owner);
    $http('DELETE', '/api/spots', 401);
    $http('DELETE', '/api/spots', 403, $owner);
    $adminUsers = $http('GET', '/api/users', 200, $admin)['json']['users'];
    $check(in_array($ownerId, array_column($adminUsers, 'id'), true), 'Admin can list the newly created accounts.');
    $check($http('GET', '/api/session', 200, $owner, extraHeaders: ['X-Fishing-User: '.$plannedNames['admin']])['json']['user']['id'] === $ownerId, 'Legacy header cannot override bearer ownership.');
    $missingError = $http('POST', '/api/session', 401, body: ['username' => $plannedNames['missing'], 'password' => $password()])['json'];
    $wrongError = $http('POST', '/api/session', 401, body: ['username' => $plannedNames['owner'], 'password' => $password()])['json'];
    $check($missingError === $wrongError && $wrongError === $unactivatedError, 'Unknown, incorrect and unactivated login responses are indistinguishable.');
    $login = $http('POST', '/api/session', 200, body: ['username' => $plannedNames['owner'], 'password' => $passwords['owner']])['json'];
    $http('DELETE', '/api/session', 204, $login['token']);
    $http('DELETE', '/api/session', 204, $login['token']);
    $http('GET', '/api/session', 401, $login['token']);
    $http('GET', '/api/session', 200, $owner);
    $reset = $http('POST', '/api/users/'.$ownerId.'/invitation', 200, $admin)['json'];
    $check(is_string($reset['invitationToken'] ?? null) && is_string($reset['expiresAt'] ?? null), 'Admin invitation exposes the activation token and expiry once.');
    $passwords['owner'] = $password();
    $resetSession = $http('POST', '/api/activate', 200, body: ['username' => $plannedNames['owner'], 'invitationToken' => $reset['invitationToken'], 'password' => $passwords['owner']])['json'];
    $http('GET', '/api/session', 401, $owner);
    $owner = $resetSession['token'];

    $base = [
        'tripDate' => '2025-06-01T10:00:00Z', 'technique' => 'spinning', 'techniqueLabel' => 'Spinning '.$secret,
        'locationName' => $secret.' reef at 37.9876543,23.7654321', 'lat' => 37.9876543, 'lon' => 23.7654321,
        'spotId' => $secret, 'score' => 62, 'notes' => $secret.' coordinates 37.9876543,23.7654321',
        'depthLabel' => $secret, 'seabedLabel' => $secret,
    ];
    $historical = [...$base, 'recordingMode' => 'historical', 'endedAt' => '2025-06-01T12:00:00Z', 'outcome' => 'not-recorded'];
    $createTrip = static function (array $input, string $token, string $ownerId) use ($http, &$fixtureTrips): array {
        $trip = $http('POST', '/api/trips', 201, $token, $input)['json']['trip'];
        $fixtureTrips[$trip['id']] = $ownerId;

        return $trip;
    };
    $http('POST', '/api/trips', 401, body: $base, extraHeaders: ['X-Fishing-User: '.$plannedNames['owner']]);
    $http('POST', '/api/trips', 400, $owner, [...$base, 'visibility' => 'public']);
    $live = $createTrip($base, $owner, $ownerId);
    $liveId = $live['id'];
    $check($live['fishRevision'] === hash('sha256', '[]'), 'Owner creation exposes the empty persisted catch revision.');
    $check($http('GET', '/api/trips/active', 200, $owner)['json']['trip']['fishRevision'] === $live['fishRevision'], 'Active owner HTTP DTO exposes the revision.');
    $check($live['status'] === 'active' && $live['visibility'] === 'private' && $live['recordingMode'] === 'live', 'Live trips start active and private.');
    $check($live['endedAt'] === null && $live['completedAt'] === null && $live['fishingMinutes'] === null, 'Live creation does not invent end times or effort.');
    $http('POST', '/api/trips', 409, $owner, $base);
    $http('GET', '/api/trips/'.$liveId, 404);
    $http('GET', '/api/trips/'.$liveId, 404, $other);
    $http('PATCH', '/api/trips/'.$liveId, 404, $other, ['notes' => 'Not the owner']);
    $http('DELETE', '/api/trips/'.$liveId, 404, $other);
    $http('PATCH', '/api/trips/'.$liveId, 400, $owner, ['visibility' => 'public']);
    $http('PATCH', '/api/trips/'.$liveId, 400, $owner, ['status' => 'completed']);
    $http('PATCH', '/api/trips/'.$liveId, 400, $owner, ['status' => 'completed', 'fishRecords' => []]);

    $fish = ['id' => $uuid(), 'species' => 'Sea bass', 'count' => 2, 'released' => true, 'weightKg' => 1.5, 'weightBasis' => 'total', 'lengthCm' => 32, 'lengthBasis' => 'average', 'notes' => $secret, 'bait' => $secret];
    $weather = ['confidence' => 'medium', 'windSpeedKmh' => 12, 'pressureTrend' => 'stable', 'validAt' => $base['tripDate'], 'fetchedAt' => '2025-06-01T09:59:00Z', 'sourceCoordinates' => ['lat' => $base['lat'], 'lon' => $base['lon']], 'source' => $secret, 'extra' => ['gps' => $secret]];
    $journal = $createTrip([...$historical, 'outcome' => 'recorded', 'fishRecords' => [$fish], 'conditionsRecordedAt' => $base['tripDate'], 'weather' => $weather, 'marine' => [...$weather, 'waveHeightM' => 0.4]], $owner, $ownerId);
    $journalId = $journal['id'];
    $check($journal['status'] === 'completed' && $journal['visibility'] === 'private' && $journal['endedAt'] === '2025-06-01T12:00:00.000Z', 'Historical insertion completes privately alongside a live trip.');
    $check($http('GET', '/api/trips/active', 200, $owner)['json']['trip']['id'] === $liveId, 'Historical insertion preserves the live trip.');
    $check(count($http('GET', '/api/trips?scope=mine', 200, $owner)['json']['trips']) === 2, 'Private trip lists contain only the owner\'s records.');
    foreach ([[], ['endedAt' => null]] as $endInput) {
        $unknown = $createTrip([...$base, 'recordingMode' => 'historical', 'outcome' => 'zero', ...$endInput], $owner, $ownerId);
        $id = $unknown['id'];
        $check($unknown['endedAt'] === null && $unknown['completedAt'] !== null && $unknown['fishingMinutes'] === null, 'Historical HTTP create accepts omitted/null end without invented duration.');
        $check($http('PATCH', '/api/trips/'.$id, 200, $owner, ['notes' => 'Unknown duration'])['json']['trip']['endedAt'] === null, 'Omitted end remains unknown.');
        foreach (['2025-06-01T09:00:00Z', '2099-01-01T00:00:00Z', 'not-a-date'] as $badEnd) {
            $http('PATCH', '/api/trips/'.$id, 400, $owner, ['endedAt' => $badEnd]);
        }
        $http('PATCH', '/api/trips/'.$id, 200, $owner, ['endedAt' => $historical['endedAt'], 'fishingMinutes' => 30]);
        $http('PATCH', '/api/trips/'.$id, 400, $owner, ['endedAt' => null]);
        $check($http('GET', '/api/trips/'.$id, 200, $owner)['json']['trip']['fishingMinutes'] === 30, 'Rejected clearing does not erase effort.');
        $cleared = $http('PATCH', '/api/trips/'.$id, 200, $owner, ['endedAt' => null, 'fishingMinutes' => null])['json']['trip'];
        $check($cleared['endedAt'] === null && $cleared['completedAt'] === $unknown['completedAt'], 'Explicit clearing preserves completion action timestamp.');
        $http('DELETE', '/api/trips/'.$id, 204, $owner);
    }
    $check($http('GET', '/api/trips?scope=mine', 200, $other)['json']['trips'] === [], 'Other owners have an independent private trip list.');

    // Generate the upload in memory; only the application writes fixture media files.
    $image = imagecreatetruecolor(2, 2);
    imagefill($image, 0, 0, imagecolorallocate($image, 18, 103, 141));
    ob_start();
    imagepng($image);
    $png = ob_get_clean();
    imagedestroy($image);
    $upload = static function (string $tripId, string $token, ?string $fishId = null, int $expected = 201) use ($http, $png, $secret): array {
        $body = ['image' => new CURLStringFile($png, $secret.'-37.9876543.png', 'image/png')];
        if ($fishId !== null) {
            $body['fishRecordId'] = $fishId;
        }

        return $http('POST', '/api/trips/'.$tripId.'/media', $expected, $token, $body, multipart: true)['json'];
    };

    $firstCatch = $http('PATCH', '/api/trips/'.$liveId, 200, $owner, ['fishRecords' => [$fish], 'expectedFishRevision' => $live['fishRevision']])['json']['trip'];
    $secondFish = [...$fish, 'id' => $uuid()];
    $latestCatch = $http('PATCH', '/api/trips/'.$liveId, 200, $owner, ['fishRecords' => [$fish, $secondFish], 'expectedFishRevision' => $firstCatch['fishRevision']])['json']['trip'];
    $check($firstCatch['fishRevision'] !== $live['fishRevision'] && $latestCatch['fishRevision'] !== $firstCatch['fishRevision'], 'Immediate saves advance the revision returned by PATCH.');
    $catchMedia = $upload($liveId, $owner, $secondFish['id'])['trip'];
    $immediatePhoto = $catchMedia['fishRecords'][1]['images'][0];
    $check($catchMedia['fishRevision'] === $latestCatch['fishRevision'], 'Multipart catch upload does not change the raw catch revision.');
    $rowBeforeConflict = $db->fetchAssociative('SELECT * FROM trips WHERE id = ?', [$liveId]);
    $mediaBeforeConflict = $db->fetchAllAssociative('SELECT * FROM trip_media WHERE trip_id = ?', [$liveId]);
    $filesBeforeConflict = $mediaSnapshot();
    foreach ([[$fish], [], null] as $staleFish) {
        $conflict = $http('PATCH', '/api/trips/'.$liveId, 409, $owner, ['fishRecords' => $staleFish, 'expectedFishRevision' => $firstCatch['fishRevision'], 'notes' => 'Stale overwrite', 'status' => 'completed', 'visibility' => 'public'])['json'];
        $check($conflict === ['error' => 'Catch records have changed. Reload the trip before saving catches.'], 'Conflict response is generic, without latest owner data or revision.');
    }
    foreach ([$firstCatch['fishRevision'], null] as $precondition) {
        $patch = ['fishRecords' => [], 'expectedFishRevision' => $precondition];
        $http('PATCH', '/api/trips/'.$liveId, 401, body: $patch);
        $denied = $http('PATCH', '/api/trips/'.$liveId, 404, $other, $patch)['json'];
        $missing = $http('PATCH', '/api/trips/'.$uuid(), 404, $other, $patch)['json'];
        $check($denied === $missing && array_keys($denied) === ['error'], 'Ownership precedes precondition checks and does not reveal a private trip.');
        $http('PATCH', '/api/trips/'.$liveId, 404, $admin, $patch);
    }
    foreach ([null, false, 123, [], (object) [], '', str_repeat('a', 63), str_repeat('a', 65), str_repeat('g', 64), strtoupper($firstCatch['fishRevision']), $firstCatch['fishRevision']."\n"] as $invalid) {
        $http('PATCH', '/api/trips/'.$liveId, 400, $owner, ['fishRecords' => [], 'expectedFishRevision' => $invalid]);
    }
    $http('PATCH', '/api/trips/'.$liveId, 400, $owner, ['notes' => 'Invalid marker without catches', 'expectedFishRevision' => null]);
    $http('PATCH', '/api/trips/'.$liveId, 400, $owner, ['expectedFishRevision' => $latestCatch['fishRevision']]);
    $http('PATCH', '/api/trips/'.$liveId, 400, $owner, ['fishRevision' => $latestCatch['fishRevision']]);
    $http('PATCH', '/api/trips/'.$liveId, 400, $owner, ['fishRecords' => null, 'expectedFishRevision' => $latestCatch['fishRevision']]);
    $check($db->fetchAssociative('SELECT * FROM trips WHERE id = ?', [$liveId]) === $rowBeforeConflict, 'Rejected HTTP saves leave all trip columns unchanged.');
    $check($db->fetchAllAssociative('SELECT * FROM trip_media WHERE trip_id = ?', [$liveId]) === $mediaBeforeConflict, 'Rejected HTTP saves preserve catch media rows.');
    $check($mediaSnapshot() === $filesBeforeConflict, 'Rejected HTTP saves preserve original/thumbnail files byte for byte.');
    $check($http('GET', '/api/trips/'.$liveId, 200, $owner)['json']['trip'] === $catchMedia, 'Reload returns both latest catches and media after a stale save.');
    $http('GET', $immediatePhoto['url'], 200, $owner);
    $http('GET', $immediatePhoto['thumbnailUrl'], 200, $owner);
    $unrelated = $http('PATCH', '/api/trips/'.$liveId, 200, $owner, ['notes' => 'Unrelated correction', 'expectedFishRevision' => $firstCatch['fishRevision'], 'fishRevision' => 'forged', 'userId' => $otherId, 'lat' => 0])['json']['trip'];
    $check($unrelated['fishRevision'] === $latestCatch['fishRevision'] && $unrelated['userId'] === $ownerId && $unrelated['lat'] === $base['lat'], 'Non-catch PATCH accepts a valid stale marker without broadening writable fields.');
    $catchCorrection = $http('PATCH', '/api/trips/'.$liveId, 200, $owner, ['fishRecords' => [$fish, [...$secondFish, 'notes' => 'Corrected catch']], 'expectedFishRevision' => $latestCatch['fishRevision']])['json']['trip'];
    $check($catchCorrection['fishRevision'] !== $latestCatch['fishRevision'] && $catchCorrection['fishRecords'][1]['images'][0]['id'] === $immediatePhoto['id'], 'Current revision accepts content-only catch corrections without removing photos.');
    $legacyCatchSave = $http('PATCH', '/api/trips/'.$liveId, 200, $owner, ['fishRecords' => [$fish, $secondFish]])['json']['trip'];
    $check($legacyCatchSave['fishRevision'] === $latestCatch['fishRevision'], 'Legacy catch PATCH without expectedFishRevision remains supported.');
    $clearedCatches = $http('PATCH', '/api/trips/'.$liveId, 200, $owner, ['fishRecords' => [], 'expectedFishRevision' => $legacyCatchSave['fishRevision']])['json']['trip'];
    $check($clearedCatches['fishRevision'] === $live['fishRevision'] && $clearedCatches['fishRecords'] === [], 'Current revision accepts deliberate removal and returns the new hash.');
    $http('GET', $immediatePhoto['url'], 404, $owner);
    $http('GET', $immediatePhoto['thumbnailUrl'], 404, $owner);

    $upload($journalId, $other, expected: 404);
    $upload($journalId, $owner, $uuid(), 404);
    $photo = $upload(strtoupper($journalId), $owner)['trip']['images'][0];
    $unselected = $upload($journalId, $owner)['trip']['images'][1];
    $fishPhoto = $upload($journalId, $owner, $fish['id'])['trip']['fishRecords'][0]['images'][0];
    $check($photo['width'] === 2 && $photo['height'] === 2 && $photo['mimeType'] === 'image/png', 'Real multipart upload returns validated PNG metadata.');
    foreach ([$photo, $unselected, $fishPhoto] as $media) {
        $http('GET', $media['url'], 404);
        $http('GET', $media['thumbnailUrl'], 404, $other);
        $binary = $http('GET', $media['url'], 200, $owner);
        $check(str_starts_with($binary['body'], "\x89PNG\r\n\x1a\n"), 'Owner media route streams a PNG, not JSON or HTML.');
        $row = $db->fetchAssociative('SELECT file_name, thumbnail_name FROM trip_media WHERE id = ? AND trip_id = ?', [$media['id'], $journalId]);
        $check(is_file($storage->path($journalId, $row['file_name'])) && is_file($storage->path($journalId, $row['thumbnail_name'])), 'Uploads use the expected local media directory.');
    }
    $correctedFish = [...$fish, 'count' => 3, 'weightKg' => 2.1];
    $corrected = $http('PATCH', '/api/trips/'.$journalId, 200, $owner, ['fishRecords' => [$correctedFish], 'notes' => $secret.' corrected'])['json']['trip'];
    $check($corrected['fishRecords'][0]['id'] === $fish['id'] && $corrected['fishRecords'][0]['images'][0]['id'] === $fishPhoto['id'], 'Catch correction preserves stable fish IDs and attached photos.');
    $check(count($corrected['images']) === 2 && $corrected['fishRecords'][0]['count'] === 3, 'Catch edits preserve unrelated media.');
    $http('PATCH', '/api/trips/'.$journalId, 400, $owner, ['fishRecords' => [$fish, $fish]]);
    $http('PATCH', '/api/trips/'.$journalId, 400, $owner, ['sharedMediaIds' => [$uuid()]]);
    $otherTrip = $createTrip($historical, $other, $otherId);
    $otherPhoto = $upload($otherTrip['id'], $other)['trip']['images'][0];
    $http('PATCH', '/api/trips/'.$journalId, 400, $owner, ['sharedMediaIds' => [$otherPhoto['id']]]);
    $http('DELETE', '/api/trips/'.$journalId.'/media/'.$photo['id'], 404, $other);

    $published = $http('PATCH', '/api/trips/'.$journalId, 200, $owner, ['visibility' => 'public', 'sharedMediaIds' => [$photo['id'], $fishPhoto['id']]])['json']['trip'];
    $check($published['lat'] === $base['lat'] && $published['locationName'] === $base['locationName'], 'Publication does not reduce the owner\'s private data.');
    $publicResponse = $http('GET', '/api/trips/'.$journalId, 200);
    $public = $publicResponse['json']['trip'];
    $check(!array_key_exists('fishRevision', $public), 'Public detail never exposes the owner-only catch revision.');
    $check($public['lat'] === 37.99 && $public['lon'] === 23.77 && $public['locationName'] === 'Approximate fishing area', 'Public projection rounds coordinates and removes the private name.');
    $check($public['username'] === '' && $public['userId'] === '' && $public['displayName'] === '' && $public['spotId'] === $journalId, 'Public projection removes private identity and source identifiers.');
    $check($public['notes'] === '' && array_intersect(['notes', 'bait'], array_keys($public['fishRecords'][0])) === [], 'Trip/catch notes require explicit publication consent.');
    $check(!str_contains($publicResponse['body'], $secret) && !str_contains($publicResponse['body'], '37.9876543') && !str_contains($publicResponse['body'], '23.7654321'), 'Public JSON contains no private strings or exact coordinates in alternate fields.');
    $check((float) $public['weather']['windSpeedKmh'] === 12.0 && $public['weather']['tripConditions'] === false
        && array_intersect(['sourceCoordinates', 'source', 'extra'], [...array_keys($public['weather']), ...array_keys($public['marine'])]) === [], 'Public snapshots keep allowlisted observations without raw provider/GPS data.');
    $check(count($public['images']) === 1 && count($public['fishRecords'][0]['images']) === 1 && $public['images'][0]['originalName'] === 'Shared image', 'Only selected photos appear, with neutral filenames.');
    $check($http('GET', '/api/trips/'.$journalId, 200, $other)['json']['trip'] === $public, 'Another signed-in owner receives the anonymous public projection.');
    $publicList = $http('GET', '/api/trips?scope=public', 200)['json']['trips'];
    $check(array_column($publicList, null, 'id')[$journalId] === $public, 'Public list and detail share the same redaction.');
    foreach (['mine', 'visible', 'public'] as $scope) {
        $ownerTrips = array_column($http('GET', '/api/trips?scope='.$scope, 200, $owner)['json']['trips'], null, 'id');
        $check($ownerTrips[$journalId]['fishRevision'] === $published['fishRevision'], 'Every owner HTTP list scope includes the catch revision.');
    }
    $check($http('PATCH', '/api/trips/'.$journalId, 404, $other, ['fishRecords' => [], 'expectedFishRevision' => $journal['fishRevision']])['json'] === $denied, 'Public visibility does not grant revision conflict or edit access.');
    foreach ([$photo, $fishPhoto] as $media) {
        $http('GET', $media['url'], 200);
        $http('GET', $media['thumbnailUrl'], 200, $other);
    }
    $http('GET', $unselected['url'], 404);
    $http('GET', $unselected['thumbnailUrl'], 404, $other);
    $http('PATCH', '/api/trips/'.$journalId, 200, $owner, ['publicLocationPrecision' => 'exact', 'shareNotes' => true]);
    $exact = $http('GET', '/api/trips/'.$journalId, 200)['json']['trip'];
    $check($exact['lat'] === $base['lat'] && $exact['lon'] === $base['lon'] && $exact['notes'] === $secret.' corrected' && $exact['fishRecords'][0]['notes'] === $secret, 'Exact location and notes are exposed only after explicit consent.');
    $http('PATCH', '/api/trips/'.$journalId, 200, $owner, ['visibility' => 'private']);
    $http('GET', '/api/trips/'.$journalId, 404);
    $http('GET', $photo['url'], 404);
    $http('GET', $fishPhoto['thumbnailUrl'], 404, $other);
    $check(!in_array($journalId, array_column($http('GET', '/api/trips?scope=public', 200)['json']['trips'], 'id'), true), 'Withdrawal immediately removes a trip from public lists.');
    $http('PATCH', '/api/trips/'.$journalId, 200, $owner, ['visibility' => 'public', 'publicLocationPrecision' => 'approximate', 'shareNotes' => false, 'sharedMediaIds' => [$photo['id'], $fishPhoto['id']]]);

    $livePhoto = $upload($liveId, $owner)['trip']['images'][0];
    // Only this test's existing live fixture is changed to emulate a migrated public session.
    $check($db->update('trips', ['visibility' => 'public', 'shared_media_json' => $json([$livePhoto['id']])], ['id' => $liveId, 'user_id' => $ownerId]) === 1, 'Legacy simulation is restricted to the owned live fixture.');
    $http('GET', '/api/trips/'.$liveId, 404);
    $http('GET', $livePhoto['url'], 404);
    $check(!in_array($liveId, array_column($http('GET', '/api/trips?scope=public', 200)['json']['trips'], 'id'), true), 'Legacy active-public sessions remain hidden.');
    $completed = $http('PATCH', '/api/trips/'.$liveId, 200, $owner, ['status' => 'completed', 'outcome' => 'zero'])['json']['trip'];
    $check($completed['status'] === 'completed' && $completed['visibility'] === 'private', 'Legacy public sessions must finish private even when visibility is omitted.');
    $check($completed['outcome'] === 'zero' && $completed['completedAt'] !== null && $completed['endedAt'] === null, 'Completion records an action timestamp, not an invented actual fishing end.');
    $http('GET', '/api/trips/'.$liveId, 404);
    $http('GET', $livePhoto['url'], 404);
    $check($http('GET', '/api/trips/active', 200, $owner)['json']['trip'] === null, 'Completed trips no longer occupy the active slot.');
    $http('PATCH', '/api/trips/'.$liveId, 200, $owner, ['visibility' => 'public']);
    $http('GET', '/api/trips/'.$liveId, 200);
    $http('GET', $livePhoto['url'], 200);
    $separate = $createTrip($base, $owner, $ownerId);
    $finished = $http('PATCH', '/api/trips/'.$separate['id'], 200, $owner, ['status' => 'completed', 'outcome' => 'zero', 'visibility' => 'public', 'endedAt' => null])['json']['trip'];
    $check($finished['endedAt'] === null && $finished['completedAt'] !== null, 'Live HTTP completion accepts explicit null end.');
    $http('PATCH', '/api/trips/'.$separate['id'], 200, $owner, ['endedAt' => $historical['endedAt']]);
    $check($http('PATCH', '/api/trips/'.$separate['id'], 200, $owner, ['endedAt' => null])['json']['trip']['endedAt'] === null, 'Completed live end can be cleared.');
    $check($finished['visibility'] === 'private', 'Explicit same-request completion and publication must also finish private.');
    $http('GET', '/api/trips/'.$separate['id'], 404);

    $place = ['name' => $secret.' bookmark', 'lat' => 37.11111111, 'lon' => 23.22222222, 'technique' => 'eging', 'notes' => $secret.' original notes'];
    foreach ([91, -91, true, null, [], 'NaN', 'Infinity', '1e999'] as $invalid) {
        $http('POST', '/api/saved-places', 400, $owner, [...$place, 'lat' => $invalid]);
    }
    foreach ([181, -181, '1e999'] as $invalid) {
        $http('POST', '/api/saved-places', 400, $owner, [...$place, 'lon' => $invalid]);
    }
    $http('POST', '/api/saved-places', 400, $owner, '{"name":"QA","lat":1e999,"lon":23,"technique":"spinning"}');
    $http('POST', '/api/saved-places', 400, $owner, [...$place, 'technique' => 'unknown']);
    $http('POST', '/api/saved-places', 400, $owner, [...$place, 'notes' => str_repeat('x', 2001)]);
    $saved = $http('POST', '/api/saved-places', 201, $owner, $place)['json']['place'];
    $duplicate = $http('POST', '/api/saved-places', 201, $owner, [...$place, 'lat' => 37.11111112, 'notes' => 'Must not overwrite', 'name' => 'Must not rename'])['json']['place'];
    $check($duplicate === $saved && $duplicate['notes'] === $place['notes'], 'Duplicate bookmarks are idempotent at database precision and preserve original notes/name.');
    $otherSaved = $http('POST', '/api/saved-places', 201, $other, $place)['json']['place'];
    $check($otherSaved['id'] !== $saved['id'], 'The same bookmark belongs independently to each owner.');
    $http('DELETE', '/api/saved-places/'.$saved['id'], 404, $other);
    $check(count($http('GET', '/api/saved-places', 200, $owner)['json']['places']) === 1, 'Private bookmark listing is owner-scoped.');
    $http('DELETE', '/api/saved-places/'.$saved['id'], 204, $owner);
    $http('DELETE', '/api/saved-places/'.$saved['id'], 404, $owner);
    $check($http('GET', '/api/saved-places', 200, $owner)['json']['places'] === [] && $http('GET', '/api/saved-places', 200, $other)['json']['places'][0]['id'] === $otherSaved['id'], 'Deleting a bookmark does not delete another owner\'s copy.');

    // All search HTTP calls fail before providers; seed point history with offline repository data.
    $scanCount = (int) $db->fetchOne('SELECT COUNT(*) FROM scans');
    $http('POST', '/api/spots', 401, body: ['saveHistory' => true, 'mode' => 'invalid-before-provider'], extraHeaders: ['X-Fishing-User: '.$plannedNames['owner']]);
    $http('POST', '/api/spots', 400, body: ['saveHistory' => false, 'mode' => 'invalid-before-provider']);
    $http('POST', '/api/spots', 400, $owner, ['saveHistory' => 'true']);
    $check((int) $db->fetchOne('SELECT COUNT(*) FROM scans') === $scanCount, 'Rejected/anonymous requests never create history.');
    $scanRequest = ['mode' => 'point', 'saveHistory' => true, 'technique' => 'spinning', 'location' => $secret];
    $scanResponse = ['mode' => 'point', 'intent' => ['raw' => $secret, 'technique' => 'spinning', 'locationText' => $secret, 'radiusKm' => 5], 'location' => ['lat' => $base['lat'], 'lon' => $base['lon']], 'resultLimit' => 1, 'spots' => [], 'privacy' => ['historySaved' => true, 'retention' => 'until-deleted']];
    $scanA = $repository->recordScan($scanResponse, $scanRequest, $users['owner']);
    $scanB = $repository->recordScan($scanResponse, $scanRequest, $users['owner']);
    $scanOther = $repository->recordScan($scanResponse, $scanRequest, $users['other']);
    $scan = $http('GET', '/api/scans/'.$scanA, 200, $owner)['json']['scan'];
    $check($scan['request'] === $scanRequest && $scan['response'] === $scanResponse && $scan['mode'] === 'point', 'Private history returns its original request and response.');
    $http('GET', '/api/scans/'.$scanA, 404, $other);
    $http('DELETE', '/api/scans/'.$scanA, 404, $other);
    $check(count($http('GET', '/api/scans', 200, $owner)['json']['scans']) === 2 && count($http('GET', '/api/scans', 200, $other)['json']['scans']) === 1, 'History lists contain only the requesting owner\'s rows.');
    $http('DELETE', '/api/scans/'.$scanA, 204, $owner);
    $http('GET', '/api/scans/'.$scanA, 404, $owner);
    $http('DELETE', '/api/scans', 204, $owner);
    $http('DELETE', '/api/scans', 204, $owner);
    $http('GET', '/api/scans/'.$scanB, 404, $owner);
    $check($http('GET', '/api/scans', 200, $owner)['json']['scans'] === [] && $http('GET', '/api/scans/'.$scanOther, 200, $other)['json']['scan']['id'] === $scanOther, 'Delete-all history never affects another owner.');
    $check($snapshot()['places'] === $before['places'] && $snapshot()['scan_places'] === $before['scan_places'], 'Private trips, bookmarks and point history never change the public catalog.');

    $insightsToken = $tokens['insights'];
    $insightsId = $users['insights']['id'];
    $empty = $http('GET', '/api/insights', 200, $insightsToken)['json'];
    $check($empty['summary']['completedTrips'] === 0 && $empty['summary']['catchPerAnglerHour'] === null && $empty['groups'] === [], 'An empty private cohort has no invented rate.');
    $rateBase = [...$historical, 'spotId' => 'http-cohort', 'locationName' => 'Same label', 'lat' => 37.1, 'lon' => 23.1];
    foreach ([
        ['outcome' => 'recorded', 'fishRecords' => [[...$fish, 'count' => 6]], 'fishingMinutes' => 60, 'anglerCount' => 2],
        ['outcome' => 'zero', 'fishingMinutes' => 120, 'anglerCount' => 1],
        ['outcome' => 'recorded', 'fishRecords' => [[...$fish, 'count' => 90]]],
        ['outcome' => 'not-recorded', 'fishingMinutes' => 120, 'anglerCount' => 100],
        ['outcome' => 'zero', 'fishingMinutes' => 120],
        ['outcome' => 'zero', 'anglerCount' => 2],
        ['outcome' => 'zero', 'lat' => 38.1],
        ['outcome' => 'zero', 'technique' => 'eging'],
    ] as $cohort) {
        $createTrip([...$rateBase, ...$cohort], $insightsToken, $insightsId);
    }
    $createTrip([...$base, 'fishRecords' => [[...$fish, 'count' => 999]], 'endedAt' => $historical['endedAt'], 'fishingMinutes' => 120, 'anglerCount' => 100], $insightsToken, $insightsId);
    $insights = $http('GET', '/api/insights', 200, $insightsToken)['json'];
    $summary = $insights['summary'];
    $check($summary['completedTrips'] === 8 && $summary['knownOutcomeTrips'] === 7 && $summary['fishCount'] === 96, 'Insights retain known zero outcomes and exclude active/unknown catches.');
    $check($summary['effortTrips'] === 2 && (float) $summary['effortHours'] === 3.0 && (float) $summary['anglerHours'] === 4.0 && (float) $summary['catchPerAnglerHour'] === 1.5, 'Effort rate uses six fish from the same four angler-hours, not all 96 fish.');
    $check(count($insights['groups']) === 3, 'Same labels at different coordinates/techniques form separate private cohorts.');
    $cohort = array_values(array_filter($insights['groups'], static fn (array $group): bool => $group['tripCount'] === 6));
    $check(count($cohort) === 1 && $cohort[0]['knownOutcomeTrips'] === 5 && $cohort[0]['effortTrips'] === 2 && (float) $cohort[0]['catchPerAnglerHour'] === 1.5, 'Grouped insights preserve the matched effort cohort.');
    $check(count($http('GET', '/api/trips?scope=mine', 200, $insightsToken)['json']['trips']) === 9, 'Personal insight trips include private records without publishing them.');
    $publicIds = array_column($http('GET', '/api/trips?scope=public', 200)['json']['trips'], 'id');
    $check(array_intersect(array_keys(array_filter($fixtureTrips, static fn (string $owner): bool => $owner === $insightsId)), $publicIds) === [], 'Private insight samples never leak into the public trip list.');
    $createTrip([...$rateBase, 'outcome' => 'zero', 'fishingMinutes' => 60, 'anglerCount' => 1], $tokens['zero'], $users['zero']['id']);
    $zero = $http('GET', '/api/insights', 200, $tokens['zero'])['json']['summary'];
    $check($zero['completedTrips'] === 1 && $zero['knownOutcomeTrips'] === 1 && $zero['catchPerAnglerHour'] !== null && (float) $zero['catchPerAnglerHour'] === 0.0, 'Known zero catch with valid effort reports a real zero, not unknown.');
    $check($http('GET', '/api/insights', 200, $other)['json']['summary']['completedTrips'] === 1, 'Another user\'s insights do not include the fixture cohort.');

    $removed = $http('PATCH', '/api/trips/'.$journalId, 200, $owner, ['fishRecords' => []])['json']['trip'];
    $check($removed['outcome'] === 'not-recorded' && $removed['sharedMediaIds'] === [$photo['id']], 'Removing the final catch resets unknown outcome and prunes selected fish photos.');
    $http('GET', $fishPhoto['url'], 404, $owner);
    $removed = $http('DELETE', '/api/trips/'.$journalId.'/media/'.$unselected['id'], 200, $owner)['json']['trip'];
    $check($removed['fishRevision'] === hash('sha256', '[]'), 'Media deletion also preserves the catch revision.');
    $check(count($removed['images']) === 1 && $removed['images'][0]['id'] === $photo['id'], 'Explicit photo deletion preserves the other selected image.');
    $http('GET', $unselected['url'], 404, $owner);

    $pending = $http('POST', '/api/users/'.$ownerId.'/invitation', 200, $admin)['json'];
    $disabled = $http('PATCH', '/api/users/'.$ownerId, 200, $admin, ['active' => false])['json']['user'];
    $check($disabled['active'] === false, 'Administrator can suspend only the requested fixture account.');
    $http('GET', '/api/session', 401, $owner);
    $inactiveError = $http('POST', '/api/session', 401, body: ['username' => $plannedNames['owner'], 'password' => $passwords['owner']])['json'];
    $check($inactiveError === $missingError, 'Inactive accounts retain the generic login error.');
    $http('POST', '/api/activate', 401, body: ['username' => $plannedNames['owner'], 'invitationToken' => $pending['invitationToken'], 'password' => $passwords['owner']]);
    $http('GET', '/api/trips/'.$journalId, 404);
    $http('GET', '/api/trips/'.$liveId, 404, $other);
    $http('GET', $photo['url'], 404);
    $http('GET', $livePhoto['thumbnailUrl'], 404, $other);
    $visible = array_column($http('GET', '/api/trips?scope=public', 200)['json']['trips'], 'id');
    $check(!in_array($journalId, $visible, true) && !in_array($liveId, $visible, true), 'Suspension hides all of the owner\'s published content.');
    $check((int) $db->fetchOne('SELECT COUNT(*) FROM auth_tokens WHERE user_id = ?', [$ownerId]) === 0 && (int) $db->fetchOne('SELECT COUNT(*) FROM auth_invitations WHERE user_id = ?', [$ownerId]) === 0, 'Suspension deletes sessions and pending invitations.');
    $check(!in_array($ownerId, array_column($http('GET', '/api/users?includeInactive=0', 200, $admin)['json']['users'], 'id'), true), 'Admin active-only listing excludes the suspended fixture.');
    $http('PATCH', '/api/users/'.$ownerId, 200, $admin, ['active' => true]);
    $http('GET', '/api/session', 401, $owner);
    $http('GET', '/api/trips/'.$journalId, 200);

    $http('DELETE', '/api/trips/'.$otherTrip['id'], 204, $other);
    $http('GET', '/api/trips/'.$otherTrip['id'], 404, $other);
    $http('GET', $otherPhoto['url'], 404, $other);
    $check(!is_dir($mediaRoot.'/'.$otherTrip['id']), 'HTTP trip deletion removes its media directory.');
} catch (Throwable $error) {
    // Assertion messages never include response bodies or request credentials.
    $failure = $error instanceof RuntimeException && !$error instanceof \Doctrine\DBAL\Exception ? $error->getMessage() : get_class($error).' at '.$error->getFile().':'.$error->getLine();
} finally {
    // Resolve only prechecked, unique fixture names in case a response failed after committing.
    foreach ($plannedNames as $role => $name) {
        try {
            $row = $db->fetchAssociative('SELECT id, username FROM users WHERE username = ?', [$name]);
            if ($row) {
                $users[$role] = $row;
            }
        } catch (Throwable $error) {
            $cleanupErrors[] = 'Could not resolve an owned fixture: '.get_class($error);
        }
    }
    foreach ($users as $user) {
        try {
            if (isset($before['users'][$json(['id' => $user['id']])])) {
                throw new RuntimeException('Refusing cleanup of a pre-existing user.');
            }
            foreach ($db->fetchFirstColumn('SELECT id FROM trips WHERE user_id = ?', [$user['id']]) as $tripId) {
                $repository->deleteTrip($tripId, $user);
            }
            $repository->deleteScans($user);
            // Real FKs cascade only this fixture's saved places, invitations and sessions.
            $db->delete('users', ['id' => $user['id'], 'username' => $user['username']]);
        } catch (Throwable $error) {
            $cleanupErrors[] = 'Owned fixture cleanup failed: '.get_class($error);
        }
    }
    foreach ($attemptKeys as $key) {
        try {
            if (isset($before['auth_login_attempts'][$json(['attempt_key' => $key])])) {
                throw new RuntimeException('Refusing cleanup of a pre-existing rate bucket.');
            }
            $db->delete('auth_login_attempts', ['attempt_key' => $key]);
        } catch (Throwable $error) {
            $cleanupErrors[] = 'Owned rate-bucket cleanup failed: '.get_class($error);
        }
    }
    if ($before !== null) {
        try {
            $after = $snapshot();
            foreach ($before as $table => $rows) {
                $check($after[$table] === $rows, 'Conservation failed: '.$table.' rows changed or fixture rows remain.');
            }
            $check($filesBefore === $mediaSnapshot(), 'Conservation failed: pre-existing media changed or fixture files/directories remain.');
            fwrite(STDOUT, sprintf("After: users=%d trips=%d scans=%d media=%d. All table fingerprints and media match the baseline.\n", count($after['users']), count($after['trips']), count($after['scans']), count($after['trip_media'])));
        } catch (Throwable $error) {
            $cleanupErrors[] = $error instanceof RuntimeException && !$error instanceof \Doctrine\DBAL\Exception ? $error->getMessage() : 'Conservation check failed: '.get_class($error);
        }
    }
    if ($locked) {
        $db->fetchOne("SELECT RELEASE_LOCK('fishing-http-qa')");
    }
    $db->close();
}

if ($failure !== null || $cleanupErrors !== []) {
    foreach (array_filter([$failure, ...$cleanupErrors]) as $message) {
        fwrite(STDERR, 'FAIL: '.$message."\n");
    }
    fwrite(STDERR, 'HTTP QA stopped after '.$checks.' passed checks and '.$requests." real HTTP requests.\n");
    exit(1);
}
fwrite(STDOUT, 'HTTP QA passed: '.$checks.' checks across '.$requests." real local HTTP requests. No fixtures, media or rate buckets remain; no external providers were called.\n");
