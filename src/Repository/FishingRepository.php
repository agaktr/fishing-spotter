<?php

namespace App\Repository;

use App\Exception\ApiException;
use Doctrine\DBAL\Connection;
use Doctrine\DBAL\Exception\UniqueConstraintViolationException;
use Symfony\Component\Uid\Uuid;

final class FishingRepository
{
    private const TRIP_SELECT = <<<'SQL'
        SELECT t.id, t.user_id, u.username, u.display_name, t.visibility, t.trip_date,
               t.technique, t.technique_label, t.location_name, t.latitude, t.longitude,
               t.source_spot_id, t.score, t.fish_records_json, t.notes,
               t.conditions_label, t.depth_label, t.seabed_label,
               t.weather_json, t.marine_json, t.created_at, t.updated_at
        FROM trips t
        JOIN users u ON u.id = t.user_id
        SQL;

    private const PLACE_SELECT = <<<'SQL'
        SELECT id, external_key, name, category, latitude, longitude, data_quality,
               tags_json, created_at, updated_at
        FROM places
        SQL;

    public function __construct(private readonly Connection $db)
    {
    }

    public function listUsers(bool $includeInactive = true): array
    {
        $rows = $this->db->fetchAllAssociative(
            'SELECT id, username, display_name, active, created_at, updated_at FROM users '.($includeInactive ? '' : 'WHERE active = TRUE').' ORDER BY username ASC',
        );

        return array_map($this->mapUser(...), $rows);
    }

    public function findUser(string $username, bool $activeOnly = false): ?array
    {
        $normalized = $this->normalizeUsername($username);
        $row = $this->db->fetchAssociative(
            'SELECT id, username, display_name, active, created_at, updated_at FROM users WHERE username = ?'.($activeOnly ? ' AND active = TRUE' : '').' LIMIT 1',
            [$normalized],
        );

        return $row ? $this->mapUser($row) : null;
    }

    public function requestUser(?string $username, bool $required = true): ?array
    {
        $username = trim((string) $username);
        if ($username === '') {
            if ($required) {
                throw new ApiException('Συνδέσου πρώτα με username.', 401);
            }

            return null;
        }

        $user = $this->findUser($username, true);
        if (!$user && $required) {
            throw new ApiException('Το username δεν υπάρχει ή είναι ανενεργό.', 401);
        }

        return $user;
    }

    public function createUser(string $username, ?string $displayName): array
    {
        $username = $this->normalizeUsername($username);
        $label = mb_substr(trim((string) $displayName) ?: $username, 0, 100);
        try {
            $this->db->insert('users', [
                'id' => Uuid::v4()->toRfc4122(),
                'username' => $username,
                'display_name' => $label,
            ]);
        } catch (UniqueConstraintViolationException) {
            throw new ApiException('Αυτό το username υπάρχει ήδη.', 409);
        }

        return $this->findUser($username) ?? throw new \LogicException('Created user was not found.');
    }

    public function updateUser(string $id, array $input): array
    {
        $changes = [];
        if (array_key_exists('displayName', $input) && is_string($input['displayName'])) {
            $displayName = trim($input['displayName']);
            if ($displayName === '' || mb_strlen($displayName) > 100) {
                throw new ApiException('Το όνομα εμφάνισης δεν είναι έγκυρο.');
            }
            $changes['display_name'] = $displayName;
        }
        if (array_key_exists('active', $input) && is_bool($input['active'])) {
            $changes['active'] = $input['active'] ? 1 : 0;
        }
        if ($changes === []) {
            throw new ApiException('Δεν δόθηκε αλλαγή χρήστη.');
        }
        if ($this->db->update('users', $changes, ['id' => $id]) === 0) {
            throw new ApiException('Ο χρήστης δεν βρέθηκε.', 404);
        }
        $row = $this->db->fetchAssociative('SELECT id, username, display_name, active, created_at, updated_at FROM users WHERE id = ?', [$id]);

        return $this->mapUser($row ?: throw new ApiException('Ο χρήστης δεν βρέθηκε.', 404));
    }

