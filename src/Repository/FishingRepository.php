<?php

namespace App\Repository;

use App\Exception\ApiException;
use App\Service\TripMediaStorage;
use App\Service\TripRules;
use Doctrine\DBAL\Connection;
use Symfony\Component\HttpFoundation\File\UploadedFile;
use Symfony\Component\Uid\Uuid;

final class FishingRepository
{
    private const TRIP_SELECT = <<<'SQL'
        SELECT t.id, t.user_id, u.username, u.display_name, u.active AS owner_active, t.place_id,
               t.visibility, t.status, t.trip_date, t.completed_at,
               t.recording_mode, t.ended_at, t.outcome, t.fishing_minutes, t.angler_count,
               t.conditions_recorded_at, t.public_location_precision, t.share_notes, t.shared_media_json,
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

    private const PUBLIC_TRIP = "t.visibility = 'public' AND t.status = 'completed' AND u.active = TRUE";

    public function __construct(
        private readonly Connection $db,
        private readonly TripMediaStorage $mediaStorage,
        private readonly TripRules $rules,
    ) {
    }

    public function listTrips(?array $user, string $scope): array
    {
        if (!in_array($scope, ['mine', 'visible', 'public'], true)) {
            throw new ApiException('Invalid trip scope.');
        }
        $where = 'WHERE ('.self::PUBLIC_TRIP.')';
        $params = [];
        if ($scope === 'mine') {
            if (!$user) {
                throw new ApiException('Συνδέσου για να δεις τις εξορμήσεις σου.', 401);
            }
            $where = 'WHERE t.user_id = ?';
            $params[] = $user['id'];
        } elseif ($scope === 'visible' && $user) {
            $where .= ' OR t.user_id = ?';
            $params[] = $user['id'];
        }
        $rows = $this->db->fetchAllAssociative(self::TRIP_SELECT." {$where} ORDER BY t.trip_date DESC, t.created_at DESC LIMIT 500", $params);

        return $this->tripsForViewer($rows, $user);
    }

    public function getActiveTrip(array $user): ?array
    {
        $row = $this->db->fetchAssociative(self::TRIP_SELECT." WHERE t.user_id = ? AND t.status = 'active' LIMIT 1", [$user['id']]);

        return $row ? $this->attachMedia([$this->mapTrip($row)])[0] : null;
    }

    public function getTrip(string $id, ?array $user): array
    {
        $row = $this->db->fetchAssociative(self::TRIP_SELECT.' WHERE t.id = ? LIMIT 1', [$id]);
        if (!$row || ($row['user_id'] !== ($user['id'] ?? null) && !$this->isPublic($row))) {
            throw new ApiException('Η εξόρμηση δεν βρέθηκε.', 404);
        }

        return $this->tripsForViewer([$row], $user)[0];
    }

