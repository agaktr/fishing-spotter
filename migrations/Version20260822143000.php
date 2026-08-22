<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260822143000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Baseline Fishing Spotter schema, preserving MariaDB JSON, enum and timestamp behavior';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("CREATE TABLE IF NOT EXISTS users (id CHAR(36) NOT NULL, username VARCHAR(64) NOT NULL, display_name VARCHAR(100) NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), PRIMARY KEY (id), UNIQUE KEY users_username_unique (username)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $this->addSql("CREATE TABLE IF NOT EXISTS places (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, external_key VARCHAR(160) NOT NULL, name VARCHAR(255) NOT NULL, category VARCHAR(40) NOT NULL, latitude DECIMAL(10,7) NOT NULL, longitude DECIMAL(10,7) NOT NULL, data_quality VARCHAR(24) NOT NULL DEFAULT 'generated', tags_json JSON NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), PRIMARY KEY (id), UNIQUE KEY places_external_key_unique (external_key), KEY places_coordinates_index (latitude, longitude), KEY places_category_index (category)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $this->addSql("CREATE TABLE IF NOT EXISTS scans (id CHAR(36) NOT NULL, user_id CHAR(36) NULL, query_text VARCHAR(500) NOT NULL, technique VARCHAR(40) NOT NULL, location_label VARCHAR(255) NOT NULL, center_latitude DECIMAL(10,7) NOT NULL, center_longitude DECIMAL(10,7) NOT NULL, radius_km SMALLINT UNSIGNED NOT NULL, result_limit SMALLINT UNSIGNED NOT NULL, result_count SMALLINT UNSIGNED NOT NULL, request_json JSON NOT NULL, response_json JSON NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (id), KEY scans_user_created_index (user_id, created_at), KEY scans_created_index (created_at), CONSTRAINT scans_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $this->addSql("CREATE TABLE IF NOT EXISTS scan_places (scan_id CHAR(36) NOT NULL, place_id BIGINT UNSIGNED NOT NULL, rank_number SMALLINT UNSIGNED NOT NULL, score SMALLINT UNSIGNED NOT NULL, snapshot_json JSON NOT NULL, PRIMARY KEY (scan_id, place_id), KEY scan_places_place_index (place_id), CONSTRAINT scan_places_scan_fk FOREIGN KEY (scan_id) REFERENCES scans (id) ON DELETE CASCADE, CONSTRAINT scan_places_place_fk FOREIGN KEY (place_id) REFERENCES places (id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $this->addSql("CREATE TABLE IF NOT EXISTS trips (id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL, place_id BIGINT UNSIGNED NULL, visibility ENUM('private', 'public') NOT NULL DEFAULT 'private', trip_date DATETIME NOT NULL, technique VARCHAR(40) NOT NULL, technique_label VARCHAR(100) NOT NULL, location_name VARCHAR(255) NOT NULL, latitude DECIMAL(10,7) NOT NULL, longitude DECIMAL(10,7) NOT NULL, source_spot_id VARCHAR(160) NULL, score SMALLINT UNSIGNED NOT NULL DEFAULT 0, fish_records_json JSON NOT NULL, notes TEXT NOT NULL, conditions_label TEXT NOT NULL, depth_label TEXT NOT NULL, seabed_label VARCHAR(255) NOT NULL, weather_json JSON NOT NULL, marine_json JSON NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), PRIMARY KEY (id), KEY trips_user_date_index (user_id, trip_date), KEY trips_visibility_date_index (visibility, trip_date), KEY trips_place_index (place_id), CONSTRAINT trips_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT, CONSTRAINT trips_place_fk FOREIGN KEY (place_id) REFERENCES places (id) ON DELETE SET NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }

    public function down(Schema $schema): void
    {
        $this->abortIf(true, 'The baseline migration is intentionally non-destructive.');
    }
}