    public function listTrips(?array $user, string $scope): array
    {
        $where = "WHERE t.visibility = 'public'";
        $params = [];
        if ($scope === 'mine') {
            if (!$user) {
                throw new ApiException('Συνδέσου για να δεις τις εξορμήσεις σου.', 401);
            }
            $where = 'WHERE t.user_id = ?';
            $params[] = $user['id'];
        } elseif ($scope === 'visible' && $user) {
            $where = "WHERE t.visibility = 'public' OR t.user_id = ?";
            $params[] = $user['id'];
        }
        $rows = $this->db->fetchAllAssociative(self::TRIP_SELECT." {$where} ORDER BY t.trip_date DESC, t.created_at DESC LIMIT 500", $params);

        return array_map($this->mapTrip(...), $rows);
    }

    public function getTrip(string $id, ?array $user): array
    {
        $row = $this->db->fetchAssociative(self::TRIP_SELECT.' WHERE t.id = ? LIMIT 1', [$id]);
        $trip = $row ? $this->mapTrip($row) : null;
        if (!$trip || ($trip['visibility'] === 'private' && $trip['userId'] !== ($user['id'] ?? null))) {
            throw new ApiException('Η εξόρμηση δεν βρέθηκε.', 404);
        }

        return $trip;
    }

    public function createTrip(array $user, array $input): array
    {
        $id = Uuid::v4()->toRfc4122();
        $externalKey = trim((string) ($input['spotId'] ?? '')) ?: sprintf('custom:%.5f,%.5f', $input['lat'], $input['lon']);
        $placeId = $this->upsertPlace([
            'externalKey' => $externalKey,
            'name' => $input['locationName'],
            'category' => !empty($input['spotId']) ? 'fallback' : 'custom',
            'lat' => $input['lat'],
            'lon' => $input['lon'],
            'dataQuality' => !empty($input['spotId']) ? 'generated' : 'custom',
            'tags' => [],
        ]);
        $date = new \DateTimeImmutable($input['tripDate']);
        $this->db->insert('trips', [
            'id' => $id,
            'user_id' => $user['id'],
            'place_id' => $placeId,
            'visibility' => $input['visibility'],
            'trip_date' => $date->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s'),
            'technique' => $input['technique'],
            'technique_label' => $input['techniqueLabel'],
            'location_name' => $input['locationName'],
            'latitude' => $input['lat'],
            'longitude' => $input['lon'],
            'source_spot_id' => $input['spotId'] ?? null,
            'score' => $input['score'],
            'fish_records_json' => $this->encode($input['fishRecords']),
            'notes' => $input['notes'],
            'conditions_label' => $input['conditionsLabel'],
            'depth_label' => $input['depthLabel'],
            'seabed_label' => $input['seabedLabel'],
            'weather_json' => $this->encode($input['weather']),
            'marine_json' => $this->encode($input['marine']),
        ]);

        return $this->getTrip($id, $user);
    }

    public function updateTripVisibility(string $id, array $user, string $visibility): array
    {
        $changed = $this->db->executeStatement('UPDATE trips SET visibility = ? WHERE id = ? AND user_id = ?', [$visibility, $id, $user['id']]);
        if ($changed === 0) {
            throw new ApiException('Η εξόρμηση δεν βρέθηκε ή δεν σου ανήκει.', 404);
        }

        return $this->getTrip($id, $user);
    }

    public function deleteTrip(string $id, array $user): void
    {
        if ($this->db->executeStatement('DELETE FROM trips WHERE id = ? AND user_id = ?', [$id, $user['id']]) === 0) {
            throw new ApiException('Η εξόρμηση δεν βρέθηκε ή δεν σου ανήκει.', 404);
        }
    }

    public function listPlaces(int $limit): array
    {
        $rows = $this->db->fetchAllAssociative(self::PLACE_SELECT.' ORDER BY updated_at DESC LIMIT '.$this->limit($limit));

        return array_map($this->mapPlace(...), $rows);
    }

