<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260905180954 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Verified ownership, private publication, truthful trip outcomes and private saved places';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE users ADD password_hash VARCHAR(255) DEFAULT NULL, ADD role VARCHAR(16) NOT NULL DEFAULT 'user'");
        $this->addSql("CREATE TABLE auth_tokens (token_hash CHAR(64) NOT NULL PRIMARY KEY, user_id CHAR(36) NOT NULL, expires_at DATETIME NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX auth_tokens_user_idx (user_id), INDEX auth_tokens_expiry_idx (expires_at), CONSTRAINT auth_tokens_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $this->addSql("CREATE TABLE auth_invitations (token_hash CHAR(64) NOT NULL PRIMARY KEY, user_id CHAR(36) NOT NULL, expires_at DATETIME NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX auth_invitations_user_idx (user_id), INDEX auth_invitations_expiry_idx (expires_at), CONSTRAINT auth_invitations_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $this->addSql("CREATE TABLE auth_login_attempts (attempt_key CHAR(64) NOT NULL PRIMARY KEY, attempts INT NOT NULL DEFAULT 0, window_started_at DATETIME NOT NULL, INDEX auth_attempts_window_idx (window_started_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $this->addSql("ALTER TABLE trips ADD recording_mode VARCHAR(16) NOT NULL DEFAULT 'live', ADD ended_at DATETIME DEFAULT NULL, ADD outcome VARCHAR(20) NOT NULL DEFAULT 'not-recorded', ADD fishing_minutes INT UNSIGNED DEFAULT NULL, ADD angler_count SMALLINT UNSIGNED DEFAULT NULL, ADD conditions_recorded_at DATETIME DEFAULT NULL, ADD public_location_precision VARCHAR(16) NOT NULL DEFAULT 'approximate', ADD share_notes BOOLEAN NOT NULL DEFAULT FALSE, ADD shared_media_json JSON DEFAULT NULL");
        // Legacy action timestamps do not establish when fishing ended, or whether an empty log means zero catch.
        $this->addSql("UPDATE trips SET recording_mode = 'historical' WHERE status = 'completed'");
        $this->addSql("UPDATE trips SET outcome = 'recorded' WHERE JSON_LENGTH(fish_records_json) > 0");
        $this->addSql("ALTER TABLE places ADD provenance VARCHAR(16) NOT NULL DEFAULT 'legacy', ADD INDEX places_provenance_idx (provenance)");
        $this->addSql("CREATE TABLE saved_places (id CHAR(36) NOT NULL PRIMARY KEY, user_id CHAR(36) NOT NULL, name VARCHAR(255) NOT NULL, latitude DECIMAL(10,7) NOT NULL, longitude DECIMAL(10,7) NOT NULL, technique VARCHAR(40) NOT NULL, notes TEXT NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), UNIQUE KEY saved_places_user_point_unique (user_id, latitude, longitude, technique), INDEX saved_places_user_updated_idx (user_id, updated_at), CONSTRAINT saved_places_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }

    public function down(Schema $schema): void
    {
        $this->abortIf(true, 'This migration preserves existing accounts and journals; removing ownership and diary data requires an explicit recovery plan.');
    }

    public function isTransactional(): bool
    {
        return false;
    }
}
