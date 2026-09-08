<?php

declare(strict_types=1);

namespace App\Service;

use App\Exception\ApiException;

final class TripRules
{
    private const TECHNIQUES = ['surfcasting', 'spinning', 'shore-jigging', 'eging', 'bottom-fishing', 'rock-fishing', 'boat-fishing'];
    private const CLOCK_TOLERANCE = 60;
    private const SNAPSHOT_TOLERANCE = 3600;

    public function place(array $body): array
    {
        return [
            'name' => $this->requiredString($body['name'] ?? null, 'name', 255),
            'lat' => $this->number($body['lat'] ?? null, -90, 90, 'lat'),
            'lon' => $this->number($body['lon'] ?? null, -180, 180, 'lon'),
            'technique' => $this->choice($body['technique'] ?? null, self::TECHNIQUES, 'technique'),
            'notes' => $this->text($body['notes'] ?? '', 'notes', 2000),
        ];
    }

    public function create(array $body): array
    {
        $explicitOutcome = array_key_exists('outcome', $body);
        $body += [
            'recordingMode' => 'live', 'visibility' => 'private', 'fishRecords' => [], 'score' => 0,
            'publicLocationPrecision' => 'approximate', 'shareNotes' => false, 'sharedMediaIds' => [],
            'notes' => '', 'conditionsLabel' => '', 'depthLabel' => '', 'seabedLabel' => '', 'weather' => [], 'marine' => [],
        ];
        $mode = $this->choice($body['recordingMode'], ['live', 'historical'], 'recordingMode');
        $input = [
            'recordingMode' => $mode,
            'tripDate' => $this->date($body['tripDate'] ?? null, 'tripDate'),
            'technique' => $this->choice($body['technique'] ?? null, self::TECHNIQUES, 'technique'),
            'techniqueLabel' => $this->requiredString($body['techniqueLabel'] ?? null, 'techniqueLabel', 100),
            'locationName' => $this->requiredString($body['locationName'] ?? null, 'locationName', 255),
            'lat' => $this->number($body['lat'] ?? null, -90, 90, 'lat'),
            'lon' => $this->number($body['lon'] ?? null, -180, 180, 'lon'),
            'spotId' => isset($body['spotId']) ? $this->requiredString($body['spotId'], 'spotId', 160) : null,
            'score' => (int) round($this->number($body['score'], 0, 100, 'score')),
            'visibility' => $this->choice($body['visibility'], ['private', 'public'], 'visibility'),
            'fishRecords' => $this->fishRecords($body['fishRecords'], false),
            'endedAt' => isset($body['endedAt']) ? $this->date($body['endedAt'], 'endedAt') : null,
            'outcome' => $this->choice($explicitOutcome ? $body['outcome'] : (!empty($body['fishRecords']) ? 'recorded' : 'not-recorded'), ['not-recorded', 'zero', 'recorded'], 'outcome'),
            'fishingMinutes' => isset($body['fishingMinutes']) ? $this->integer($body['fishingMinutes'], 1, 4294967295, 'fishingMinutes') : null,
            'anglerCount' => isset($body['anglerCount']) ? $this->integer($body['anglerCount'], 1, 100, 'anglerCount') : null,
            'conditionsRecordedAt' => isset($body['conditionsRecordedAt']) ? $this->date($body['conditionsRecordedAt'], 'conditionsRecordedAt') : null,
            'publicLocationPrecision' => $this->choice($body['publicLocationPrecision'], ['approximate', 'exact'], 'publicLocationPrecision'),
            'shareNotes' => $this->boolean($body['shareNotes'], 'shareNotes'),
            'sharedMediaIds' => $this->mediaIds($body['sharedMediaIds']),
        ];
        foreach (['notes' => 20000, 'conditionsLabel' => 20000, 'depthLabel' => 20000, 'seabedLabel' => 255] as $field => $max) {
            $input[$field] = $this->text($body[$field], $field, $max);
        }
        foreach (['weather', 'marine'] as $field) {
            $input[$field] = $this->snapshot($body[$field], $field);
        }
        if ($mode === 'live' && $input['visibility'] !== 'private') {
            throw new ApiException('Live trips must start private. Share only after completion.');
        }
        if ($mode === 'historical' && !$explicitOutcome) {
            throw new ApiException('Historical trips require an explicit outcome.');
        }
        // A new trip cannot already own any uploaded media.
        if ($input['sharedMediaIds'] !== []) {
            throw new ApiException('Only media belonging to this trip may be shared.');
        }

        return $this->validateState($input);
    }

