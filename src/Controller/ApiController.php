<?php

namespace App\Controller;

use App\Exception\ApiException;
use App\Repository\FishingRepository;
use App\Service\SpotSearchService;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\File\UploadedFile;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class ApiController extends AbstractController
{
    private const TECHNIQUES = ['surfcasting', 'spinning', 'shore-jigging', 'eging', 'bottom-fishing', 'rock-fishing', 'boat-fishing'];

    public function __construct(
        private readonly FishingRepository $repository,
        private readonly SpotSearchService $search,
    ) {
    }

    #[Route('/api', name: 'api_index', methods: ['GET'])]
    public function index(): JsonResponse
    {
        return $this->json([
            'name' => 'Fishing Spotter API',
            'endpoints' => [
                'session' => 'POST /api/session',
                'users' => 'GET,POST /api/users; PATCH /api/users/:id',
                'trips' => 'GET,POST /api/trips; GET,PATCH,DELETE /api/trips/:id; GET /api/trips/active',
                'tripMedia' => 'POST,DELETE /api/trips/:id/media; GET /api/trip-media/:id',
                'scans' => 'GET /api/scans; GET /api/scans/:id',
                'places' => 'GET /api/places; GET /api/places/:id',
                'spots' => 'POST /api/spots',
            ],
            'spotModes' => [
                'nearby' => 'Ranks measured OSM coastal candidates; shore requires coast within 200m and boat requires water at the marker.',
                'point' => 'Requires coordinates {lat, lon}; accepts optional numeric gpsAccuracyM and analyzes only that point.',
            ],
            'identity' => 'Send X-Fishing-User: <username> for user-specific endpoints.',
        ]);
    }

    #[Route('/api/session', name: 'api_session', methods: ['POST'])]
    public function session(Request $request): JsonResponse
    {
        $body = $this->body($request);
        $username = $this->requiredString($body['username'] ?? null, 'Username', 64);
        $user = $this->repository->findUser($username, true);
        if (!$user) {
            throw new ApiException('Το username δεν υπάρχει ή είναι ανενεργό.', 404);
        }

        return $this->json(['user' => $user]);
    }

    #[Route('/api/users', name: 'api_users_list', methods: ['GET'])]
    public function users(Request $request): JsonResponse
    {
        return $this->json(['users' => $this->repository->listUsers($request->query->get('includeInactive') !== '0')]);
    }

    #[Route('/api/users', name: 'api_users_create', methods: ['POST'])]
    public function createUser(Request $request): JsonResponse
    {
        $body = $this->body($request);
        $user = $this->repository->createUser(
            $this->requiredString($body['username'] ?? null, 'Username', 64),
            is_string($body['displayName'] ?? null) ? $body['displayName'] : null,
        );

        return $this->json(['user' => $user], 201);
    }

    #[Route('/api/users/{id}', name: 'api_users_update', methods: ['PATCH'])]
    public function updateUser(string $id, Request $request): JsonResponse
    {
        return $this->json(['user' => $this->repository->updateUser($id, $this->body($request))]);
    }

    #[Route('/api/trips', name: 'api_trips_list', methods: ['GET'])]
    public function trips(Request $request): JsonResponse
    {
        $scope = $request->query->getString('scope', 'visible');
        if (!in_array($scope, ['visible', 'mine', 'public'], true)) {
            throw new ApiException('Μη έγκυρο scope εξορμήσεων.');
        }
        $user = $this->repository->requestUser($request->headers->get('X-Fishing-User'), $scope === 'mine');

        return $this->json(['trips' => $this->repository->listTrips($user, $scope)]);
    }

    #[Route('/api/trips', name: 'api_trips_create', methods: ['POST'])]
    public function createTrip(Request $request): JsonResponse
    {
        $user = $this->repository->requestUser($request->headers->get('X-Fishing-User'));
        $trip = $this->repository->createTrip($user, $this->tripInput($this->body($request)));

        return $this->json(['trip' => $trip], 201);
    }

    #[Route('/api/trips/active', name: 'api_trips_active', methods: ['GET'], priority: 10)]
    public function activeTrip(Request $request): JsonResponse
    {
        $user = $this->repository->requestUser($request->headers->get('X-Fishing-User'));

        return $this->json(['trip' => $this->repository->getActiveTrip($user)]);
    }

    #[Route('/api/trips/{id}', name: 'api_trips_get', methods: ['GET'])]
    public function trip(string $id, Request $request): JsonResponse
    {
        $user = $this->repository->requestUser($request->headers->get('X-Fishing-User'), false);

        return $this->json(['trip' => $this->repository->getTrip($id, $user)]);
    }

    #[Route('/api/trips/{id}', name: 'api_trips_update', methods: ['PATCH'])]
    public function updateTrip(string $id, Request $request): JsonResponse
    {
        $user = $this->repository->requestUser($request->headers->get('X-Fishing-User'));

        return $this->json(['trip' => $this->repository->updateTrip($id, $user, $this->tripUpdateInput($this->body($request)))]);
    }

    #[Route('/api/trips/{id}/media', name: 'api_trip_media_add', methods: ['POST'])]
    public function addTripMedia(string $id, Request $request): JsonResponse
    {
        $user = $this->repository->requestUser($request->headers->get('X-Fishing-User'));
        $upload = $request->files->get('image');
        if (!$upload instanceof UploadedFile) {
            throw new ApiException('Διάλεξε εικόνα για μεταφόρτωση.');
        }
        $fishRecordId = trim($request->request->getString('fishRecordId')) ?: null;

        return $this->json(['trip' => $this->repository->addTripMedia($id, $user, $fishRecordId, $upload)], 201);
    }

    #[Route('/api/trips/{tripId}/media/{mediaId}', name: 'api_trip_media_delete', methods: ['DELETE'])]
    public function deleteTripMedia(string $tripId, string $mediaId, Request $request): JsonResponse
    {
        $user = $this->repository->requestUser($request->headers->get('X-Fishing-User'));

        return $this->json(['trip' => $this->repository->deleteTripMedia($tripId, $mediaId, $user)]);
    }

    #[Route('/api/trip-media/{id}', name: 'api_trip_media_file', methods: ['GET'])]
    #[Route('/api/trip-media/{id}/thumbnail', name: 'api_trip_media_thumbnail', methods: ['GET'])]
    public function tripMedia(string $id, Request $request): BinaryFileResponse
    {
        $user = $this->repository->requestUser($request->headers->get('X-Fishing-User'), false);
        $media = $this->repository->getTripMediaFile($id, $user, str_ends_with($request->getPathInfo(), '/thumbnail'));
        $response = new BinaryFileResponse($media['path']);
        $response->headers->set('Content-Type', $media['mimeType']);
        $response->headers->set('Content-Disposition', 'inline');
        $response->headers->set('Cache-Control', $media['public'] ? 'public, max-age=86400' : 'private, no-store');
        $response->headers->set('Vary', 'X-Fishing-User');

        return $response;
    }

    #[Route('/api/trips/{id}', name: 'api_trips_delete', methods: ['DELETE'])]
    public function deleteTrip(string $id, Request $request): Response
    {
        $user = $this->repository->requestUser($request->headers->get('X-Fishing-User'));
        $this->repository->deleteTrip($id, $user);

        return new Response(null, 204);
    }

    #[Route('/api/scans', name: 'api_scans_list', methods: ['GET'])]
    public function scans(Request $request): JsonResponse
    {
        $user = $this->repository->requestUser($request->headers->get('X-Fishing-User'));
        $limit = $request->query->getInt('limit', 100);

        return $this->json(['scans' => $this->repository->listScans($user, $limit)]);
    }

    #[Route('/api/scans/{id}', name: 'api_scans_get', methods: ['GET'])]
    public function scan(string $id, Request $request): JsonResponse
    {
        $user = $this->repository->requestUser($request->headers->get('X-Fishing-User'));

        return $this->json(['scan' => $this->repository->getScan($id, $user)]);
    }

    #[Route('/api/places', name: 'api_places_list', methods: ['GET'])]
    public function places(Request $request): JsonResponse
    {
        return $this->json(['places' => $this->repository->listPlaces($request->query->getInt('limit', 100))]);
    }

    #[Route('/api/places/{id}', name: 'api_places_get', requirements: ['id' => '\\d+'], methods: ['GET'])]
    public function place(string $id): JsonResponse
    {
        if ((int) $id <= 0) {
            throw new ApiException('Μη έγκυρο ID σημείου.');
        }

        return $this->json(['place' => $this->repository->getPlace((int) $id)]);
    }

    #[Route('/api/spots', name: 'api_spots_search', methods: ['POST'])]
    public function spots(Request $request): JsonResponse
    {
        $body = $this->body($request);
        $user = $this->repository->requestUser($request->headers->get('X-Fishing-User'), false);
        $pointMode = ($body['mode'] ?? 'nearby') === 'point';
        $response = $this->search->search($body, !$pointMode || $user !== null);
        if (($response['mode'] ?? 'nearby') !== 'point' || $user !== null) {
            $response['scanId'] = $this->repository->recordScan($response, $body, $user);
        }

        return $this->json($response);
    }

    #[Route('/api/spots', name: 'api_spots_clear', methods: ['DELETE'])]
    public function clearSpots(): JsonResponse
    {
        $cleared = $this->search->clear();

        return $this->json(['cleared' => $cleared, 'entries' => 0]);
    }

    private function body(Request $request): array
    {
        try {
            $body = json_decode($request->getContent(), true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new ApiException('Μη έγκυρα δεδομένα JSON.');
        }
        if (!is_array($body)) {
            throw new ApiException('Μη έγκυρα δεδομένα αιτήματος.');
        }

        return $body;
    }

    private function tripInput(array $body): array
    {
        $technique = $this->requiredString($body['technique'] ?? null, 'Τεχνική', 40);
        if (!in_array($technique, self::TECHNIQUES, true)) {
            throw new ApiException('Η τεχνική δεν υποστηρίζεται.');
        }
        $visibility = $body['visibility'] ?? null;
        if (!in_array($visibility, ['private', 'public'], true)) {
            throw new ApiException('Διάλεξε δημόσια ή ιδιωτική εξόρμηση.');
        }
        $fishRecords = $this->fishRecords($body['fishRecords'] ?? []);
        try {
            new \DateTimeImmutable($this->requiredString($body['tripDate'] ?? null, 'Ημερομηνία', 40));
        } catch (\Throwable) {
            throw new ApiException('Η ημερομηνία εξόρμησης δεν είναι έγκυρη.');
        }

        return [
            'tripDate' => $body['tripDate'],
            'technique' => $technique,
            'techniqueLabel' => $this->requiredString($body['techniqueLabel'] ?? null, 'Ετικέτα τεχνικής', 100),
            'locationName' => $this->requiredString($body['locationName'] ?? null, 'Τοποθεσία', 255),
            'lat' => $this->number($body['lat'] ?? null, -90, 90, 'Latitude'),
            'lon' => $this->number($body['lon'] ?? null, -180, 180, 'Longitude'),
            'spotId' => is_string($body['spotId'] ?? null) ? mb_substr($body['spotId'], 0, 160) : null,
            'score' => is_numeric($body['score'] ?? null) ? min(100, max(0, (int) round((float) $body['score']))) : 0,
            'visibility' => $visibility,
            'fishRecords' => $fishRecords,
            'notes' => is_string($body['notes'] ?? null) ? mb_substr($body['notes'], 0, 20000) : '',
            'conditionsLabel' => is_string($body['conditionsLabel'] ?? null) ? mb_substr($body['conditionsLabel'], 0, 20000) : '',
            'depthLabel' => is_string($body['depthLabel'] ?? null) ? mb_substr($body['depthLabel'], 0, 20000) : '',
            'seabedLabel' => is_string($body['seabedLabel'] ?? null) ? mb_substr($body['seabedLabel'], 0, 255) : '',
            'weather' => is_array($body['weather'] ?? null) ? $body['weather'] : ['confidence' => 'none', 'pressureTrend' => 'unknown'],
            'marine' => is_array($body['marine'] ?? null) ? $body['marine'] : ['confidence' => 'none'],
        ];
    }

    private function tripUpdateInput(array $body): array
    {
        $input = [];
        if (array_key_exists('visibility', $body)) {
            if (!in_array($body['visibility'], ['private', 'public'], true)) {
                throw new ApiException('Διάλεξε δημόσια ή ιδιωτική εξόρμηση.');
            }
            $input['visibility'] = $body['visibility'];
        }
        if (array_key_exists('tripDate', $body)) {
            try {
                new \DateTimeImmutable($this->requiredString($body['tripDate'], 'Ημερομηνία', 40));
            } catch (\Throwable) {
                throw new ApiException('Η ημερομηνία εξόρμησης δεν είναι έγκυρη.');
            }
            $input['tripDate'] = $body['tripDate'];
        }
        if (array_key_exists('notes', $body)) {
            $input['notes'] = is_string($body['notes']) ? mb_substr(trim($body['notes']), 0, 20000) : throw new ApiException('Οι σημειώσεις δεν είναι έγκυρες.');
        }
        if (array_key_exists('fishRecords', $body)) {
            $input['fishRecords'] = $this->fishRecords($body['fishRecords']);
        }
        if (array_key_exists('status', $body)) {
            if ($body['status'] !== 'completed') {
                throw new ApiException('Η κατάσταση εξόρμησης δεν είναι έγκυρη.');
            }
            $input['status'] = 'completed';
        }
        if ($input === []) {
            throw new ApiException('Δεν δόθηκε αλλαγή εξόρμησης.');
        }

        return $input;
    }

    private function fishRecords(mixed $records): array
    {
        if (!is_array($records)) {
            throw new ApiException('Τα ψάρια της εξόρμησης δεν είναι έγκυρα.');
        }
        $normalized = [];
        $ids = [];
        foreach ($records as $record) {
            if (!is_array($record)) {
                throw new ApiException('Τα ψάρια της εξόρμησης δεν είναι έγκυρα.');
            }
            $id = $this->requiredString($record['id'] ?? null, 'ID ψαριού', 160);
            if (isset($ids[$id])) {
                throw new ApiException('Κάθε ψάρι πρέπει να έχει μοναδικό ID.');
            }
            $ids[$id] = true;
            $count = $record['count'] ?? null;
            if (!is_numeric($count) || (int) $count != (float) $count || ($count = (int) $count) < 1 || $count > 999) {
                throw new ApiException('Το πλήθος ψαριών δεν είναι έγκυρο.');
            }
            if (!is_bool($record['released'] ?? null)) {
                throw new ApiException('Η ένδειξη απελευθέρωσης δεν είναι έγκυρη.');
            }
            $fish = [
                'id' => $id,
                'species' => $this->requiredString($record['species'] ?? null, 'Είδος ψαριού', 100),
                'count' => $count,
                'released' => $record['released'],
            ];
            foreach (['weightKg' => 1000, 'lengthCm' => 1000] as $field => $max) {
                if (isset($record[$field])) {
                    $fish[$field] = $this->number($record[$field], 0.001, $max, $field);
                }
            }
            foreach (['bait' => 255, 'notes' => 2000] as $field => $max) {
                if (isset($record[$field]) && is_string($record[$field]) && trim($record[$field]) !== '') {
                    $fish[$field] = mb_substr(trim($record[$field]), 0, $max);
                }
            }
            $normalized[] = $fish;
        }

        return $normalized;
    }

    private function requiredString(mixed $value, string $label, int $max): string
    {
        if (!is_string($value) || ($value = trim($value)) === '' || mb_strlen($value) > $max) {
            throw new ApiException($label.' δεν είναι έγκυρο.');
        }

        return $value;
    }

    private function number(mixed $value, float $min, float $max, string $label): float
    {
        if (!is_numeric($value) || ($value = (float) $value) < $min || $value > $max) {
            throw new ApiException($label.' δεν είναι έγκυρο.');
        }

        return $value;
    }
}
