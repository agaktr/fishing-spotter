# Fishing Spotter Symfony

Symfony 7.4 API and React web application for Fishing Spotter, replacing the Next.js runtime while retaining the existing MariaDB data. The browser (`assets/`) and Android/Capacitor (`../fishin_app/`) clients have been updated together for the new authentication, search, diary and privacy contracts. The `/api/*` prefix remains, but insecure username-only authentication does **not**; old clients need updating for private operations.

- [Product Rules](PRODUCT_RULES.md): implemented behavior, privacy and real-world limits.
- [Authentication](AUTHENTICATION.md): bearer API, activation, administration and rate limits.
- [Deployment](DEPLOYMENT.md): separately maintained production instructions, not a deployment record.

Local URL: `https://fishing.ddev.site`. Production address: `https://fishing.apto.gr`. This upgrade is running locally and has not been deployed to production or installed on a native device.

## Requirements

- PHP 8.3 or newer with `ctype`, `gd`, `iconv`, `json`, `mbstring`, `pdo_mysql`, OpenSSL and Argon2id password support
- MariaDB 10.11 or newer
- Composer 2; Node.js for client builds and tests (local DDEV uses Node 24)
- Outbound HTTPS access to Nominatim, Overpass, EMODnet Bathymetry and Open-Meteo
- Document root at `public/`; writable private media and Symfony cache directories

The runtime is PHP, not a Node server. Browser assets are built into `public/build/`. Trip images live outside `public/` under `TRIP_MEDIA_DIR` (locally `var/trip-media`) and use visibility-checked API routes. Back up media together with MariaDB.

## Local Development

Run from `/srv/projects/fishing/symfony`. The parent `.ddev/config.yaml` sets the container working directory and Composer root to `symfony`.

```bash
ddev start
ddev composer install
ddev exec php bin/console doctrine:migrations:status
ddev export-db --file="/tmp/opencode/fishing-before-migration-$(date +%Y%m%d-%H%M%S).sql.gz"
ddev exec php bin/console doctrine:migrations:migrate --no-interaction
ddev exec npm ci
ddev exec npx tsc --noEmit
ddev exec npm run build
```

Keep dumps outside the repository and web root, in an existing protected backup directory. Preserve the corresponding media backup before migration; do not replace migrations with schema-update commands.

The local logic migration `Version20260905180954` is applied. Its pre-upgrade dump remains at `/tmp/opencode/fishing-before-logic-upgrade.sql.gz`. The migration retains legacy accounts, trips, scans and media while adding ownership/publication/diary fields and private saved places. It does not invent passwords, actual end times or zero catches. Keep before/after row counts and media-preservation evidence with the local handover rather than treating fixed database counts as a product invariant. Automatic rollback is deliberately refused.

## Account Activation

After migration, an operator must verify ownership **outside the application**, including for every legacy account. There is no automatic first-claim, public registration or username-only recovery.

```bash
ddev exec php bin/console app:user:invite operator --admin --display-name="Local Administrator"
ddev exec php bin/console app:user:invite verified-username --display-name="Verified User"
```

Each invocation creates or invites that verified account and prints a single-use, 48-hour invitation. Deliver it privately, never in a URL or log. Use the client's activation form, or `POST /api/activate` with `{username, invitationToken, password}`. Passwords require 12-128 characters. Activation replaces the password, revokes earlier sessions and returns a 30-day bearer session. Subsequent login uses username **and** password at `POST /api/session`.

Omitting `--admin` preserves an existing role; omitting `--display-name` preserves its name. The command does not unsuspend accounts. API requests use `Authorization: Bearer <token>`, including authenticated image fetches; `X-Fishing-User`, cookies and URL parameters are not credentials. See `AUTHENTICATION.md` for the full contract.

## Local Checks

Run these from the Symfony directory. Counts below are upgrade checkpoints, not substitutes for current runner output or the final integration report.

| Suite | Command | Checkpoint |
| --- | --- | --- |
| Authentication | `ddev exec php tests/auth.php` | 207 checks |
| Search | `ddev exec php tests/search.php` | 152 assertions |
| Trips, privacy, media, insights | `ddev exec php tests/trips.php` | 220 checks |
| Real local HTTP integration | `ddev exec php tests/http.php` | 1,114 checks across 185 requests |
| Browser contracts | `ddev exec node --test assets/lib/client/api.test.mjs` | 26 tests |
| Android-client contracts | `ddev exec --dir=/var/www/html/fishin_app node --test src/contracts.test.mjs` | 44 tests |

`auth.php` and `trips.php` shadow application tables with connection-local temporary tables; trip test media is temporary. `search.php` mocks providers. Client tests compile in memory and mock network calls. `http.php` is restricted to local fishing DDEV: it commits disposable fixtures, exercises real routes/foreign keys/media, cleans its fixtures and compares all pre-existing row fingerprints and media. Run it without concurrent database/media changes. None of these suites certifies live providers, production or a native installation.

```bash
ddev exec php bin/console lint:container
ddev exec php bin/console lint:yaml config/
ddev exec php bin/console lint:twig templates/
ddev exec php bin/console app:user:invite --help
ddev exec --dir=/var/www/html/fishin_app npm ci
ddev exec --dir=/var/www/html/fishin_app npm run build
```

The Android-client build compiles TypeScript and Vite assets only; it is not an APK installation. The signed debug update is `../fishin_app/FishingSpotter-v1.4.0-debug.apk` (versionCode 7), using the existing application ID and debug certificate. It requires this updated backend for private operations. Chrome workflows were checked at 1440x1200 and 390x844; real-device WebView, GPS, camera, keyboard and OS lifecycle checks remain separate.

## Maintenance

- Back up database and private media together; preserve migration and test conservation evidence. Deleting a scan does not erase provider caches, logs or backups.
- Expiry is enforced even if rows remain stored. There is currently **no expiry-cleanup command or scheduled job**. Arrange reviewed, bounded maintenance for expired `auth_tokens`/`auth_invitations` and old `auth_login_attempts` windows (for example, older than a day). Prefer a reviewed Console maintenance workflow over ad hoc SQL; it is not implemented here. Never clear live rate-limit windows as routine cleanup.
- Monitor provider failures, media storage and database availability. Keep credentials/invitations out of logs and debug tooling; production settings remain the responsibility of the deployment workflow.

## Code Map

- `src/Controller/ApiController.php`: search, owner-scoped diary/library/insights, public projections and media.
- `src/Controller/AuthController.php`, `src/Service/AuthService.php`, `src/Command/UserInviteCommand.php`: verified ownership and account administration.
- `src/Service/TripRules.php`, `src/Repository/FishingRepository.php`: validation, persistence, publication filtering and observed-outcome summaries.
- `src/Service/SpotSearchService.php`: structured intent, provider timestamps/coverage, coarse bathymetry and heuristic ranking.
- `src/Service/TripMediaStorage.php`: validated images and thumbnails outside the web root.
- `assets/`, `templates/`, `../fishin_app/src/`: coordinated browser and Android clients; `migrations/` and `tests/` hold schema history and executable checks.