    public function update(array $body): array
    {
        if (array_key_exists('recordingMode', $body)) {
            throw new ApiException('recordingMode cannot be changed.');
        }
        $input = [];
        foreach (['tripDate', 'endedAt', 'conditionsRecordedAt'] as $field) {
            if (array_key_exists($field, $body)) {
                $input[$field] = $body[$field] === null && $field !== 'tripDate' ? null : $this->date($body[$field], $field);
            }
        }
        foreach (['visibility' => ['private', 'public'], 'outcome' => ['not-recorded', 'zero', 'recorded'], 'publicLocationPrecision' => ['approximate', 'exact'], 'status' => ['completed']] as $field => $values) {
            if (array_key_exists($field, $body)) {
                $input[$field] = $this->choice($body[$field], $values, $field);
            }
        }
        foreach (['fishingMinutes' => 4294967295, 'anglerCount' => 100] as $field => $max) {
            if (array_key_exists($field, $body)) {
                $input[$field] = $body[$field] === null ? null : $this->integer($body[$field], 1, $max, $field);
            }
        }
        if (array_key_exists('notes', $body)) {
            $input['notes'] = $this->text($body['notes'], 'notes', 20000);
        }
        if (array_key_exists('fishRecords', $body)) {
            // Missing legacy measurement bases need the locked, persisted record to validate.
            $input['fishRecords'] = $this->fishRecords($body['fishRecords'], true);
        }
        if (array_key_exists('shareNotes', $body)) {
            $input['shareNotes'] = $this->boolean($body['shareNotes'], 'shareNotes');
        }
        if (array_key_exists('sharedMediaIds', $body)) {
            $input['sharedMediaIds'] = $this->mediaIds($body['sharedMediaIds']);
        }
        if ($input === []) {
            throw new ApiException('No trip changes were supplied.');
        }

        return $input;
    }

    /** The repository calls this with the locked state, including raw persisted fish records. */
    public function applyUpdate(array $before, array $input): array
    {
        $input = $this->update($input);
        $explicitOutcome = array_key_exists('outcome', $input);
        if (array_key_exists('fishRecords', $input)) {
            $input['fishRecords'] = $this->fishRecords($input['fishRecords'], false, $before['fishRecords']);
            if (!array_key_exists('outcome', $input)) {
                $input['outcome'] = $input['fishRecords'] !== [] ? 'recorded' : ($before['fishRecords'] !== [] ? 'not-recorded' : $before['outcome']);
            }
        }
        $trip = array_replace($before, $input);
        if ($before['status'] === 'active' && $trip['status'] === 'completed') {
            // Finishing a legacy public session must not bypass the separate publication review.
            $trip['visibility'] = 'private';
        }
        if (($input['visibility'] ?? null) === 'public' && $trip['status'] !== 'completed') {
            throw new ApiException('Only completed trips can be public.');
        }
        if ($before['status'] === 'active' && $trip['status'] === 'completed' && $trip['fishRecords'] === [] && !$explicitOutcome) {
            throw new ApiException('Choose zero catch or not-recorded explicitly when completing an empty trip.');
        }

        return $this->validateState($trip);
    }

    private function validateState(array $trip): array
    {
        $start = new \DateTimeImmutable($trip['tripDate']);
        $end = $trip['endedAt'] !== null ? new \DateTimeImmutable($trip['endedAt']) : null;
        if ($end !== null && $end < $start) {
            throw new ApiException('endedAt must not precede tripDate.');
        }
        if ($trip['fishingMinutes'] !== null && ($end === null || $trip['fishingMinutes'] > ($end->getTimestamp() - $start->getTimestamp()) / 60 + 1)) {
            throw new ApiException('Fishing minutes require an actual endedAt and cannot exceed trip duration (one minute rounding tolerance).');
        }
        if (($trip['outcome'] === 'recorded') !== ($trip['fishRecords'] !== [])) {
            throw new ApiException('Recorded catch requires fish; zero and not-recorded require an empty fish list.');
        }

        $recorded = $trip['conditionsRecordedAt'] !== null ? new \DateTimeImmutable($trip['conditionsRecordedAt']) : null;
        $aligned = 0;
        foreach (['weather', 'marine'] as $field) {
            $snapshot = $trip[$field];
            if (is_array($snapshot['sourceSnapshot'] ?? null)) {
                $snapshot = $snapshot['sourceSnapshot'];
            }
            try {
                $valid = isset($snapshot['validAt']) ? new \DateTimeImmutable($this->date($snapshot['validAt'], $field.'.validAt')) : null;
            } catch (ApiException) {
                $valid = null;
            }
            $matches = $recorded !== null && $valid !== null
                && abs($valid->getTimestamp() - $recorded->getTimestamp()) <= self::SNAPSHOT_TOLERANCE
                && $recorded->getTimestamp() >= $start->getTimestamp() - self::SNAPSHOT_TOLERANCE
                && $recorded->getTimestamp() <= ($end?->getTimestamp() ?? $start->getTimestamp()) + self::SNAPSHOT_TOLERANCE
                && ($snapshot['confidence'] ?? 'none') !== 'none';
            if ($matches) {
                $snapshot['context'] = 'search-snapshot';
                $snapshot['tripConditions'] = false;
                ++$aligned;
            } else {
                $source = $snapshot;
                $snapshot = ['confidence' => 'none', 'context' => 'unknown', 'tripConditions' => false, 'unavailableReason' => 'No time-aligned provider snapshot; trip conditions are unknown.'];
                // Preserve legacy/search evidence without presenting it as conditions during fishing.
                if (array_diff_key($source, array_flip(['confidence', 'pressureTrend', 'context', 'tripConditions', 'unavailableReason'])) !== []) {
                    $snapshot['sourceSnapshot'] = $source;
                }
                if ($field === 'weather') {
                    $snapshot['pressureTrend'] = 'unknown';
                }
            }
            $trip[$field] = $snapshot;
        }
        $trip['conditionsLabel'] = $aligned > 0 ? 'Search snapshot only, not observed trip conditions.' : 'Trip conditions unknown: no time-aligned provider snapshot.';

        return $trip;
    }

