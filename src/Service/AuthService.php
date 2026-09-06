<?php

declare(strict_types=1);

namespace App\Service;

use App\Exception\ApiException;
use Doctrine\DBAL\Connection;
use Doctrine\DBAL\Exception\UniqueConstraintViolationException;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\TooManyRequestsHttpException;
use Symfony\Component\Uid\Uuid;

final class AuthService
{
    // A non-account hash keeps unknown/unactivated logins on the password verification path.
    private const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=65536,t=4,p=1$Vll5TVBjTVhYT2FUR1FMRQ$3Kxgjb8jF+bdfPPr34Ru9Mg+Ap5ex7FbthDdQ49P9ns';
    private const INVALID_USERNAME = 'Username must contain 2-64 letters, numbers, dots, hyphens or underscores.';

    public function __construct(private readonly Connection $db)
    {
    }

    public function user(Request $request, bool $required = true): ?array
    {
        $token = $this->bearerToken($request);
        if ($token === null) {
            if ($required) {
                throw new ApiException('Authentication required.', 401);
            }

            return null;
        }

        $row = $this->db->fetchAssociative(
            'SELECT u.* FROM users u JOIN auth_tokens t ON t.user_id = u.id WHERE t.token_hash = ? AND t.expires_at > UTC_TIMESTAMP() AND u.active = TRUE AND u.password_hash IS NOT NULL',
            [hash('sha256', $token)],
        );
        if (!$row) {
            throw new ApiException('Invalid or expired session.', 401);
        }

        return $this->mapUser($row);
    }

    public function admin(Request $request): array
    {
        $user = $this->user($request);
        if ($user['role'] !== 'admin') {
            throw new ApiException('Administrator access required.', 403);
        }

        return $user;
    }

