<?php

declare(strict_types=1);

namespace App\Controller;

use App\Exception\ApiException;
use App\Service\AuthService;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class AuthController
{
    public function __construct(private readonly AuthService $auth)
    {
    }

    #[Route('/api/session', name: 'api_session', methods: ['POST'])]
    public function login(Request $request): JsonResponse
    {
        return new JsonResponse($this->auth->login($request, $this->body($request)));
    }

    #[Route('/api/session', name: 'api_session_get', methods: ['GET'])]
    public function session(Request $request): JsonResponse
    {
        return new JsonResponse(['user' => $this->auth->user($request)]);
    }

    #[Route('/api/session', name: 'api_session_delete', methods: ['DELETE'])]
    public function logout(Request $request): Response
    {
        $this->auth->logout($request);

        return new Response(null, 204);
    }

    #[Route('/api/activate', name: 'api_activate', methods: ['POST'])]
    public function activate(Request $request): JsonResponse
    {
        return new JsonResponse($this->auth->activate($request, $this->body($request)));
    }

    #[Route('/api/users', name: 'api_users_list', methods: ['GET'])]
    public function users(Request $request): JsonResponse
    {
        return new JsonResponse(['users' => $this->auth->users($request, $request->query->get('includeInactive') !== '0')]);
    }

    #[Route('/api/users', name: 'api_users_create', methods: ['POST'])]
    public function createUser(Request $request): JsonResponse
    {
        $this->auth->admin($request);

        return new JsonResponse($this->auth->createUser($request, $this->body($request)), 201);
    }

    #[Route('/api/users/{id}', name: 'api_users_update', methods: ['PATCH'])]
    public function updateUser(string $id, Request $request): JsonResponse
    {
        $this->auth->admin($request);

        return new JsonResponse(['user' => $this->auth->updateUser($request, $id, $this->body($request))]);
    }

    #[Route('/api/users/{id}/invitation', name: 'api_users_invitation', methods: ['POST'])]
    public function invitation(string $id, Request $request): JsonResponse
    {
        return new JsonResponse($this->auth->invitation($request, $id));
    }

    private function body(Request $request): array
    {
        $content = $request->getContent();
        if (strlen($content) > 16384) {
            throw new ApiException('Authentication request is too large.', 413);
        }
        try {
            $body = json_decode($content, false, 16, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new ApiException('Invalid JSON request.');
        }
        if (!$body instanceof \stdClass) {
            throw new ApiException('Request must be a JSON object.');
        }

        return (array) $body;
    }
}