    private function fishRecords(mixed $records, bool $deferLegacy, array $previous = []): array
    {
        if (!is_array($records) || !array_is_list($records) || count($records) > 500) {
            throw new ApiException('fishRecords must be a list of at most 500 records.');
        }
        $previous = array_column($previous, null, 'id');
        $normalized = [];
        $ids = [];
        foreach ($records as $record) {
            if (!is_array($record)) {
                throw new ApiException('Invalid fish record.');
            }
            $id = $this->requiredString($record['id'] ?? null, 'fish.id', 160);
            if (isset($ids[$id])) {
                throw new ApiException('Fish IDs must be unique and stable across corrections.');
            }
            $ids[$id] = true;
            $fish = [
                'id' => $id,
                'species' => $this->requiredString($record['species'] ?? null, 'fish.species', 100),
                'count' => $this->integer($record['count'] ?? null, 1, 999, 'fish.count'),
                'released' => $this->boolean($record['released'] ?? null, 'fish.released'),
            ];
            foreach (['weightKg' => 'weightBasis', 'lengthCm' => 'lengthBasis'] as $field => $basis) {
                if (isset($record[$field])) {
                    $fish[$field] = $this->number($record[$field], 0.001, 1000, 'fish.'.$field);
                }
                if (array_key_exists($basis, $record)) {
                    $fish[$basis] = $this->choice($record[$basis], $basis === 'weightBasis' ? ['individual', 'total', 'average', 'unknown'] : ['individual', 'average', 'unknown'], 'fish.'.$basis);
                } elseif (isset($fish[$field]) && $fish['count'] === 1) {
                    $fish[$basis] = 'individual';
                }
            }
            foreach (['bait' => 255, 'notes' => 2000] as $field => $max) {
                if (isset($record[$field])) {
                    $value = $this->text($record[$field], 'fish.'.$field, $max);
                    if ($value !== '') {
                        $fish[$field] = $value;
                    }
                }
            }
            if (!$deferLegacy && $fish['count'] > 1) {
                foreach (['weightKg' => 'weightBasis', 'lengthCm' => 'lengthBasis'] as $field => $basis) {
                    if (!isset($fish[$field]) || isset($fish[$basis])) {
                        continue;
                    }
                    $old = isset($previous[$id]) ? $this->fishRecords([$previous[$id]], true)[0] : null;
                    if ($old === null || $old != $fish) {
                        throw new ApiException('Measured groups require an explicit '.$basis.'.');
                    }
                    // Preserve missing bases on unchanged persisted groups; reads label them unknown.
                }
            }
            $normalized[] = $fish;
        }

        return $normalized;
    }

