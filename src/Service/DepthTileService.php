<?php

namespace App\Service;

use Psr\Cache\CacheItemPoolInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

final class DepthTileService
{
    private const SOURCE_URL = 'https://tiles.emodnet-bathymetry.eu/v12/mean_multicolour/web_mercator/%d/%d/%d.png';
    private const MAX_ZOOM = 15;

    /** @var list<array{depth: float, color: array{int, int, int}}> */
    private const SOURCE_SCALE = [
        ['depth' => 0.0, 'color' => [255, 102, 106]],
        ['depth' => 10.0, 'color' => [249, 0, 24]],
        ['depth' => 50.0, 'color' => [255, 255, 13]],
        ['depth' => 150.0, 'color' => [216, 251, 0]],
        ['depth' => 450.0, 'color' => [106, 251, 0]],
        ['depth' => 1000.0, 'color' => [0, 0, 246]],
        ['depth' => 2000.0, 'color' => [11, 23, 250]],
        ['depth' => 3500.0, 'color' => [0, 0, 62]],
    ];

    /** @var list<array{depth: float, color: array{int, int, int}}> */
    private const FISHING_SCALE = [
        ['depth' => 0.0, 'color' => [239, 68, 68]],
        ['depth' => 25.0, 'color' => [249, 115, 22]],
        ['depth' => 50.0, 'color' => [250, 204, 21]],
        ['depth' => 75.0, 'color' => [132, 204, 22]],
        ['depth' => 100.0, 'color' => [16, 185, 129]],
        ['depth' => 125.0, 'color' => [6, 182, 212]],
        ['depth' => 150.0, 'color' => [37, 99, 235]],
    ];

    public function __construct(
        private readonly HttpClientInterface $http,
        private readonly CacheItemPoolInterface $cache,
    ) {
    }

    public function tile(int $zoom, int $x, int $y): string
    {
        $limit = 2 ** $zoom;
        if ($zoom < 0 || $zoom > self::MAX_ZOOM || $x < 0 || $y < 0 || $x >= $limit || $y >= $limit) {
            throw new \InvalidArgumentException('Invalid depth tile coordinates.');
        }

        $cacheItem = $this->cache->getItem(sprintf('depth_tile_v2_%d_%d_%d', $zoom, $x, $y));
        if ($cacheItem->isHit() && is_string($cacheItem->get())) {
            return $cacheItem->get();
        }

        $response = $this->http->request('GET', sprintf(self::SOURCE_URL, $zoom, $x, $y), [
            'timeout' => 15,
        ]);
        if ($response->getStatusCode() !== 200) {
            throw new \RuntimeException('The bathymetry source did not return a tile.');
        }

        $tile = $this->recolor($response->getContent());
        $cacheItem->set($tile);
        $cacheItem->expiresAfter(2592000);
        $this->cache->save($cacheItem);

        return $tile;
    }

    private function recolor(string $png): string
    {
        $source = @imagecreatefromstring($png);
        if (!$source instanceof \GdImage) {
            throw new \RuntimeException('The bathymetry source returned an invalid image.');
        }

        $width = imagesx($source);
        $height = imagesy($source);
        $output = imagecreatetruecolor($width, $height);
        imagealphablending($output, false);
        imagesavealpha($output, true);
        $transparent = imagecolorallocatealpha($output, 0, 0, 0, 127);
        imagefill($output, 0, 0, $transparent);

        /** @var array<int, array{int, int, int}> $colorCache */
        $colorCache = [];
        for ($y = 0; $y < $height; ++$y) {
            for ($x = 0; $x < $width; ++$x) {
                $rgba = imagecolorsforindex($source, imagecolorat($source, $x, $y));
                if ($rgba['alpha'] >= 120) {
                    continue;
                }

                $key = (($rgba['red'] >> 2) << 12) | (($rgba['green'] >> 2) << 6) | ($rgba['blue'] >> 2);
                $target = $colorCache[$key] ??= $this->fishingColor($this->depthForColor([
                    $rgba['red'],
                    $rgba['green'],
                    $rgba['blue'],
                ]));
                imagesetpixel($output, $x, $y, ($rgba['alpha'] << 24) | ($target[0] << 16) | ($target[1] << 8) | $target[2]);
            }
        }

        ob_start();
        imagepng($output, null, 6);
        $result = ob_get_clean();
        imagedestroy($source);
        imagedestroy($output);

        if (!is_string($result)) {
            throw new \RuntimeException('Could not encode the depth tile.');
        }

        return $result;
    }

    /** @param array{int, int, int} $color */
    private function depthForColor(array $color): float
    {
        $bestDistance = INF;
        $bestDepth = 0.0;

        for ($index = 0, $last = count(self::SOURCE_SCALE) - 1; $index < $last; ++$index) {
            $start = self::SOURCE_SCALE[$index];
            $end = self::SOURCE_SCALE[$index + 1];
            $vector = [
                $end['color'][0] - $start['color'][0],
                $end['color'][1] - $start['color'][1],
                $end['color'][2] - $start['color'][2],
            ];
            $lengthSquared = $vector[0] ** 2 + $vector[1] ** 2 + $vector[2] ** 2;
            $progress = max(0.0, min(1.0, (
                ($color[0] - $start['color'][0]) * $vector[0]
                + ($color[1] - $start['color'][1]) * $vector[1]
                + ($color[2] - $start['color'][2]) * $vector[2]
            ) / $lengthSquared));
            $projected = [
                $start['color'][0] + $progress * $vector[0],
                $start['color'][1] + $progress * $vector[1],
                $start['color'][2] + $progress * $vector[2],
            ];
            $distance = ($color[0] - $projected[0]) ** 2
                + ($color[1] - $projected[1]) ** 2
                + ($color[2] - $projected[2]) ** 2;

            if ($distance < $bestDistance) {
                $bestDistance = $distance;
                $bestDepth = $start['depth'] + $progress * ($end['depth'] - $start['depth']);
            }
        }

        return $bestDepth;
    }

    /** @return array{int, int, int} */
    private function fishingColor(float $depth): array
    {
        if ($depth > 150.0) {
            return [23, 37, 84];
        }

        for ($index = 0, $last = count(self::FISHING_SCALE) - 1; $index < $last; ++$index) {
            $start = self::FISHING_SCALE[$index];
            $end = self::FISHING_SCALE[$index + 1];
            if ($depth > $end['depth']) {
                continue;
            }

            $progress = ($depth - $start['depth']) / ($end['depth'] - $start['depth']);

            return [
                (int) round($start['color'][0] + $progress * ($end['color'][0] - $start['color'][0])),
                (int) round($start['color'][1] + $progress * ($end['color'][1] - $start['color'][1])),
                (int) round($start['color'][2] + $progress * ($end['color'][2] - $start['color'][2])),
            ];
        }

        return self::FISHING_SCALE[array_key_last(self::FISHING_SCALE)]['color'];
    }
}