    public function getPlace(int $id): array
    {
        $row = $this->db->fetchAssociative(self::PLACE_SELECT.' WHERE id = ? LIMIT 1', [$id]);
        if (!$row) {
            throw new ApiException('Το σημείο δεν βρέθηκε.', 404);
        }

        return $this->mapPlace($row);
    }

    public function listScans(array $user, int $limit): array
    {
        $rows = $this->db->fetchAllAssociative(
            'SELECT s.id, u.username, s.query_text, s.technique, s.location_label, s.center_latitude, s.center_longitude, s.radius_km, s.result_limit, s.result_count, s.created_at FROM scans s LEFT JOIN users u ON u.id = s.user_id WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT '.$this->limit($limit),
            [$user['id']],
        );

        return array_map($this->mapScan(...), $rows);
    }

    public function getScan(string $id, array $user): array
    {
        $row = $this->db->fetchAssociative(
            'SELECT s.id, u.username, s.query_text, s.technique, s.location_label, s.center_latitude, s.center_longitude, s.radius_km, s.result_limit, s.result_count, s.created_at, s.response_json FROM scans s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.user_id = ? LIMIT 1',
            [$id, $user['id']],
        );
        if (!$row) {
            throw new ApiException('Η σάρωση δεν βρέθηκε.', 404);
        }

        return [...$this->mapScan($row), 'response' => $this->decode($row['response_json'], [])];
    }

    public function recordScan(array $response, array $requestBody, ?array $user): string
    {
        $id = Uuid::v4()->toRfc4122();
        $this->db->beginTransaction();
        try {
            $this->db->insert('scans', [
                'id' => $id,
                'user_id' => $user['id'] ?? null,
                'query_text' => mb_substr($response['intent']['raw'], 0, 500),
                'technique' => $response['intent']['technique'],
                'location_label' => mb_substr($response['intent']['locationText'], 0, 255),
                'center_latitude' => $response['location']['lat'],
                'center_longitude' => $response['location']['lon'],
                'radius_km' => (int) round($response['intent']['radiusKm']),
                'result_limit' => $response['resultLimit'],
                'result_count' => count($response['spots']),
                'request_json' => $this->encode($requestBody),
                'response_json' => $this->encode($response),
            ]);
            foreach ($response['spots'] as $spot) {
                $placeId = $this->upsertScanPlace($spot);
                $this->db->insert('scan_places', [
                    'scan_id' => $id,
                    'place_id' => $placeId,
                    'rank_number' => $spot['rank'],
                    'score' => $spot['score'],
                    'snapshot_json' => $this->encode($spot),
                ]);
            }
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }

        return $id;
    }

    private function normalizeUsername(string $value): string
    {
        $normalized = mb_strtolower(trim($value), 'UTF-8');
        if (!preg_match('/^[\p{L}\p{N}._-]{2,64}$/u', $normalized)) {
            throw new ApiException('Το username πρέπει να έχει 2-64 γράμματα, αριθμούς, τελεία, παύλα ή underscore.');
        }

        return $normalized;
    }

    private function upsertPlace(array $input): int
    {
        $this->db->executeStatement(
            'INSERT INTO places (external_key, name, category, latitude, longitude, data_quality, tags_json) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), latitude = VALUES(latitude), longitude = VALUES(longitude)',
            [$input['externalKey'], $input['name'], $input['category'], $input['lat'], $input['lon'], $input['dataQuality'], $this->encode($input['tags'] ?? [])],
        );

        return (int) $this->db->fetchOne('SELECT id FROM places WHERE external_key = ?', [$input['externalKey']]);
    }

