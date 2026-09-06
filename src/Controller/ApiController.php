<?php

namespace App\Controller;

use App\Exception\ApiException;
use App\Repository\FishingRepository;
use App\Service\AuthService;
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
    public function __construct(
        private readonly FishingRepository $repository,
        private readonly SpotSearchService $search,
        private readonly AuthService $auth,
    ) {
    }

    #[Route('/api', name: 'api_index', methods: ['GET'])]
    public function index(): JsonResponse
    {
        return $this->json([
            'name' => 'Fishing Spotter API',
            'version' => '1.4.0',
            'contractVersion' => 2,
            'endpoints' => [
                'session' => 'GET,POST,DELETE /api/session; POST /api/activate',
                'users' => 'Administrator only: GET,POST /api/users; PATCH /api/users/:id; POST /api/users/:id/invitation',
                'trips' => 'GET,POST /api/trips; GET,PATCH,DELETE /api/trips/:id; GET /api/trips/active',
                'tripMedia' => 'POST,DELETE /api/trips/:id/media; GET /api/trip-media/:id',
                'scans' => 'Private, opt-in: GET,DELETE /api/scans; GET,DELETE /api/scans/:id',
                'savedPlaces' => 'Private: GET,POST /api/saved-places; DELETE /api/saved-places/:id',
                'insights' => 'GET /api/insights: personal observed outcomes, not predictions',
                'places' => 'GET /api/places; GET /api/places/:id',
                'spots' => 'POST /api/spots',
            ],
            'spotModes' => [
                'nearby' => 'Ranks OSM coastal candidates using EMODnet DTM cell estimates; shore requires coast within 200m and boat requires water at the marker.',
                'point' => 'Requires coordinates {lat, lon}; accepts optional numeric gpsAccuracyM and analyzes only that point.',
            ],
            'identity' => 'Authorization: Bearer <token>. Existing accounts require an operator-issued activation invitation.',
            'privacy' => 'Live trips are private. Only completed trips can be published with explicit location, notes and media choices. Guest searches are not recorded as scans.',
            'searchInput' => ['technique', 'location', 'coordinates', 'targetSpecies', 'fishingAt', 'saveHistory'],
            'scoreMeaning' => 'Heuristic technique fit, not catch probability or a safety assessment.',
        ]);
    }

    #[Route('/api/trips', name: 'api_trips_list', methods: ['GET'])]
    public function trips(Request $request): JsonResponse
    {
        $scope = $request->query->getString('scope', 'visible');
        if (!in_array($scope, ['visible', 'mine', 'public'], true)) {
            throw new ApiException('Μη έγκυρο scope εξορμήσεων.');
        }
        $user = $this->auth->user($request, $scope === 'mine');

        return $this->json(['trips' => $this->repository->listTrips($user, $scope)]);
    }

    #[Route('/api/trips', name: 'api_trips_create', methods: ['POST'])]
    public function createTrip(Request $request): JsonResponse
    {
        $user = $this->auth->user($request);
        $trip = $this->repository->createTrip($user, $this->body($request));

        return $this->json(['trip' => $trip], 201);
    }

    #[Route('/api/trips/active', name: 'api_trips_active', methods: ['GET'], priority: 10)]
    public function activeTrip(Request $request): JsonResponse
    {
        return $this->json(['trip' => $this->repository->getActiveTrip($this->auth->user($request))]);
    }

    #[Route('/api/trips/{id}', name: 'api_trips_get', methods: ['GET'])]
    public function trip(string $id, Request $request): JsonResponse
    {
        $user = $this->auth->user($request, false);

        return $this->json(['trip' => $this->repository->getTrip($id, $user)]);
    }

    #[Route('/api/trips/{id}', name: 'api_trips_update', methods: ['PATCH'])]
    public function updateTrip(string $id, Request $request): JsonResponse
    {
        $user = $this->auth->user($request);

        return $this->json(['trip' => $this->repository->updateTrip($id, $user, $this->body($request))]);
    }

    #[Route('/api/trips/{id}/media', name: 'api_trip_media_add', methods: ['POST'])]
    public function addTripMedia(string $id, Request $request): JsonResponse
    {
        $user = $this->auth->user($request);
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
        $user = $this->auth->user($request);

        return $this->json(['trip' => $this->repository->deleteTripMedia($tripId, $mediaId, $user)]);
    }

    #[Route('/api/trip-media/{id}', name: 'api_trip_media_file', methods: ['GET'])]
    #[Route('/api/trip-media/{id}/thumbnail', name: 'api_trip_media_thumbnail', methods: ['GET'])]
    public function tripMedia(string $id, Request $request): BinaryFileResponse
    {
        $user = $this->auth->user($request, false);
        $media = $this->repository->getTripMediaFile($id, $user, str_ends_with($request->getPathInfo(), '/thumbnail'));
        $response = new BinaryFileResponse($media['path']);
        $response->headers->set('Content-Type', $media['mimeType']);
        $response->headers->set('Content-Disposition', 'inline');
        $response->headers->set('Cache-Control', 'private, no-store');
        $response->headers->set('Vary', 'Authorization');
        $response->headers->remove('Last-Modified');

        return $response;
    }

    #[Route('/api/trips/{id}', name: 'api_trips_delete', methods: ['DELETE'])]
    public function deleteTrip(string $id, Request $request): Response
    {
        $user = $this->auth->user($request);
        $this->repository->deleteTrip($id, $user);

        return new Response(null, 204);
    }

    #[Route('/api/scans', name: 'api_scans_list', methods: ['GET'])]
    public function scans(Request $request): JsonResponse
    {
        $user = $this->auth->user($request);
        $limit = $request->query->getInt('limit', 100);

        return $this->json(['scans' => $this->repository->listScans($user, $limit)]);
    }

    #[Route('/api/scans/{id}', name: 'api_scans_get', methods: ['GET'])]
    public function scan(string $id, Request $request): JsonResponse
    {
        $user = $this->auth->user($request);

        return $this->json(['scan' => $this->repository->getScan($id, $user)]);
    }

    #[Route('/api/scans', name: 'api_scans_delete_all', methods: ['DELETE'])]
    #[Route('/api/scans/{id}', name: 'api_scans_delete', methods: ['DELETE'])]
    public function deleteScans(Request $request, ?string $id = null): Response
    {
        $this->repository->deleteScans($this->auth->user($request), $id);

        return new Response(null, 204);
    }

    #[Route('/api/saved-places', name: 'api_saved_places_list', methods: ['GET'])]
    public function savedPlaces(Request $request): JsonResponse
    {
        return $this->json(['places' => $this->repository->listSavedPlaces($this->auth->user($request))]);
    }

    #[Route('/api/saved-places', name: 'api_saved_places_create', methods: ['POST'])]
    public function savePlace(Request $request): JsonResponse
    {
        $user = $this->auth->user($request);

        return $this->json(['place' => $this->repository->savePlace($user, $this->body($request))], 201);
    }

    #[Route('/api/saved-places/{id}', name: 'api_saved_places_delete', methods: ['DELETE'])]
    public function deleteSavedPlace(string $id, Request $request): Response
    {
        $this->repository->deleteSavedPlace($id, $this->auth->user($request));

        return new Response(null, 204);
    }

    #[Route('/api/insights', name: 'api_personal_insights', methods: ['GET'])]
    public function insights(Request $request): JsonResponse
    {
        return $this->json($this->repository->personalInsights($this->auth->user($request)));
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
        $user = $this->auth->user($request, false);
        $saveHistory = $body['saveHistory'] ?? false;
        if (!is_bool($saveHistory)) {
            throw new ApiException('saveHistory must be boolean.');
        }
        if ($saveHistory && $user === null) {
            throw new ApiException('Sign in to save private search history.', 401);
        }
        $response = $this->search->search($body, $saveHistory && $user !== null);
        if ($saveHistory) {
            $response['scanId'] = $this->repository->recordScan($response, $body, $user);
        }
        $response['privacy'] = ['historySaved' => $saveHistory, 'retention' => $saveHistory ? 'until-deleted' : 'not-saved'];

        return $this->json($response);
    }

    #[Route('/api/spots', name: 'api_spots_clear', methods: ['DELETE'])]
    public function clearSpots(Request $request): JsonResponse
    {
        $this->auth->admin($request);
        $cleared = $this->search->clear();

        return $this->json(['cleared' => $cleared, 'entries' => 0]);
    }

    private function body(Request $request): array
    {
        $content = $request->getContent();
        if (strlen($content) > 2097152) {
            throw new ApiException('Request is too large.', 413);
        }
        try {
            $body = json_decode($content, true, 16, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new ApiException('Μη έγκυρα δεδομένα JSON.');
        }
        if (!is_array($body) || !str_starts_with(ltrim($content), '{')) {
            throw new ApiException('Μη έγκυρα δεδομένα αιτήματος.');
        }

        return $body;
    }

}
