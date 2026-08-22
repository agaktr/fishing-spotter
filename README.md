# Fishing Spotter Symfony

Symfony 7.4 API and web application for Fishing Spotter. It replaces the Next.js runtime while preserving the existing MariaDB data and the `/api/*` contract used by the Android application.

Production URL: `https://fishing.apto.gr`

## Requirements

- PHP 8.3 or newer with `ctype`, `iconv`, `json`, `mbstring`, `pdo_mysql` and OpenSSL
- MariaDB 10.11 or newer
- Composer 2 when dependencies are not included in the uploaded release
- Outbound HTTPS access to Nominatim, Overpass, OpenTopoData and Open-Meteo
- A domain document root pointed at `public/`

Node.js is only required when rebuilding browser assets. Compiled `public/build/` assets are committed so production runs entirely through PHP after `git pull` and `composer install`.

## Local Development

From `/srv/projects/fishing`:

```bash
ddev start
ddev composer install
ddev exec npm ci
ddev exec npm run build
ddev exec php bin/console doctrine:migrations:migrate --no-interaction
```

Local URL: `https://fishing.ddev.site`

## Structure

- `src/Controller/ApiController.php`: API-compatible JSON endpoints
- `src/Repository/FishingRepository.php`: MariaDB users, trips, scans and places
- `src/Service/SpotSearchService.php`: geocoding, coastal candidates, conditions, ranking and caching
- `assets/`: React/MapLibre browser client compiled by Webpack Encore
- `templates/`: Symfony Twig mount pages
- `migrations/`: idempotent baseline database migration
- `public/`: the only web-accessible directory

## Identity Warning

The current compatibility API identifies users through `X-Fishing-User`. This is not secure authentication. Protect `/admin` and user-management API routes at the server or reverse-proxy level until proper passwords/tokens and roles are implemented.

See `DEPLOYMENT.md` for upload steps.
