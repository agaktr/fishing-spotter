<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260904120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add active trip lifecycle and private trip media metadata';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE trips ADD status ENUM('active', 'completed') NOT NULL DEFAULT 'completed' AFTER visibility, ADD completed_at DATETIME(3) NULL AFTER trip_date, ADD KEY trips_user_status_index (user_id, status)");
        $this->addSql('UPDATE trips SET completed_at = updated_at WHERE status = \'completed\' AND completed_at IS NULL');
        $this->addSql("CREATE TABLE trip_media (id CHAR(36) NOT NULL, trip_id CHAR(36) NOT NULL, fish_record_id VARCHAR(160) NULL, file_name VARCHAR(255) NOT NULL, thumbnail_name VARCHAR(255) NOT NULL, original_name VARCHAR(255) NOT NULL, mime_type VARCHAR(64) NOT NULL, file_size BIGINT UNSIGNED NOT NULL, width INT UNSIGNED NOT NULL, height INT UNSIGNED NOT NULL, sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (id), KEY trip_media_trip_index (trip_id, sort_order, created_at), KEY trip_media_fish_index (trip_id, fish_record_id, sort_order), CONSTRAINT trip_media_trip_fk FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE trip_media');
        $this->addSql('ALTER TABLE trips DROP KEY trips_user_status_index, DROP completed_at, DROP status');
    }
}
