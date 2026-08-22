<?php

namespace App\EventSubscriber;

use App\Exception\ApiException;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\KernelEvents;

final class ApiSubscriber implements EventSubscriberInterface
{
    private const HEADERS = [
        'Access-Control-Allow-Origin' => '*',
        'Access-Control-Allow-Methods' => 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers' => 'Content-Type, X-Fishing-User',
        'Access-Control-Max-Age' => '86400',
    ];

    public static function getSubscribedEvents(): array
    {
        return [
            KernelEvents::REQUEST => ['onRequest', 2048],
            KernelEvents::RESPONSE => 'onResponse',
            KernelEvents::EXCEPTION => 'onException',
        ];
    }

    public function onRequest(RequestEvent $event): void
    {
        $request = $event->getRequest();
        if ($request->isMethod('OPTIONS') && str_starts_with($request->getPathInfo(), '/api/')) {
            $event->setResponse(new JsonResponse(null, 204, self::HEADERS));
        }
    }

    public function onResponse(ResponseEvent $event): void
    {
        if (!str_starts_with($event->getRequest()->getPathInfo(), '/api')) {
            return;
        }
        foreach (self::HEADERS as $name => $value) {
            $event->getResponse()->headers->set($name, $value);
        }
    }

    public function onException(ExceptionEvent $event): void
    {
        if (!str_starts_with($event->getRequest()->getPathInfo(), '/api')) {
            return;
        }
        $exception = $event->getThrowable();
        $status = $exception instanceof ApiException ? $exception->status() : 500;
        $message = $exception instanceof ApiException ? $exception->getMessage() : 'Απρόσμενο σφάλμα διακομιστή.';
        $event->setResponse(new JsonResponse(['error' => $message], $status));
    }
}
