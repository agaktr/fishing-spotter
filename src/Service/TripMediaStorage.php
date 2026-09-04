<?php

namespace App\Service;

use App\Exception\ApiException;
use Symfony\Component\HttpFoundation\File\UploadedFile;
use Symfony\Component\Uid\Uuid;

final class TripMediaStorage
{
    private const MAX_BYTES = 10 * 1024 * 1024;
    private const MAX_PIXELS = 40_000_000;
    private const DISPLAY_MAX_EDGE = 2560;
    private const THUMBNAIL_MAX_EDGE = 480;
    private const EXTENSIONS = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
    ];

    public function __construct(private readonly string $tripMediaDir)
    {
    }

    public function store(string $tripId, UploadedFile $upload): array
    {
        if (!$upload->isValid()) {
            throw new ApiException('Η μεταφόρτωση της εικόνας απέτυχε.');
        }
        $size = $upload->getSize();
        if ($size === false || $size <= 0 || $size > self::MAX_BYTES) {
            throw new ApiException('Κάθε εικόνα πρέπει να είναι έως 10 MB.');
        }

        $path = $upload->getPathname();
        $imageInfo = @getimagesize($path);
        $mime = is_array($imageInfo) ? ($imageInfo['mime'] ?? null) : null;
        if (!is_string($mime) || !isset(self::EXTENSIONS[$mime])) {
            throw new ApiException('Υποστηρίζονται μόνο εικόνες JPEG, PNG και WebP.');
        }
        $width = (int) ($imageInfo[0] ?? 0);
        $height = (int) ($imageInfo[1] ?? 0);
        if ($width <= 0 || $height <= 0 || $width * $height > self::MAX_PIXELS) {
            throw new ApiException('Η ανάλυση της εικόνας είναι υπερβολικά μεγάλη.');
        }

        $sourceData = @file_get_contents($path);
        $source = is_string($sourceData) ? @imagecreatefromstring($sourceData) : false;
        if (!$source instanceof \GdImage) {
            throw new ApiException('Η εικόνα δεν μπορεί να διαβαστεί.');
        }
        if ($mime === 'image/jpeg') {
            $source = $this->orientJpeg($source, $path);
            $width = imagesx($source);
            $height = imagesy($source);
        }

        $id = Uuid::v4()->toRfc4122();
        $extension = self::EXTENSIONS[$mime];
        $fileName = $id.'.'.$extension;
        $thumbnailName = $id.'-thumb.'.$extension;
        $directory = $this->tripDirectory($tripId);
        if (!is_dir($directory) && !@mkdir($directory, 0775, true) && !is_dir($directory)) {
            imagedestroy($source);
            throw new \RuntimeException('Trip media directory could not be created.');
        }

        $display = $this->resize($source, self::DISPLAY_MAX_EDGE);
        $thumbnail = $this->resize($source, self::THUMBNAIL_MAX_EDGE);
        $displayWidth = imagesx($display);
        $displayHeight = imagesy($display);
        try {
            $this->writeImage($display, $directory.'/'.$fileName, $mime);
            $this->writeImage($thumbnail, $directory.'/'.$thumbnailName, $mime);
        } catch (\Throwable $error) {
            @unlink($directory.'/'.$fileName);
            @unlink($directory.'/'.$thumbnailName);
            throw $error;
        } finally {
            imagedestroy($source);
            imagedestroy($display);
            imagedestroy($thumbnail);
        }

        return [
            'id' => $id,
            'fileName' => $fileName,
            'thumbnailName' => $thumbnailName,
            'originalName' => mb_substr(basename($upload->getClientOriginalName()) ?: 'image.'.$extension, 0, 255),
            'mimeType' => $mime,
            'fileSize' => (int) filesize($directory.'/'.$fileName),
            'width' => $displayWidth,
            'height' => $displayHeight,
        ];
    }

    public function path(string $tripId, string $fileName): string
    {
        if (basename($fileName) !== $fileName) {
            throw new ApiException('Η εικόνα δεν βρέθηκε.', 404);
        }
        $path = $this->tripDirectory($tripId).'/'.$fileName;
        if (!is_file($path)) {
            throw new ApiException('Η εικόνα δεν βρέθηκε.', 404);
        }

        return $path;
    }

    public function deleteFiles(string $tripId, string $fileName, string $thumbnailName): void
    {
        @unlink($this->tripDirectory($tripId).'/'.basename($fileName));
        @unlink($this->tripDirectory($tripId).'/'.basename($thumbnailName));
    }

    public function deleteTrip(string $tripId): void
    {
        $directory = $this->tripDirectory($tripId);
        if (!is_dir($directory)) {
            return;
        }
        foreach (glob($directory.'/*') ?: [] as $file) {
            if (is_file($file)) {
                @unlink($file);
            }
        }
        @rmdir($directory);
    }

    private function tripDirectory(string $tripId): string
    {
        return rtrim($this->tripMediaDir, '/').'/'.$tripId;
    }

    private function resize(\GdImage $source, int $maxEdge): \GdImage
    {
        $sourceWidth = imagesx($source);
        $sourceHeight = imagesy($source);
        $ratio = min(1, $maxEdge / max($sourceWidth, $sourceHeight));
        $width = max(1, (int) round($sourceWidth * $ratio));
        $height = max(1, (int) round($sourceHeight * $ratio));
        $target = imagecreatetruecolor($width, $height);
        imagealphablending($target, false);
        imagesavealpha($target, true);
        imagecopyresampled($target, $source, 0, 0, 0, 0, $width, $height, $sourceWidth, $sourceHeight);

        return $target;
    }

    private function writeImage(\GdImage $image, string $path, string $mime): void
    {
        $written = match ($mime) {
            'image/jpeg' => imagejpeg($image, $path, 88),
            'image/png' => imagepng($image, $path, 7),
            'image/webp' => imagewebp($image, $path, 86),
            default => false,
        };
        if (!$written) {
            throw new \RuntimeException('Trip image could not be written.');
        }
    }

    private function orientJpeg(\GdImage $source, string $path): \GdImage
    {
        $orientation = function_exists('exif_read_data') ? (@exif_read_data($path)['Orientation'] ?? 1) : 1;
        $rotated = match ($orientation) {
            3 => imagerotate($source, 180, 0),
            6 => imagerotate($source, -90, 0),
            8 => imagerotate($source, 90, 0),
            default => false,
        };
        if ($rotated instanceof \GdImage) {
            imagedestroy($source);

            return $rotated;
        }

        return $source;
    }
}