    private function snapshot(mixed $value, string $field): array
    {
        if (!is_array($value) || ($value !== [] && array_is_list($value))) {
            throw new ApiException($field.' must be an object.');
        }
        try {
            $json = json_encode($value, JSON_THROW_ON_ERROR, 8);
        } catch (\JsonException) {
            throw new ApiException('Invalid or excessively nested '.$field.' snapshot.');
        }
        if (strlen($json) > 32768) {
            throw new ApiException($field.' snapshot is too large.');
        }
        $bounds = [
            'airTemperatureC' => [-100, 100], 'apparentTemperatureC' => [-150, 150], 'seaSurfaceTemperatureC' => [-100, 100],
            'relativeHumidityPct' => [0, 100], 'cloudCoverPct' => [0, 100], 'moonPhase' => [0, 1],
            'windSpeedKmh' => [0, 1000], 'gustKmh' => [0, 1000], 'currentSpeedKmh' => [0, 1000],
            'windDirectionDeg' => [0, 360], 'waveDirectionDeg' => [0, 360], 'swellDirectionDeg' => [0, 360], 'currentDirectionDeg' => [0, 360],
            'pressureHpa' => [100, 1200], 'precipitationMm' => [0, 10000], 'weatherCode' => [0, 999], 'visibilityM' => [0, 1000000],
            'waveHeightM' => [0, 100], 'swellHeightM' => [0, 100], 'wavePeriodS' => [0, 1000], 'swellPeriodS' => [0, 1000], 'seaLevelMslM' => [-100, 100],
        ];
        foreach ($bounds as $key => [$min, $max]) {
            if (array_key_exists($key, $value)) {
                $value[$key] = $this->number($value[$key], $min, $max, $field.'.'.$key);
            }
        }
        foreach (['confidence' => ['high', 'medium', 'low', 'none'], 'pressureTrend' => ['rising', 'falling', 'stable', 'unknown']] as $key => $allowed) {
            if (array_key_exists($key, $value)) {
                $value[$key] = $this->choice($value[$key], $allowed, $field.'.'.$key);
            }
        }
        if (array_key_exists('isDay', $value)) {
            $value['isDay'] = $this->boolean($value['isDay'], $field.'.isDay');
        }
        if (array_key_exists('sourceSnapshot', $value)) {
            $value['sourceSnapshot'] = $this->snapshot($value['sourceSnapshot'], $field.'.sourceSnapshot');
        }

        return $value;
    }

    private function mediaIds(mixed $value): array
    {
        if (!is_array($value) || !array_is_list($value) || count($value) > 2520) {
            throw new ApiException('sharedMediaIds must be a bounded list.');
        }
        $ids = [];
        foreach ($value as $id) {
            $id = $this->requiredString($id, 'media ID', 36);
            if (!preg_match('/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/i', $id) || isset($ids[strtolower($id)])) {
                throw new ApiException('Media IDs must be unique UUIDs.');
            }
            $ids[strtolower($id)] = true;
        }

        return array_keys($ids);
    }

    private function date(mixed $value, string $field): string
    {
        $value = $this->requiredString($value, $field, 40);
        if (!preg_match('/\A([1-9][0-9]{3})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]{1,6})?(Z|[+-](?:0[0-9]|1[0-4]):[0-5][0-9])\z/', $value, $parts)
            || !checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1])
            || (int) $parts[4] > 23 || (int) $parts[5] > 59 || (int) $parts[6] > 59
            || (str_starts_with(ltrim($parts[7], '+-'), '14:') && !str_ends_with($parts[7], ':00'))) {
            throw new ApiException($field.' must be a real ISO 8601 date-time with timezone.');
        }
        $date = new \DateTimeImmutable($value);
        if ($date->getTimestamp() > time() + self::CLOCK_TOLERANCE || (int) $date->setTimezone(new \DateTimeZone('UTC'))->format('Y') < 1000) {
            throw new ApiException($field.' cannot be in the future or outside the supported date range.');
        }

        return $date->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z');
    }

    private function requiredString(mixed $value, string $label, int $max): string
    {
        $value = $this->text($value, $label, $max);
        if ($value === '') {
            throw new ApiException($label.' is required.');
        }

        return $value;
    }

    private function text(mixed $value, string $label, int $max): string
    {
        if (!is_string($value) || !mb_check_encoding($value, 'UTF-8') || mb_strlen($value) > $max || str_contains($value, "\0")) {
            throw new ApiException('Invalid '.$label.'.');
        }

        return trim($value);
    }

    private function number(mixed $value, float $min, float $max, string $label): float
    {
        if (!is_numeric($value) || is_bool($value) || !is_finite((float) $value) || (float) $value < $min || (float) $value > $max) {
            throw new ApiException('Invalid '.$label.'.');
        }

        return (float) $value;
    }

    private function integer(mixed $value, int $min, int $max, string $label): int
    {
        $value = $this->number($value, $min, $max, $label);
        if (floor($value) !== $value) {
            throw new ApiException($label.' must be an integer.');
        }

        return (int) $value;
    }

    private function choice(mixed $value, array $allowed, string $label): string
    {
        if (!in_array($value, $allowed, true)) {
            throw new ApiException('Invalid '.$label.'.');
        }

        return $value;
    }

    private function boolean(mixed $value, string $label): bool
    {
        if (!is_bool($value)) {
            throw new ApiException($label.' must be boolean.');
        }

        return $value;
    }
}
