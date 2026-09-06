<?php

declare(strict_types=1);

use App\Repository\FishingRepository;
use App\Service\AuthService;
use App\Service\TripMediaStorage;
use App\Service\TripRules;
use Doctrine\DBAL\DriverManager;

require dirname(__DIR__).'/vendor/autoload.php';

if (!getenv('IS_DDEV_PROJECT') || getenv('DDEV_SITENAME') !== 'fishing') {
    throw new RuntimeException('Visual fixtures are restricted to local fishing DDEV.');
}
$db = DriverManager::getConnection(['driver' => 'pdo_mysql', 'host' => 'db', 'dbname' => 'db', 'user' => 'db', 'password' => 'db', 'charset' => 'utf8mb4']);
$db->executeStatement("SET time_zone = '+00:00'");
$repository = new FishingRepository($db, new TripMediaStorage(dirname(__DIR__).'/var/trip-media'), new TripRules());
$action = $argv[1] ?? '';
if ($action === 'create') {
    $username = 'qa-visual-'.bin2hex(random_bytes(8));
    $invitation = (new AuthService($db))->invite($username, true, 'Local Visual QA');
    $user = $invitation['user'];
    $repository->savePlace($user, ['name' => 'QA coastal revisit', 'lat' => 37.936, 'lon' => 23.64, 'technique' => 'eging', 'notes' => 'Private QA bookmark. Preserve these notes when saving again.']);
    $trip = $repository->createTrip($user, [
        'recordingMode' => 'historical', 'tripDate' => gmdate('Y-m-d\T10:00:00\Z', time() - 3 * 86400),
        'endedAt' => gmdate('Y-m-d\T12:00:00\Z', time() - 3 * 86400), 'outcome' => 'zero',
        'fishingMinutes' => 90, 'anglerCount' => 1, 'technique' => 'eging', 'techniqueLabel' => 'Eging',
        'locationName' => 'Private QA coastal diary', 'lat' => 37.936, 'lon' => 23.64,
        'notes' => 'A completed zero-catch trip, not a missing catch entry.',
    ]);
    $imagePath = dirname(__DIR__).'/var/'.$username.'.png';
    $image = imagecreatetruecolor(480, 320);
    imagefill($image, 0, 0, imagecolorallocate($image, 12, 67, 80));
    imagestring($image, 5, 150, 145, 'LOCAL QA IMAGE', imagecolorallocate($image, 255, 255, 255));
    imagepng($image, $imagePath);
    imagedestroy($image);
    fwrite(STDOUT, json_encode([...$invitation, 'password' => bin2hex(random_bytes(16)), 'tripId' => $trip['id'], 'imagePath' => $imagePath], JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT)."\n");
} elseif ($action === 'cleanup') {
    $username = $argv[2] ?? '';
    if (!preg_match('/\Aqa-visual-[a-f0-9]{16}\z/', $username)) {
        throw new RuntimeException('Supply the exact disposable visual fixture username.');
    }
    $row = $db->fetchAssociative('SELECT id FROM users WHERE username = ?', [$username]);
    if (!$row) {
        throw new RuntimeException('Visual fixture account not found.');
    }
    foreach ($repository->listTrips($row, 'mine') as $trip) {
        $repository->deleteTrip($trip['id'], $row);
    }
    $repository->deleteScans($row);
    $db->delete('users', ['id' => $row['id'], 'username' => $username]);
    foreach (['login', 'activate'] as $operation) {
        $db->delete('auth_login_attempts', ['attempt_key' => hash('sha256', $operation."\0username\0".$username)]);
    }
    $imagePath = dirname(__DIR__).'/var/'.$username.'.png';
    if (is_file($imagePath)) {
        unlink($imagePath);
    }
    fwrite(STDOUT, "Disposable visual fixture account, diary, bookmarks and media removed.\n");
} else {
    throw new RuntimeException('Usage: ddev exec php tests/visual.php create | cleanup <exact-fixture-username>');
}