    private function upsertScanPlace(array $spot): int
    {
        $this->db->executeStatement(
            'INSERT INTO places (external_key, name, category, latitude, longitude, data_quality, tags_json) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), category = VALUES(category), latitude = VALUES(latitude), longitude = VALUES(longitude), data_quality = VALUES(data_quality), tags_json = VALUES(tags_json)',
            [$spot['id'], $spot['name'], $spot['category'], $spot['lat'], $spot['lon'], $spot['dataQuality'], $this->encode($spot['tags'])],
        );

        return (int) $this->db->fetchOne('SELECT id FROM places WHERE external_key = ?', [$spot['id']]);
    }

    private function mapUser(array $row): array
    {
        return ['id' => $row['id'], 'username' => $row['username'], 'displayName' => $row['display_name'], 'active' => (bool) $row['active'], 'createdAt' => $this->iso($row['created_at']), 'updatedAt' => $this->iso($row['updated_at'])];
    }

    private function mapTrip(array $row): array
    {
        $fish = $this->decode($row['fish_records_json'], []);

        return [
            'id' => $row['id'], 'userId' => $row['user_id'], 'username' => $row['username'], 'displayName' => $row['display_name'],
            'visibility' => $row['visibility'], 'tripDate' => $this->iso($row['trip_date']), 'technique' => $row['technique'],
            'techniqueLabel' => $row['technique_label'], 'locationName' => $row['location_name'], 'lat' => (float) $row['latitude'],
            'lon' => (float) $row['longitude'], 'spotId' => $row['source_spot_id'] ?: $row['id'], 'score' => (int) $row['score'],
            'fishCaught' => array_map(static fn (array $record): string => $record['count'].'x '.$record['species'], $fish),
            'fishRecords' => $fish, 'notes' => $row['notes'], 'conditionsLabel' => $row['conditions_label'],
            'depthLabel' => $row['depth_label'], 'seabedLabel' => $row['seabed_label'],
            'weather' => $this->decode($row['weather_json'], ['confidence' => 'none', 'pressureTrend' => 'unknown']),
            'marine' => $this->decode($row['marine_json'], ['confidence' => 'none']),
            'createdAt' => $this->iso($row['created_at']), 'updatedAt' => $this->iso($row['updated_at']),
        ];
    }

    private function mapPlace(array $row): array
    {
        return ['id' => (int) $row['id'], 'externalKey' => $row['external_key'], 'name' => $row['name'], 'category' => $row['category'], 'lat' => (float) $row['latitude'], 'lon' => (float) $row['longitude'], 'dataQuality' => $row['data_quality'], 'tags' => $this->decode($row['tags_json'], []), 'createdAt' => $this->iso($row['created_at']), 'updatedAt' => $this->iso($row['updated_at'])];
    }

    private function mapScan(array $row): array
    {
        $scan = ['id' => $row['id'], 'query' => $row['query_text'], 'technique' => $row['technique'], 'locationLabel' => $row['location_label'], 'lat' => (float) $row['center_latitude'], 'lon' => (float) $row['center_longitude'], 'radiusKm' => (int) $row['radius_km'], 'resultLimit' => (int) $row['result_limit'], 'resultCount' => (int) $row['result_count'], 'createdAt' => $this->iso($row['created_at'])];
        if ($row['username'] !== null) {
            $scan['username'] = $row['username'];
        }

        return $scan;
    }

    private function iso(string|\DateTimeInterface $value): string
    {
        $date = $value instanceof \DateTimeInterface ? \DateTimeImmutable::createFromInterface($value) : new \DateTimeImmutable($value, new \DateTimeZone('UTC'));

        return $date->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z');
    }

    private function encode(mixed $value): string
    {
        return json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    private function decode(mixed $value, array $fallback): array
    {
        if (is_array($value)) {
            return $value;
        }
        if (!is_string($value) || $value === '') {
            return $fallback;
        }
        try {
            $decoded = json_decode($value, true, 512, JSON_THROW_ON_ERROR);

            return is_array($decoded) ? $decoded : $fallback;
        } catch (\JsonException) {
            return $fallback;
        }
    }

    private function limit(int $limit): int
    {
        return min(500, max(1, $limit));
    }
}
