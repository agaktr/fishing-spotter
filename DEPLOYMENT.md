# Production Deployment

## Upload Layout

Upload this Symfony directory outside the public web root where possible, then point the domain document root to its `public/` directory.

Example:

```text
/home/account/apps/fishing/       Symfony application
/home/account/apps/fishing/public Domain document root
```

Do not point the domain at the Symfony project root. Only `public/` should be web-accessible.

## Environment

Create `.env.local` on the server using `.env.prod.example` as a guide:

```dotenv
APP_ENV=prod
APP_DEBUG=0
APP_SECRET=replace-with-a-long-random-secret
DEFAULT_URI=https://fishing.apto.gr
DATABASE_URL="mysql://user:url-encoded-password@localhost:3306/database?serverVersion=10.11.0-MariaDB&charset=utf8mb4"
TRIP_MEDIA_DIR="%kernel.project_dir%/var/trip-media"
```

Use the actual MariaDB version in `serverVersion`. URL-encode special characters in the database username or password.

## Database

Back up the production database, then run:

```bash
php bin/console doctrine:migrations:migrate --no-interaction
```

The baseline migration uses `CREATE TABLE IF NOT EXISTS`, so it supports both a fresh database and the existing Fishing Spotter schema without dropping data.

## Dependencies And Assets

The Git repository includes compiled `public/build/` assets, so production does not need Node.js for a normal pull. Install PHP dependencies after cloning or pulling:

```bash
composer install --no-dev --prefer-dist --optimize-autoloader
```

Only run `npm ci && npm run build` when changing files under `assets/`, then commit the updated `public/build/` output.

## Finalization

```bash
APP_ENV=prod APP_DEBUG=0 php bin/console cache:clear
APP_ENV=prod APP_DEBUG=0 php bin/console cache:warmup
```

Create `var/trip-media/` and grant the PHP-FPM/Apache user write access to it, `var/cache/`, and `var/log/`, but not to source or configuration files. The media directory contains private user files and must remain outside `public/`.

Configure PHP to accept one 10 MB image per request; for example, use `upload_max_filesize=12M` and `post_max_size=12M`. The clients upload multi-image selections one file at a time.

Back up both MariaDB and `TRIP_MEDIA_DIR`. Restoring only the database will leave media metadata without files, while restoring only the folder will leave unreferenced images.

Verify:

- `/` loads the map.
- `/admin` loads user management.
- `/api` returns the API manifest.
- `OPTIONS /api/spots` returns HTTP 204.
- The server can make outbound HTTPS requests.
- HTTPS is enabled, which is required for browser geolocation and the Android API.
- A private and a public trip image can be uploaded and viewed with their expected visibility.

## Apache

`public/.htaccess` handles front-controller routing when `mod_rewrite` is available. The virtual host must allow overrides for the `public/` directory.

## Nginx

Use a front-controller location similar to:

```nginx
root /home/account/apps/fishing/public;
index index.php;

location / {
    try_files $uri /index.php$is_args$args;
}

location ~ ^/index\.php(/|$) {
    fastcgi_pass unix:/run/php/php8.3-fpm.sock;
    fastcgi_split_path_info ^(.+\.php)(/.*)$;
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    internal;
}
```

Adjust the PHP-FPM socket for the installed PHP version.

## Mobile Cutover

The Android app's Account screen accepts an API base URL. Set it to the permanent HTTPS domain after deployment. A future APK can make that domain the default.
