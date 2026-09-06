# Account Ownership And Authentication

Authentication is bearer-only. A username, `X-Fishing-User`, a cookie, or a query parameter never proves ownership. Existing passwordless accounts cannot log in or self-claim: an operator must verify ownership outside the application and issue an invitation. There is no public registration or unauthenticated password reset.

## Integration Prerequisites

- Apply the separately owned authentication migration before using these endpoints. This implementation does not create or migrate application tables.
- Remove the old session and user-management routes from `ApiController`; `AuthController` owns them, retaining their existing route names.
- Inject the shared `AuthService` into other controllers. Use `$auth->user($request)` for private endpoints, `$auth->user($request, false)` for optional identity, and `$auth->admin($request)` for administrator operations. Remove every call to the legacy repository `requestUser()` authentication path.
- `user(..., false)` returns `null` only when Authorization is absent. Supplied malformed, unknown, expired, revoked or suspended credentials return 401, even on public endpoints. A legacy identity header without Authorization is ignored on public endpoints and cannot satisfy private authentication.
- Enforce ownership and hide suspended users' public trips, media and other content in the separately owned repository/controller integration. Authentication alone does not filter public content. Do not cache public media in a way that defeats suspension or privacy changes.
- Update clients to send `Authorization: Bearer <token>` and handle 401 by clearing their session. Private images need authenticated fetches, not token-bearing image URLs. Remove username-only login and self-registration UI.
- Update the older identity warnings/API manifest in the separately owned README and controller after integration.

## Database Contract

All services use the application's shared Doctrine DBAL `Connection`, with MariaDB/InnoDB transactions and UTC timestamps. Required schema:

- `users`: existing fields plus nullable `password_hash VARCHAR(255)` and `role VARCHAR(16) NOT NULL DEFAULT 'user'`. Keep the unique username constraint and existing UTC `created_at`/`updated_at` behavior.
- `auth_tokens` and `auth_invitations`: `token_hash CHAR(64) PRIMARY KEY`, `user_id CHAR(36) NOT NULL`, `expires_at DATETIME NOT NULL`, `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`, user index, and user foreign key with `ON DELETE CASCADE`. User ID columns must use the same character set/collation as `users.id` (`utf8mb4_unicode_ci` in the baseline).
- `auth_login_attempts`: `attempt_key CHAR(64) PRIMARY KEY`, `attempts INT NOT NULL DEFAULT 0`, `window_started_at DATETIME NOT NULL`.

Tokens contain 32 cryptographically random bytes encoded as 64 lowercase hexadecimal characters. Only SHA-256 hashes are persisted. Bearer sessions expire after 30 days; invitations expire after 48 hours and are single-use. Passwords use `password_hash(..., PASSWORD_ARGON2ID)` and `password_verify()`. PHP must support Argon2id; local DDEV support is verified. Passwords must contain 12-128 UTF-8 characters, with no trimming, case conversion, or bcrypt-style truncation. Usernames are trimmed, lowercased, and limited to 2-64 letters, numbers, dots, underscores or hyphens.

Every `ApiUser` contains exactly `id`, `username`, `displayName`, `active` (boolean), `role` (`admin` or `user`), `createdAt`, and `updatedAt`. Timestamps are ISO 8601 UTC. Password and token hashes are never included in API users.

## API

All request bodies below are JSON objects. Authentication bodies are limited to 16 KiB. Failures are JSON `{ "error": "..." }`.

| Method And Path | Body / Authorization | Success |
| --- | --- | --- |
| `POST /api/session` | `{username,password}` | 200 `{user,token,expiresAt}` |
| `GET /api/session` | Bearer | 200 `{user}` |
| `DELETE /api/session` | Bearer | 204; revokes only the presented token |
| `POST /api/activate` | `{username,invitationToken,password}` | 200 `{user,token,expiresAt}` |
| `GET /api/users` | Admin bearer; optional `?includeInactive=0` | 200 `{users}`; includes inactive accounts by default |
| `POST /api/users` | Admin bearer, `{username,displayName?}` | 201 `{user,invitationToken,expiresAt}` |
| `PATCH /api/users/{id}` | Admin bearer, any of `{displayName,active,role}` | 200 `{user}` |
| `POST /api/users/{id}/invitation` | Admin bearer; no body needed | 200 `{invitationToken,expiresAt}` |

Login errors are a generic 401 for unknown, inactive, unactivated and incorrect credentials. Unknown/unactivated accounts still perform password verification using a non-account dummy hash. Activation uses a generic 401 for unknown accounts and invalid/expired/consumed invitations; invalid new password policy is a 400 independent of account existence. Rate limits return 429 with `Retry-After` seconds. Unauthenticated admin routes return 401, ordinary users receive 403, duplicate usernames return 409, and invalid user fields return 400. `WWW-Authenticate: Bearer` accompanies 401 responses.

