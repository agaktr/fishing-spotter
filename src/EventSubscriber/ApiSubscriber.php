<?php

namespace App\EventSubscriber;

use App\Exception\ApiException;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\KernelEvents;

final class ApiSubscriber implements EventSubscriberInterface
{
    public static function getSubscribedEvents(): array
    {
        return [
            KernelEvents::REQUEST => ['onRequest', 2048],
            KernelEvents::RESPONSE => ['onResponse', -1024],
            KernelEvents::EXCEPTION => 'onException',
        ];
    }

    public function onRequest(RequestEvent $event): void
    {
        $request = $event->getRequest();
        if ($request->isMethod('OPTIONS') && $this->isApi($request)) {
            $event->setResponse(new JsonResponse(null, 204));
        }
    }

    public function onResponse(ResponseEvent $event): void
    {
        $request = $event->getRequest();
        if (!$this->isApi($request)) {
            return;
        }
        $response = $event->getResponse();
        $response->setVary(['Origin', 'Authorization'], false);
        $response->headers->remove('Access-Control-Allow-Origin');
        $response->headers->remove('Access-Control-Allow-Credentials');
        $origin = $request->headers->get('Origin');
        if ($origin !== null && ($origin === $request->getSchemeAndHttpHost()
            || in_array($origin, ['https://fishing.apto.gr', 'https://fishing.ddev.site', 'http://fishing.ddev.site', 'capacitor://localhost', 'ionic://localhost'], true)
            || preg_match('~\Ahttps?://(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?\z~', $origin))) {
            $response->headers->set('Access-Control-Allow-Origin', $origin);
            $response->headers->set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
            $response->headers->set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Fishing-User');
            $response->headers->set('Access-Control-Expose-Headers', 'Retry-After');
            $response->headers->set('Access-Control-Max-Age', '600');
        }
        if ($response instanceof JsonResponse || str_contains(strtolower($response->headers->get('Content-Type', '')), 'json')
            || $response->getStatusCode() === 204) {
            $response->headers->set('Cache-Control', 'private, no-store');
            $response->headers->set('Pragma', 'no-cache');
            $response->headers->remove('ETag');
            $response->headers->remove('Last-Modified');
            $response->headers->remove('Expires');
        }
        $response->headers->set('X-Content-Type-Options', 'nosniff');
    }

    public function onException(ExceptionEvent $event): void
    {
        if (!$this->isApi($event->getRequest())) {
            return;
        }
        $exception = $event->getThrowable();
        $status = $exception instanceof ApiException ? $exception->status() : ($exception instanceof HttpExceptionInterface ? $exception->getStatusCode() : 500);
        $message = $exception instanceof ApiException || ($exception instanceof HttpExceptionInterface && $status < 500)
            ? $exception->getMessage() : 'Απρόσμενο σφάλμα διακομιστή.';
        $headers = $exception instanceof HttpExceptionInterface ? $exception->getHeaders() : [];
        if ($status === 401) {
            $headers['WWW-Authenticate'] = 'Bearer';
        }
        $event->setResponse(new JsonResponse(['error' => $message], $status, $headers));
    }

    private function isApi(Request $request): bool
    {
        return $request->getPathInfo() === '/api' || str_starts_with($request->getPathInfo(), '/api/');
    }
}
