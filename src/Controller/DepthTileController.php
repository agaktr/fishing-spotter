<?php

namespace App\Controller;

use App\Service\DepthTileService;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class DepthTileController
{
    #[Route(
        '/api/depth-tiles/{zoom}/{x}/{y}.png',
        name: 'api_depth_tile',
        requirements: ['zoom' => '(?:[0-9]|1[0-5])', 'x' => '\d+', 'y' => '\d+'],
        methods: ['GET'],
    )]
    public function __invoke(int $zoom, int $x, int $y, DepthTileService $tiles): Response
    {
        try {
            $png = $tiles->tile($zoom, $x, $y);
        } catch (\InvalidArgumentException) {
            return new Response('', Response::HTTP_NOT_FOUND);
        }

        return new Response($png, Response::HTTP_OK, [
            'Content-Type' => 'image/png',
            'Cache-Control' => 'public, max-age=2592000, immutable',
            'Access-Control-Allow-Origin' => '*',
        ]);
    }
}