Logout requires one well-formed bearer header but is idempotent for already-expired/revoked tokens. No tokens are accepted in URLs or cookies. Do not log Authorization headers, passwords, invitation bodies, session responses or command output containing invitations. Do not expose the Symfony profiler or enable debug mode outside local development. Deliver invitation tokens privately through an externally verified channel and enter them into an activation form, never a link.

## Account Administration

API-created accounts are active ordinary users with no password. Creation returns the invitation once. Only administrators can list, create, modify or invite accounts. PATCH does not accept username, password, password hash, or arbitrary fields. Username uniqueness follows the existing case/accent-insensitive database constraint.

Issuing a new invitation invalidates earlier invitations for that account but leaves its existing password/sessions intact until activation. Activation locks the account, atomically consumes the unexpired invitation, sets the password, revokes all earlier sessions and invitations, and issues a new session in one transaction. A retry with a consumed invitation cannot reset the password again. A lost activation response requires normal password login or a new operator-verified invitation.

Inactive accounts cannot authenticate, activate or receive invitations; an administrator must explicitly reactivate them first. Disabling an account immediately deletes its sessions and pending invitations. Re-enabling it does not resurrect deleted credentials. Role changes also revoke sessions, so changed privileges require a fresh login. Requests authenticate against the current active flag and role, not data copied into a token.

Disabling/demoting the last active administrator returns 409. User updates lock the active-admin set before the target account so simultaneous removals cannot both pass the guard. An administrator cannot change their own role through the API (403 when another active admin exists, 409 for the last admin); self-role changes require a verified operator workflow. The invitation CLI only promotes with `--admin`, never demotes. An administrator may change another user's role. Self-disablement is permitted only if another active administrator remains.

## Local Bootstrap

After the parent has applied the agreed migration, run from `/srv/projects/fishing/symfony` on the verified local office-dev DDEV project:

```bash
ddev exec php bin/console app:user:invite operator --admin --display-name="Local Administrator"
```

This command creates `operator` if absent, or invites the existing account after you have externally verified ownership. It prints one 48-hour invitation token. Submit that token, the username and a new 12-128-character password in the JSON body of `POST /api/activate`, then use the returned bearer token. No initial password or privileged account is seeded automatically.

To invite an ordinary user or reset an existing account after verification:

```bash
ddev exec php bin/console app:user:invite verified-username --display-name="Verified User"
```

Omitting `--admin` preserves an existing role; omitting `--display-name` preserves an existing display name. Promotion with `--admin` revokes existing sessions immediately. The command never silently unsuspends an account. Commands above are local bootstrap instructions, not authorization to access or deploy production.

## Rate Limiting

Both login and activation use independent database-backed fixed 15-minute windows: 60 attempts per client IP and 10 per normalized username, including successful requests. Counters are SHA-256 keyed, transactionally upserted and capped at limit + 1. Failed authentication does not roll back counters. The IP budget is checked before creating a username bucket; the username budget is shared across source IPs and canonicalizes existing database collation aliases. Success does not clear an attacker's limits. Malformed JSON/oversized bodies fail before password processing.

`Request::getClientIp()` respects Symfony's configured trusted proxies; do not trust arbitrary client-supplied forwarded headers. The parent/operator must verify trusted-proxy configuration for the intended ingress. Large shared NATs share the IP budget. Rate limits fail closed if the database is unavailable.

The parent should schedule bounded maintenance to delete expired `auth_tokens`/`auth_invitations` and old `auth_login_attempts` windows (for example, older than one day). Expiry is enforced during reads regardless of cleanup. Cleanup is not run by the invitation command or this implementation. Do not reset live attempt windows during ordinary login or activation.

## CORS And Caching

All API JSON and 204 responses, including public responses and errors, default to `Cache-Control: private, no-store`. Validators are removed. API responses vary on `Origin` and `Authorization`. Non-JSON media/depth caching remains the responsibility of its controller.

CORS allows the exact request origin, the known fishing application/DDEV origins, HTTP(S) loopback clients (`localhost`, `127.0.0.1`, `[::1]`, including development ports), and local Capacitor/Ionic origins. This includes the current Android `https://localhost` origin. It permits `Authorization`, exposes `Retry-After`, never emits wildcard origin or `Access-Control-Allow-Credentials`, and does not authenticate legacy `X-Fishing-User` even though that header is allowed for transitional public clients. Untrusted origins receive no CORS grant. CORS is not a substitute for bearer authentication.

## Verification

```bash
ddev exec php tests/auth.php
ddev exec php bin/console lint:container
ddev exec php bin/console app:user:invite --help
```

The dependency-free PHP script uses Composer autoload and local DDEV credentials, not `DATABASE_URL`. It creates connection-local temporary tables that shadow only the four tables touched by authentication; existing user data is neither read nor modified. Tables disappear when the connection closes. Tests cover legacy rejection, token expiry/revocation/hashing, activation and reset, password boundaries and whitespace, admin access/last-admin guards, CLI output, rate windows and collation aliases, CORS, JSON errors and no-store headers. Temporary tables do not validate real foreign keys or multi-connection lock contention; the parent's broader migration/HTTP/concurrency/ownership integration tests must cover those.