    public function createTrip(array $user, array $input): array
    {
        $input = $this->rules->create($input);
        $id = Uuid::v4()->toRfc4122();
        $historical = $input['recordingMode'] === 'historical';
        $this->db->beginTransaction();
        try {
            if (!$this->db->fetchOne('SELECT id FROM users WHERE id = ? AND active = TRUE FOR UPDATE', [$user['id']])) {
                throw new ApiException('Authentication required.', 401);
            }
            if (!$historical && $this->db->fetchOne("SELECT id FROM trips WHERE user_id = ? AND status = 'active' LIMIT 1", [$user['id']])) {
                throw new ApiException('Υπάρχει ήδη ενεργή εξόρμηση. Συνέχισέ την ή ολοκλήρωσέ την πρώτα.', 409);
            }
            $this->db->insert('trips', [
                'id' => $id,
                'user_id' => $user['id'],
                'place_id' => null,
                'visibility' => $input['visibility'],
                'status' => $historical ? 'completed' : 'active',
                'recording_mode' => $input['recordingMode'],
                'trip_date' => $this->sqlDate($input['tripDate']),
                'completed_at' => $historical ? gmdate('Y-m-d H:i:s') : null,
                'ended_at' => $this->sqlDate($input['endedAt']),
                'outcome' => $input['outcome'],
                'fishing_minutes' => $input['fishingMinutes'],
                'angler_count' => $input['anglerCount'],
                'conditions_recorded_at' => $this->sqlDate($input['conditionsRecordedAt']),
                'public_location_precision' => $input['publicLocationPrecision'],
                'share_notes' => (int) $input['shareNotes'],
                'shared_media_json' => $this->encode($input['sharedMediaIds']),
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
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }

        return $this->getTrip($id, $user);
    }

    public function updateTrip(string $id, array $user, array $input): array
    {
        $removedMedia = [];
        $this->db->beginTransaction();
        try {
            $row = $this->db->fetchAssociative(self::TRIP_SELECT.' WHERE t.id = ? AND t.user_id = ? LIMIT 1 FOR UPDATE', [$id, $user['id']]);
            if (!$row) {
                throw new ApiException('Η εξόρμηση δεν βρέθηκε ή δεν σου ανήκει.', 404);
            }
            if (array_key_exists('expectedFishRevision', $input)) {
                $expected = $input['expectedFishRevision'];
                if (!is_string($expected) || !preg_match('/\A[0-9a-f]{64}\z/', $expected)) {
                    throw new ApiException('expectedFishRevision must be a 64-character lowercase SHA-256 string.');
                }
                // Compare persisted bytes under the lock, before rules or catch/media changes.
                if (array_key_exists('fishRecords', $input) && !hash_equals(hash('sha256', $row['fish_records_json']), $expected)) {
                    throw new ApiException('Catch records have changed. Reload the trip before saving catches.', 409);
                }
            }
            $id = $row['id'];
            $before = $this->mapTrip($row);
            $before['fishRecords'] = $this->decode($row['fish_records_json'], []);
            $trip = $this->rules->applyUpdate($before, $input);
            $oldPlaceId = $row['place_id'] !== null ? (int) $row['place_id'] : null;
            if ($trip['visibility'] === 'private' && $oldPlaceId !== null) {
                $this->db->fetchOne('SELECT id FROM places WHERE id = ? FOR UPDATE', [$oldPlaceId]);
            }
            $mediaRows = $this->mediaRowsForTrip($id);
            $fishIds = array_column($trip['fishRecords'], 'id');
            $remainingIds = [];
            foreach ($mediaRows as $media) {
                if (array_key_exists('fishRecords', $input) && $media['fish_record_id'] !== null && !in_array($media['fish_record_id'], $fishIds, true)) {
                    $removedMedia[] = $media;
                } else {
                    $remainingIds[] = $media['id'];
                }
            }
            if (array_key_exists('sharedMediaIds', $input) && array_diff($trip['sharedMediaIds'], $remainingIds) !== []) {
                throw new ApiException('Only existing media belonging to this trip may be shared.');
            }
            $trip['sharedMediaIds'] = array_values(array_intersect($trip['sharedMediaIds'], $remainingIds));
            $changes = [
                'visibility' => $trip['visibility'],
                'place_id' => $trip['visibility'] === 'private' ? null : $oldPlaceId,
                'trip_date' => $this->sqlDate($trip['tripDate']),
                'ended_at' => $this->sqlDate($trip['endedAt']),
                'outcome' => $trip['outcome'],
                'fishing_minutes' => $trip['fishingMinutes'],
                'angler_count' => $trip['anglerCount'],
                'conditions_recorded_at' => $this->sqlDate($trip['conditionsRecordedAt']),
                'public_location_precision' => $trip['publicLocationPrecision'],
                'share_notes' => (int) $trip['shareNotes'],
                'shared_media_json' => $this->encode($trip['sharedMediaIds']),
                'notes' => $trip['notes'],
                'conditions_label' => $trip['conditionsLabel'],
                'weather_json' => $this->encode($trip['weather']),
                'marine_json' => $this->encode($trip['marine']),
            ];
            if (array_key_exists('fishRecords', $input)) {
                $changes['fish_records_json'] = $this->encode($trip['fishRecords']);
                foreach ($removedMedia as $media) {
                    $this->db->delete('trip_media', ['id' => $media['id']]);
                }
            }
            if (($input['status'] ?? null) === 'completed' && $row['status'] === 'active') {
                $changes['status'] = 'completed';
                $changes['completed_at'] = (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->format('Y-m-d H:i:s.v');
            }
            $this->db->update('trips', $changes, ['id' => $id, 'user_id' => $user['id']]);
            if ($trip['visibility'] === 'private' && $oldPlaceId !== null) {
                $this->deletePlaceIfOrphan($oldPlaceId);
            }
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }

        foreach ($removedMedia as $media) {
            $this->mediaStorage->deleteFiles($id, $media['file_name'], $media['thumbnail_name']);
        }

        return $this->getTrip($id, $user);
    }

    public function addTripMedia(string $id, array $user, ?string $fishRecordId, UploadedFile $upload): array
    {
        $stored = null;
        $this->db->beginTransaction();
        try {
            $row = $this->db->fetchAssociative('SELECT id, fish_records_json FROM trips WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE', [$id, $user['id']]);
            if (!$row) {
                throw new ApiException('Η εξόρμηση δεν βρέθηκε ή δεν σου ανήκει.', 404);
            }
            $id = $row['id'];
            if ($fishRecordId !== null) {
                $fishIds = array_column($this->decode($row['fish_records_json'], []), 'id');
                if (!in_array($fishRecordId, $fishIds, true)) {
                    throw new ApiException('Το ψάρι της εικόνας δεν βρέθηκε.', 404);
                }
            }
            $count = (int) $this->db->fetchOne(
                'SELECT COUNT(*) FROM trip_media WHERE trip_id = ? AND '.($fishRecordId === null ? 'fish_record_id IS NULL' : 'fish_record_id = ?'),
                $fishRecordId === null ? [$id] : [$id, $fishRecordId],
            );
            $limit = $fishRecordId === null ? 20 : 5;
            if ($count >= $limit) {
                throw new ApiException($fishRecordId === null ? 'Η εξόρμηση μπορεί να έχει έως 20 εικόνες.' : 'Κάθε ψάρι μπορεί να έχει έως 5 εικόνες.');
            }

            $stored = $this->mediaStorage->store($id, $upload);
            $this->db->insert('trip_media', [
                'id' => $stored['id'],
                'trip_id' => $id,
                'fish_record_id' => $fishRecordId,
                'file_name' => $stored['fileName'],
                'thumbnail_name' => $stored['thumbnailName'],
                'original_name' => $stored['originalName'],
                'mime_type' => $stored['mimeType'],
                'file_size' => $stored['fileSize'],
                'width' => $stored['width'],
                'height' => $stored['height'],
                'sort_order' => $count,
            ]);
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            if ($stored !== null) {
                $this->mediaStorage->deleteFiles($id, $stored['fileName'], $stored['thumbnailName']);
            }
            throw $error;
        }

        return $this->getTrip($id, $user);
    }

    public function deleteTripMedia(string $tripId, string $mediaId, array $user): array
    {
        $this->db->beginTransaction();
        try {
            $trip = $this->db->fetchAssociative('SELECT id, shared_media_json FROM trips WHERE id = ? AND user_id = ? FOR UPDATE', [$tripId, $user['id']]);
            if (!$trip) {
                throw new ApiException('Media not found.', 404);
            }
            $tripId = $trip['id'];
            $media = $this->db->fetchAssociative('SELECT m.id, m.file_name, m.thumbnail_name FROM trip_media m JOIN trips t ON t.id = m.trip_id WHERE m.id = ? AND m.trip_id = ? AND t.user_id = ? LIMIT 1 FOR UPDATE', [$mediaId, $tripId, $user['id']]);
            if (!$media) {
                throw new ApiException('Η εικόνα δεν βρέθηκε ή δεν σου ανήκει.', 404);
            }
            $this->db->delete('trip_media', ['id' => $mediaId]);
            $this->db->update('trips', ['shared_media_json' => $this->encode(array_values(array_diff($this->decode($trip['shared_media_json'], []), [$media['id']])))], ['id' => $trip['id']]);
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
        $this->mediaStorage->deleteFiles($tripId, $media['file_name'], $media['thumbnail_name']);

        return $this->getTrip($tripId, $user);
    }

    public function getTripMediaFile(string $mediaId, ?array $user, bool $thumbnail): array
    {
        $row = $this->db->fetchAssociative('SELECT m.id, m.trip_id, m.file_name, m.thumbnail_name, m.mime_type, t.visibility, t.status, t.user_id, t.shared_media_json, u.active AS owner_active FROM trip_media m JOIN trips t ON t.id = m.trip_id JOIN users u ON u.id = t.user_id WHERE m.id = ? LIMIT 1', [$mediaId]);
        $public = $row && $this->isPublic($row) && in_array($row['id'], $this->decode($row['shared_media_json'], []), true);
        if (!$row || ($row['user_id'] !== ($user['id'] ?? null) && !$public)) {
            throw new ApiException('Η εικόνα δεν βρέθηκε.', 404);
        }

        return [
            'path' => $this->mediaStorage->path($row['trip_id'], $thumbnail ? $row['thumbnail_name'] : $row['file_name']),
            'mimeType' => $row['mime_type'],
            'public' => $public,
        ];
    }

    public function deleteTrip(string $id, array $user): void
    {
        $this->db->beginTransaction();
        try {
            $row = $this->db->fetchAssociative('SELECT id, place_id FROM trips WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE', [$id, $user['id']]);
            if (!$row) {
                throw new ApiException('Η εξόρμηση δεν βρέθηκε ή δεν σου ανήκει.', 404);
            }
            $id = $row['id'];
            $placeId = $row['place_id'] !== null ? (int) $row['place_id'] : null;
            if ($placeId !== null) {
                $this->db->fetchOne('SELECT id FROM places WHERE id = ? FOR UPDATE', [$placeId]);
            }
            $this->db->delete('trip_media', ['trip_id' => $row['id']]);
            $this->db->delete('trips', ['id' => $id, 'user_id' => $user['id']]);
            if ($placeId !== null) {
                $this->deletePlaceIfOrphan($placeId);
            }
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
        $this->mediaStorage->deleteTrip($id);
    }

    public function listPlaces(int $limit): array
    {
        $rows = $this->db->fetchAllAssociative(self::PLACE_SELECT." WHERE provenance = 'osm' ORDER BY updated_at DESC LIMIT ".$this->limit($limit));

        return array_map($this->mapPlace(...), $rows);
    }

    public function getPlace(int $id): array
    {
        $row = $this->db->fetchAssociative(self::PLACE_SELECT." WHERE id = ? AND provenance = 'osm' LIMIT 1", [$id]);
        if (!$row) {
            throw new ApiException('Το σημείο δεν βρέθηκε.', 404);
        }

        return $this->mapPlace($row);
    }

    public function listScans(array $user, int $limit): array
    {
        $rows = $this->db->fetchAllAssociative(
            'SELECT s.id, s.query_text, s.technique, s.location_label, s.center_latitude, s.center_longitude, s.radius_km, s.result_limit, s.result_count, s.created_at, s.request_json FROM scans s WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT '.$this->limit($limit),
            [$user['id']],
        );

        return array_map($this->mapScan(...), $rows);
    }

    public function getScan(string $id, array $user): array
    {
        $row = $this->db->fetchAssociative(
            'SELECT s.id, s.query_text, s.technique, s.location_label, s.center_latitude, s.center_longitude, s.radius_km, s.result_limit, s.result_count, s.created_at, s.request_json, s.response_json FROM scans s WHERE s.id = ? AND s.user_id = ? LIMIT 1',
            [$id, $user['id']],
        );
        if (!$row) {
            throw new ApiException('Η σάρωση δεν βρέθηκε.', 404);
        }

        return [...$this->mapScan($row), 'request' => $this->decode($row['request_json'], []), 'response' => $this->decode($row['response_json'], [])];
    }

    public function recordScan(array $response, array $requestBody, ?array $user): string
    {
        if (!$user || empty($user['id'])) {
            throw new ApiException('Authentication is required to save search history.', 401);
        }
        $id = Uuid::v4()->toRfc4122();
        $this->db->beginTransaction();
        try {
            if (!$this->db->fetchOne('SELECT id FROM users WHERE id = ? AND active = TRUE FOR UPDATE', [$user['id']])) {
                throw new ApiException('Authentication is required to save search history.', 401);
            }
            $this->db->insert('scans', [
                'id' => $id,
                'user_id' => $user['id'],
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
            if (($requestBody['mode'] ?? 'nearby') !== 'point' && ($response['mode'] ?? 'nearby') !== 'point') {
                foreach ($response['spots'] as $spot) {
                    // Only trusted OSM candidates belong in the anonymous catalog, never point/fallback labels.
                    if (($spot['dataQuality'] ?? null) !== 'osm' || !preg_match('/\A(?:node|way|relation)[:\/][0-9]+\z/', $spot['id'])) {
                        continue;
                    }
                    $placeId = $this->upsertScanPlace($spot);
                    $this->db->insert('scan_places', [
                        'scan_id' => $id,
                        'place_id' => $placeId,
                        'rank_number' => $spot['rank'],
                        'score' => $spot['score'],
                        'snapshot_json' => $this->encode($spot),
                    ]);
                }
            }
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }

        return $id;
    }

    public function deleteScans(array $user, ?string $id = null): void
    {
        $this->db->beginTransaction();
        try {
            $rows = $this->db->fetchAllAssociative('SELECT id FROM scans WHERE user_id = ?'.($id === null ? '' : ' AND id = ?').' FOR UPDATE', $id === null ? [$user['id']] : [$user['id'], $id]);
            if ($id !== null && $rows === []) {
                throw new ApiException('Search history not found.', 404);
            }
            foreach ($rows as $row) {
                $this->db->delete('scan_places', ['scan_id' => $row['id']]);
                $this->db->delete('scans', ['id' => $row['id'], 'user_id' => $user['id']]);
            }
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
    }

    public function listSavedPlaces(array $user): array
    {
        return array_map($this->mapSavedPlace(...), $this->db->fetchAllAssociative('SELECT id, name, latitude, longitude, technique, notes, created_at, updated_at FROM saved_places WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 500', [$user['id']]));
    }

    public function savePlace(array $user, array $input): array
    {
        $input = $this->rules->place($input);
        $this->db->beginTransaction();
        try {
            if (!$this->db->fetchOne('SELECT id FROM users WHERE id = ? AND active = TRUE FOR UPDATE', [$user['id']])) {
                throw new ApiException('Authentication required.', 401);
            }
            $lat = number_format((float) $input['lat'], 7, '.', '');
            $lon = number_format((float) $input['lon'], 7, '.', '');
            $id = $this->db->fetchOne('SELECT id FROM saved_places WHERE user_id = ? AND latitude = ? AND longitude = ? AND technique = ?', [$user['id'], $lat, $lon, $input['technique']]);
            $values = ['name' => $input['name'], 'latitude' => $lat, 'longitude' => $lon, 'technique' => $input['technique'], 'notes' => $input['notes']];
            // Saving a previously bookmarked point is idempotent, not an implicit notes edit.
            if (!$id) {
                if ((int) $this->db->fetchOne('SELECT COUNT(*) FROM saved_places WHERE user_id = ?', [$user['id']]) >= 500) {
                    throw new ApiException('At most 500 private places can be saved.');
                }
                $id = Uuid::v4()->toRfc4122();
                $this->db->insert('saved_places', ['id' => $id, 'user_id' => $user['id'], ...$values]);
            }
            $row = $this->db->fetchAssociative('SELECT id, name, latitude, longitude, technique, notes, created_at, updated_at FROM saved_places WHERE id = ? AND user_id = ?', [$id, $user['id']]);
            $this->db->commit();

            return $this->mapSavedPlace($row);
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
    }

    public function deleteSavedPlace(string $id, array $user): void
    {
        if ($this->db->delete('saved_places', ['id' => $id, 'user_id' => $user['id']]) === 0) {
            throw new ApiException('Saved place not found.', 404);
        }
    }

    public function personalInsights(array $user): array
    {
        $summary = ['completedTrips' => 0, 'knownOutcomeTrips' => 0, 'fishCount' => 0, 'effortHours' => 0.0, 'anglerHours' => 0.0, 'effortTrips' => 0, 'catchPerAnglerHour' => null];
        $groups = [];
        $effortFish = 0;
        $rows = $this->db->iterateAssociative("SELECT technique, location_name, source_spot_id, latitude, longitude, outcome, fish_records_json, fishing_minutes, angler_count, trip_date, ended_at FROM trips WHERE user_id = ? AND status = 'completed' ORDER BY trip_date DESC, id", [$user['id']]);
        foreach ($rows as $row) {
            $key = $this->encode([$row['technique'], $row['source_spot_id'] ?: null, round((float) $row['latitude'], 3), round((float) $row['longitude'], 3)]);
            $groups[$key] ??= ['technique' => $row['technique'], 'locationName' => $row['location_name'], 'tripCount' => 0, 'knownOutcomeTrips' => 0, 'fishCount' => 0, 'effortTrips' => 0, 'anglerHours' => 0.0, 'catchPerAnglerHour' => null, '_effortFish' => 0];
            $group = &$groups[$key];
            ++$summary['completedTrips'];
            ++$group['tripCount'];
            $fish = $this->decode($row['fish_records_json'], []);
            $count = array_sum(array_map(static fn (array $record): int => max(0, (int) ($record['count'] ?? 0)), $fish));
            // Migrated records have recorded outcome; old fish also make their outcome known.
            $known = $row['outcome'] === 'zero' || $count > 0;
            if (!$known) {
                unset($group);
                continue;
            }
            ++$summary['knownOutcomeTrips'];
            ++$group['knownOutcomeTrips'];
            $summary['fishCount'] += $count;
            $group['fishCount'] += $count;
            $minutes = (int) $row['fishing_minutes'];
            $anglers = (int) $row['angler_count'];
            $duration = $row['ended_at'] !== null ? (new \DateTimeImmutable($row['ended_at'], new \DateTimeZone('UTC')))->getTimestamp() - (new \DateTimeImmutable($row['trip_date'], new \DateTimeZone('UTC')))->getTimestamp() : null;
            if ($minutes > 0 && $anglers >= 1 && $anglers <= 100 && $duration !== null && $duration >= 0 && $minutes <= $duration / 60 + 1) {
                ++$summary['effortTrips'];
                ++$group['effortTrips'];
                $summary['effortHours'] += $minutes / 60;
                $summary['anglerHours'] += $minutes / 60 * $anglers;
                $group['anglerHours'] += $minutes / 60 * $anglers;
                $effortFish += $count;
                $group['_effortFish'] += $count;
            }
            unset($group);
        }
        $summary['catchPerAnglerHour'] = $summary['anglerHours'] > 0 ? $effortFish / $summary['anglerHours'] : null;
        foreach ($groups as &$group) {
            $group['catchPerAnglerHour'] = $group['anglerHours'] > 0 ? $group['_effortFish'] / $group['anglerHours'] : null;
            unset($group['_effortFish']);
        }
        unset($group);

        return ['summary' => $summary, 'groups' => array_values($groups)];
    }

    private function deletePlaceIfOrphan(int $placeId): void
    {
        $references = (int) $this->db->fetchOne('SELECT (SELECT COUNT(*) FROM trips WHERE place_id = ?) + (SELECT COUNT(*) FROM scan_places WHERE place_id = ?)', [$placeId, $placeId]);
        if ($references === 0) {
            $this->db->executeStatement("DELETE FROM places WHERE id = ? AND provenance <> 'osm'", [$placeId]);
        }
    }

    private function upsertScanPlace(array $spot): int
    {
        $this->db->executeStatement(
            "INSERT INTO places (external_key, name, category, latitude, longitude, data_quality, tags_json, provenance) VALUES (?, ?, ?, ?, ?, ?, ?, 'osm') ON DUPLICATE KEY UPDATE name = VALUES(name), category = VALUES(category), latitude = VALUES(latitude), longitude = VALUES(longitude), data_quality = VALUES(data_quality), tags_json = VALUES(tags_json), provenance = 'osm'",
            [$spot['id'], $spot['name'], $spot['category'], $spot['lat'], $spot['lon'], $spot['dataQuality'], $this->encode($spot['tags'])],
        );

        return (int) $this->db->fetchOne('SELECT id FROM places WHERE external_key = ?', [$spot['id']]);
    }

    private function mapTrip(array $row): array
    {
        $fish = $this->decode($row['fish_records_json'], []);
        foreach ($fish as &$record) {
            $record['weightBasis'] ??= 'unknown';
            $record['lengthBasis'] ??= 'unknown';
            $record['images'] = [];
        }
        unset($record);

        return [
            'id' => $row['id'], 'userId' => $row['user_id'], 'username' => $row['username'], 'displayName' => $row['display_name'],
            'visibility' => $row['visibility'], 'status' => $row['status'], 'tripDate' => $this->iso($row['trip_date']),
            'recordingMode' => $row['recording_mode'],
            'endedAt' => $row['ended_at'] !== null ? $this->iso($row['ended_at']) : null,
            'outcome' => $fish !== [] ? 'recorded' : $row['outcome'],
            'fishingMinutes' => $row['fishing_minutes'] !== null ? (int) $row['fishing_minutes'] : null,
            'anglerCount' => $row['angler_count'] !== null ? (int) $row['angler_count'] : null,
            'conditionsRecordedAt' => $row['conditions_recorded_at'] !== null ? $this->iso($row['conditions_recorded_at']) : null,
            'publicLocationPrecision' => $row['public_location_precision'],
            'shareNotes' => (bool) $row['share_notes'], 'sharedMediaIds' => $this->decode($row['shared_media_json'], []),
            'completedAt' => $row['completed_at'] !== null ? $this->iso($row['completed_at']) : null, 'technique' => $row['technique'],
            'techniqueLabel' => $row['technique_label'], 'locationName' => $row['location_name'], 'lat' => (float) $row['latitude'],
            'lon' => (float) $row['longitude'], 'spotId' => $row['source_spot_id'] ?: $row['id'], 'score' => (int) $row['score'],
            'fishCaught' => array_map(static fn (array $record): string => $record['count'].'x '.$record['species'], $fish),
            'fishRevision' => hash('sha256', $row['fish_records_json']),
            'fishRecords' => $fish, 'images' => [],
            'notes' => $row['notes'], 'conditionsLabel' => $row['conditions_label'],
            'depthLabel' => $row['depth_label'], 'seabedLabel' => $row['seabed_label'],
            'weather' => $this->decode($row['weather_json'], ['confidence' => 'none', 'pressureTrend' => 'unknown']),
            'marine' => $this->decode($row['marine_json'], ['confidence' => 'none']),
            'createdAt' => $this->iso($row['created_at']), 'updatedAt' => $this->iso($row['updated_at']),
        ];
    }

    private function isPublic(array $row): bool
    {
        return $row['visibility'] === 'public' && $row['status'] === 'completed' && (bool) $row['owner_active'];
    }

    private function tripsForViewer(array $rows, ?array $user): array
    {
        $trips = $this->attachMedia(array_map($this->mapTrip(...), $rows));

        return array_map(fn (array $trip): array => $trip['userId'] === ($user['id'] ?? null) ? $trip : $this->publicData($trip), $trips);
    }

    private function publicData(array $trip): array
    {
        $public = array_intersect_key($trip, array_flip([
            'id', 'visibility', 'status', 'recordingMode', 'tripDate', 'endedAt', 'completedAt', 'outcome',
            'fishingMinutes', 'anglerCount', 'conditionsRecordedAt', 'publicLocationPrecision', 'shareNotes',
            'technique', 'score', 'createdAt', 'updatedAt',
        ]));
        $exact = $trip['publicLocationPrecision'] === 'exact';
        $public['lat'] = $exact ? $trip['lat'] : round($trip['lat'], 2);
        $public['lon'] = $exact ? $trip['lon'] : round($trip['lon'], 2);
        $public['locationName'] = $exact ? 'Shared fishing location' : 'Approximate fishing area';
        $public['spotId'] = $trip['id'];
        $public['userId'] = '';
        $public['username'] = '';
        $public['displayName'] = '';
        $public['techniqueLabel'] = ucfirst(str_replace('-', ' ', $trip['technique']));
        $public['notes'] = $trip['shareNotes'] ? $trip['notes'] : '';
        $public['depthLabel'] = '';
        $public['seabedLabel'] = '';
        $public['conditionsLabel'] = 'Search snapshot only, not observed trip conditions.';
        $public['sharedMediaIds'] = [];
        $images = function (array $images) use ($trip, &$public): array {
            $selected = [];
            foreach ($images as $image) {
                if (!in_array($image['id'], $trip['sharedMediaIds'], true)) {
                    continue;
                }
                $safe = array_intersect_key($image, array_flip(['id', 'fishRecordId', 'mimeType', 'fileSize', 'width', 'height', 'url', 'thumbnailUrl', 'createdAt']));
                $safe['originalName'] = 'Shared image';
                $selected[] = $safe;
                $public['sharedMediaIds'][] = $image['id'];
            }

            return $selected;
        };
        $public['images'] = $images($trip['images']);
        $public['fishRecords'] = [];
        $public['fishCaught'] = [];
        foreach ($trip['fishRecords'] as $fish) {
            $safe = array_intersect_key($fish, array_flip(['id', 'species', 'count', 'released', 'weightKg', 'lengthCm', 'weightBasis', 'lengthBasis']));
            if ($trip['shareNotes']) {
                foreach (['notes', 'bait'] as $field) {
                    if (isset($fish[$field]) && is_string($fish[$field])) {
                        $safe[$field] = $fish[$field];
                    }
                }
            }
            $safe['images'] = $images($fish['images']);
            $public['fishRecords'][] = $safe;
            $public['fishCaught'][] = $safe['count'].'x '.$safe['species'];
        }
        foreach (['weather', 'marine'] as $field) {
            $safe = ['confidence' => 'none', 'context' => 'unknown', 'tripConditions' => false];
            if ($field === 'weather') {
                $safe['pressureTrend'] = 'unknown';
            }
            $snapshot = $trip[$field];
            // An allowlist must apply to values too: free-form or nested provider data can contain GPS.
            if ($trip['conditionsRecordedAt'] !== null && ($snapshot['context'] ?? null) === 'search-snapshot') {
                $numeric = $field === 'weather'
                    ? ['airTemperatureC', 'apparentTemperatureC', 'relativeHumidityPct', 'windSpeedKmh', 'windDirectionDeg', 'gustKmh', 'pressureHpa', 'precipitationMm', 'weatherCode', 'cloudCoverPct', 'visibilityM', 'moonPhase']
                    : ['waveHeightM', 'waveDirectionDeg', 'wavePeriodS', 'swellHeightM', 'swellDirectionDeg', 'swellPeriodS', 'seaSurfaceTemperatureC', 'currentSpeedKmh', 'currentDirectionDeg', 'seaLevelMslM'];
                foreach ($numeric as $key) {
                    if ((is_int($snapshot[$key] ?? null) || is_float($snapshot[$key] ?? null)) && is_finite((float) $snapshot[$key])) {
                        $safe[$key] = $snapshot[$key];
                    }
                }
                foreach (['confidence' => ['high', 'medium', 'low', 'none'], 'pressureTrend' => ['rising', 'falling', 'stable', 'unknown'], 'temporalMode' => ['current', 'forecast', 'historical']] as $key => $allowed) {
                    if (in_array($snapshot[$key] ?? null, $allowed, true)) {
                        $safe[$key] = $snapshot[$key];
                    }
                }
                foreach (['validAt', 'fetchedAt'] as $key) {
                    if (is_string($snapshot[$key] ?? null) && preg_match('/\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})\z/', $snapshot[$key])) {
                        $safe[$key] = $snapshot[$key];
                    }
                }
                if ($field === 'weather' && is_bool($snapshot['isDay'] ?? null)) {
                    $safe['isDay'] = $snapshot['isDay'];
                }
                $safe['context'] = 'search-snapshot';
            }
            $public[$field] = $safe;
        }
        if ($public['weather']['confidence'] === 'none' && $public['marine']['confidence'] === 'none') {
            $public['conditionsLabel'] = 'Trip conditions unknown: no time-aligned provider snapshot.';
        }

        return $public;
    }

    private function attachMedia(array $trips): array
    {
        if ($trips === []) {
            return [];
        }
        $ids = array_column($trips, 'id');
        $placeholders = implode(', ', array_fill(0, count($ids), '?'));
        $rows = $this->db->fetchAllAssociative("SELECT id, trip_id, fish_record_id, original_name, mime_type, file_size, width, height, sort_order, created_at FROM trip_media WHERE trip_id IN ({$placeholders}) ORDER BY sort_order, created_at", $ids);
        $mediaByTrip = [];
        foreach ($rows as $row) {
            $mediaByTrip[$row['trip_id']][] = $this->mapMedia($row);
        }
        foreach ($trips as &$trip) {
            $media = $mediaByTrip[$trip['id']] ?? [];
            $trip['images'] = array_values(array_filter($media, static fn (array $image): bool => $image['fishRecordId'] === null));
            foreach ($trip['fishRecords'] as &$fish) {
                $fish['images'] = array_values(array_filter($media, static fn (array $image): bool => $image['fishRecordId'] === $fish['id']));
            }
            unset($fish);
        }
        unset($trip);

        return $trips;
    }

    private function mapMedia(array $row): array
    {
        return [
            'id' => $row['id'],
            'fishRecordId' => $row['fish_record_id'],
            'originalName' => $row['original_name'],
            'mimeType' => $row['mime_type'],
            'fileSize' => (int) $row['file_size'],
            'width' => (int) $row['width'],
            'height' => (int) $row['height'],
            'url' => '/api/trip-media/'.$row['id'],
            'thumbnailUrl' => '/api/trip-media/'.$row['id'].'/thumbnail',
            'createdAt' => $this->iso($row['created_at']),
        ];
    }

    private function mediaRowsForTrip(string $tripId): array
    {
        return $this->db->fetchAllAssociative('SELECT id, fish_record_id, file_name, thumbnail_name FROM trip_media WHERE trip_id = ?', [$tripId]);
    }

    private function mapPlace(array $row): array
    {
        return ['id' => (int) $row['id'], 'externalKey' => $row['external_key'], 'name' => $row['name'], 'category' => $row['category'], 'lat' => (float) $row['latitude'], 'lon' => (float) $row['longitude'], 'dataQuality' => $row['data_quality'], 'tags' => $this->decode($row['tags_json'], []), 'createdAt' => $this->iso($row['created_at']), 'updatedAt' => $this->iso($row['updated_at'])];
    }

    private function mapScan(array $row): array
    {
        $scan = ['id' => $row['id'], 'query' => $row['query_text'], 'technique' => $row['technique'], 'locationLabel' => $row['location_label'], 'lat' => (float) $row['center_latitude'], 'lon' => (float) $row['center_longitude'], 'radiusKm' => (int) $row['radius_km'], 'resultLimit' => (int) $row['result_limit'], 'resultCount' => (int) $row['result_count'], 'createdAt' => $this->iso($row['created_at'])];
        $scan['mode'] = ($this->decode($row['request_json'], [])['mode'] ?? 'nearby') === 'point' ? 'point' : 'nearby';

        return $scan;
    }

    private function mapSavedPlace(array $row): array
    {
        return ['id' => $row['id'], 'name' => $row['name'], 'lat' => (float) $row['latitude'], 'lon' => (float) $row['longitude'], 'technique' => $row['technique'], 'notes' => $row['notes'], 'createdAt' => $this->iso($row['created_at']), 'updatedAt' => $this->iso($row['updated_at'])];
    }

    private function sqlDate(?string $value): ?string
    {
        return $value !== null ? (new \DateTimeImmutable($value))->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s') : null;
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