    public function login(Request $request, #[\SensitiveParameter] array $input): array
    {
        $username = $this->normalizeUsername($input['username'] ?? null);
        $this->limitAttempts($request, 'login', $username);
        $password = $input['password'] ?? null;
        $validPassword = $this->validPassword($password);

        return $this->db->transactional(function () use ($username, $password, $validPassword): array {
            // Session issuance and credential resets/disablement must lock the same user first.
            $row = $this->db->fetchAssociative('SELECT * FROM users WHERE username = ? FOR UPDATE', [$username]);
            $verified = password_verify($validPassword ? $password : '', $row['password_hash'] ?? self::DUMMY_PASSWORD_HASH);
            if (!$row || !$row['active'] || !$row['password_hash'] || !$validPassword || !$verified) {
                throw new ApiException('Invalid username or password.', 401);
            }

            return $this->issueSession($row);
        });
    }

    public function activate(Request $request, #[\SensitiveParameter] array $input): array
    {
        $username = $this->normalizeUsername($input['username'] ?? null);
        $this->limitAttempts($request, 'activate', $username);
        $password = $input['password'] ?? null;
        if (!$this->validPassword($password)) {
            throw new ApiException('Password must contain 12-128 characters. Spaces are preserved.');
        }
        $token = $input['invitationToken'] ?? null;
        if ($username === null || !is_string($token) || !preg_match('/\A[a-f0-9]{64}\z/', $token)) {
            throw new ApiException('Invalid or expired invitation.', 401);
        }

        // Argon2id preserves the whole password, unlike bcrypt's 72-byte truncation.
        $passwordHash = password_hash($password, PASSWORD_ARGON2ID);

        return $this->db->transactional(function () use ($username, $token, $passwordHash): array {
            $row = $this->db->fetchAssociative('SELECT * FROM users WHERE username = ? FOR UPDATE', [$username]);
            if (!$row || !$row['active']) {
                throw new ApiException('Invalid or expired invitation.', 401);
            }
            $consumed = $this->db->executeStatement(
                'DELETE FROM auth_invitations WHERE token_hash = ? AND user_id = ? AND expires_at > UTC_TIMESTAMP()',
                [hash('sha256', $token), $row['id']],
            );
            if ($consumed !== 1) {
                throw new ApiException('Invalid or expired invitation.', 401);
            }

            $this->db->delete('auth_invitations', ['user_id' => $row['id']]);
            $this->db->delete('auth_tokens', ['user_id' => $row['id']]);
            $this->db->update('users', ['password_hash' => $passwordHash], ['id' => $row['id']]);
            $row = $this->db->fetchAssociative('SELECT * FROM users WHERE id = ?', [$row['id']]);

            return $this->issueSession($row);
        });
    }

    public function logout(Request $request): void
    {
        $token = $this->bearerToken($request) ?? throw new ApiException('Authentication required.', 401);
        // Idempotent even when the presented token has already expired or been revoked.
        $this->db->delete('auth_tokens', ['token_hash' => hash('sha256', $token)]);
    }

    public function users(Request $request, bool $includeInactive = true): array
    {
        $this->admin($request);
        $rows = $this->db->fetchAllAssociative('SELECT * FROM users '.($includeInactive ? '' : 'WHERE active = TRUE ').'ORDER BY username');

        return array_map($this->mapUser(...), $rows);
    }

    public function createUser(Request $request, array $input): array
    {
        $this->admin($request);
        $this->onlyFields($input, ['username', 'displayName']);
        $username = $this->normalizeUsername($input['username'] ?? null) ?? throw new ApiException(self::INVALID_USERNAME);
        $displayName = $this->displayName($input['displayName'] ?? $username);

        try {
            return $this->db->transactional(function () use ($username, $displayName): array {
                $id = Uuid::v4()->toRfc4122();
                $this->db->insert('users', [
                    'id' => $id, 'username' => $username, 'display_name' => $displayName,
                    'active' => 1, 'role' => 'user', 'password_hash' => null,
                ]);
                $row = $this->db->fetchAssociative('SELECT * FROM users WHERE id = ?', [$id]);

                return ['user' => $this->mapUser($row), ...$this->issueInvitation($row)];
            });
        } catch (UniqueConstraintViolationException) {
            throw new ApiException('Username already exists.', 409);
        }
    }

    public function updateUser(Request $request, string $id, array $input): array
    {
        $this->admin($request);
        $this->onlyFields($input, ['displayName', 'active', 'role']);
        $changes = [];
        if (array_key_exists('displayName', $input)) {
            $changes['display_name'] = $this->displayName($input['displayName']);
        }
        if (array_key_exists('active', $input)) {
            if (!is_bool($input['active'])) {
                throw new ApiException('Active must be a boolean.');
            }
            $changes['active'] = $input['active'] ? 1 : 0;
        }
        if (array_key_exists('role', $input)) {
            if (!in_array($input['role'], ['admin', 'user'], true)) {
                throw new ApiException('Role must be admin or user.');
            }
            $changes['role'] = $input['role'];
        }
        if ($changes === []) {
            throw new ApiException('No user changes supplied.');
        }

        return $this->db->transactional(function () use ($request, $id, $changes): array {
            // Lock the whole active-admin set before the target so concurrent removals cannot both pass.
            $admins = $this->db->fetchFirstColumn("SELECT id FROM users WHERE role = 'admin' AND active = TRUE ORDER BY id FOR UPDATE");
            $row = $this->db->fetchAssociative('SELECT * FROM users WHERE id = ? FOR UPDATE', [$id]);
            $actor = $this->admin($request);
            if (!$row) {
                throw new ApiException('User not found.', 404);
            }
            if ($row['role'] === 'admin' && $row['active'] && count($admins) <= 1
                && (($changes['active'] ?? 1) === 0 || ($changes['role'] ?? 'admin') !== 'admin')) {
                throw new ApiException('The last active administrator cannot be disabled or demoted.', 409);
            }
            if ($row['id'] === $actor['id'] && isset($changes['role']) && $changes['role'] !== $actor['role']) {
                throw new ApiException('Only an operator may change your own role.', 403);
            }

            $this->db->update('users', $changes, ['id' => $id]);
            if (($changes['active'] ?? 1) === 0 || (isset($changes['role']) && $changes['role'] !== $row['role'])) {
                $this->db->delete('auth_tokens', ['user_id' => $id]);
            }
            if (($changes['active'] ?? 1) === 0) {
                $this->db->delete('auth_invitations', ['user_id' => $id]);
            }

            return $this->mapUser($this->db->fetchAssociative('SELECT * FROM users WHERE id = ?', [$id]));
        });
    }

    public function invitation(Request $request, string $id): array
    {
        $this->admin($request);

        return $this->db->transactional(function () use ($id): array {
            $row = $this->db->fetchAssociative('SELECT * FROM users WHERE id = ? FOR UPDATE', [$id]);
            if (!$row) {
                throw new ApiException('User not found.', 404);
            }

            return $this->issueInvitation($row);
        });
    }

    /** Operator-only entry point; never expose this method through a public route. */
    public function invite(string $username, bool $admin = false, ?string $displayName = null): array
    {
        $username = $this->normalizeUsername($username) ?? throw new ApiException(self::INVALID_USERNAME);
        $label = $displayName !== null ? $this->displayName($displayName) : null;

        try {
            return $this->db->transactional(function () use ($username, $admin, $label): array {
                $row = $this->db->fetchAssociative('SELECT * FROM users WHERE username = ? FOR UPDATE', [$username]);
                if (!$row) {
                    $id = Uuid::v4()->toRfc4122();
                    $this->db->insert('users', [
                        'id' => $id, 'username' => $username, 'display_name' => $label ?? $username,
                        'active' => 1, 'role' => $admin ? 'admin' : 'user', 'password_hash' => null,
                    ]);
                } else {
                    $id = $row['id'];
                    $changes = [];
                    if ($admin && $row['role'] !== 'admin') {
                        $changes['role'] = 'admin';
                        $this->db->delete('auth_tokens', ['user_id' => $id]);
                    }
                    if ($label !== null) {
                        $changes['display_name'] = $label;
                    }
                    if ($changes !== []) {
                        $this->db->update('users', $changes, ['id' => $id]);
                    }
                }
                $row = $this->db->fetchAssociative('SELECT * FROM users WHERE id = ?', [$id]);

                return ['user' => $this->mapUser($row), ...$this->issueInvitation($row)];
            });
        } catch (UniqueConstraintViolationException) {
            throw new ApiException('Username was created concurrently; retry the invitation.', 409);
        }
    }

    private function issueSession(array $row): array
    {
        $token = bin2hex(random_bytes(32));
        $expiresAt = new \DateTimeImmutable('+30 days', new \DateTimeZone('UTC'));
        $this->db->insert('auth_tokens', [
            'token_hash' => hash('sha256', $token), 'user_id' => $row['id'],
            'expires_at' => $expiresAt->format('Y-m-d H:i:s'),
        ]);

        return ['user' => $this->mapUser($row), 'token' => $token, 'expiresAt' => $expiresAt->format('Y-m-d\TH:i:s\Z')];
    }

    private function issueInvitation(array $row): array
    {
        if (!$row['active']) {
            throw new ApiException('Reactivate the account before issuing an invitation.', 409);
        }
        $token = bin2hex(random_bytes(32));
        $expiresAt = new \DateTimeImmutable('+48 hours', new \DateTimeZone('UTC'));
        $this->db->delete('auth_invitations', ['user_id' => $row['id']]);
        $this->db->insert('auth_invitations', [
            'token_hash' => hash('sha256', $token), 'user_id' => $row['id'],
            'expires_at' => $expiresAt->format('Y-m-d H:i:s'),
        ]);

        return ['invitationToken' => $token, 'expiresAt' => $expiresAt->format('Y-m-d\TH:i:s\Z')];
    }

    private function bearerToken(Request $request): ?string
    {
        // Deliberately ignore legacy identity headers, cookies and query parameters.
        $headers = $request->headers->all('Authorization');
        if ($headers === []) {
            return null;
        }
        if (count($headers) !== 1 || !preg_match('/\A(?i:Bearer)[ \t]+([a-f0-9]{64})\z/', $headers[0], $match)) {
            throw new ApiException('Invalid bearer authorization.', 401);
        }

        return $match[1];
    }

    private function limitAttempts(Request $request, string $operation, ?string $username): void
    {
        // Commit rejected attempts too; throwing inside this transaction would undo the limiter.
        $retryAfter = $this->db->transactional(function () use ($request, $operation, $username): int {
            foreach (['ip' => 60, 'username' => 10] as $scope => $limit) {
                if ($scope === 'ip') {
                    $identity = $request->getClientIp() ?? 'unknown';
                } else {
                    // Resolve aliases accepted by the existing case/accent-insensitive username collation.
                    $identity = $username === null ? '<invalid>' : ($this->db->fetchOne('SELECT username FROM users WHERE username = ?', [$username]) ?: $username);
                }
                $key = hash('sha256', $operation."\0".$scope."\0".$identity);
                $this->db->executeStatement(
                    'INSERT INTO auth_login_attempts (attempt_key, attempts, window_started_at) VALUES (?, 1, UTC_TIMESTAMP()) '
                    .'ON DUPLICATE KEY UPDATE attempts = IF(window_started_at <= UTC_TIMESTAMP() - INTERVAL 15 MINUTE, 1, LEAST(attempts + 1, ?)), '
                    .'window_started_at = IF(window_started_at <= UTC_TIMESTAMP() - INTERVAL 15 MINUTE, UTC_TIMESTAMP(), window_started_at)',
                    [$key, $limit + 1],
                );
                $attempt = $this->db->fetchAssociative(
                    'SELECT attempts, GREATEST(1, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), window_started_at + INTERVAL 15 MINUTE)) AS retry_after FROM auth_login_attempts WHERE attempt_key = ?',
                    [$key],
                );
                if ((int) $attempt['attempts'] > $limit) {
                    return (int) $attempt['retry_after'];
                }
            }

            return 0;
        });
        if ($retryAfter > 0) {
            throw new TooManyRequestsHttpException($retryAfter, 'Too many authentication attempts. Try again later.');
        }
    }

    private function normalizeUsername(mixed $value): ?string
    {
        if (!is_string($value) || strlen($value) > 512 || !mb_check_encoding($value, 'UTF-8')) {
            return null;
        }
        $value = mb_strtolower(trim($value), 'UTF-8');

        return preg_match('/\A[\p{L}\p{N}._-]{2,64}\z/u', $value) ? $value : null;
    }

    private function validPassword(#[\SensitiveParameter] mixed $value): bool
    {
        return is_string($value) && strlen($value) <= 512 && mb_check_encoding($value, 'UTF-8')
            && mb_strlen($value, 'UTF-8') >= 12 && mb_strlen($value, 'UTF-8') <= 128;
    }

    private function displayName(mixed $value): string
    {
        if (!is_string($value) || !mb_check_encoding($value, 'UTF-8') || ($value = trim($value)) === '' || mb_strlen($value, 'UTF-8') > 100) {
            throw new ApiException('Display name must contain 1-100 characters.');
        }

        return $value;
    }

    private function onlyFields(array $input, array $fields): void
    {
        if (array_diff(array_keys($input), $fields) !== []) {
            throw new ApiException('Unsupported user field.');
        }
    }

    private function mapUser(array $row): array
    {
        return [
            'id' => $row['id'], 'username' => $row['username'], 'displayName' => $row['display_name'],
            'active' => (bool) $row['active'], 'role' => $row['role'] === 'admin' ? 'admin' : 'user',
            'createdAt' => (new \DateTimeImmutable($row['created_at'], new \DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z'),
            'updatedAt' => (new \DateTimeImmutable($row['updated_at'], new \DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z'),
        ];
    }
}
