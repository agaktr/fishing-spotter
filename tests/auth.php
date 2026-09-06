<?php

declare(strict_types=1);

use App\Command\UserInviteCommand;
use App\Controller\AuthController;
use App\EventSubscriber\ApiSubscriber;
use App\Exception\ApiException;
use App\Kernel;
use App\Service\AuthService;
use Doctrine\DBAL\DriverManager;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\TooManyRequestsHttpException;
use Symfony\Component\HttpKernel\HttpKernelInterface;

require dirname(__DIR__).'/vendor/autoload.php';

if (!getenv('IS_DDEV_PROJECT')) {
    throw new RuntimeException('Run through local DDEV: ddev exec php tests/auth.php');
}

// Deliberately never load DATABASE_URL. These are DDEV's local, non-secret defaults.
$db = DriverManager::getConnection([
    'driver' => 'pdo_mysql', 'host' => 'db', 'port' => 3306,
    'dbname' => 'db', 'user' => 'db', 'password' => 'db', 'charset' => 'utf8mb4',
]);
$checks = 0;
$check = static function (bool $condition, string $message) use (&$checks): void {
    ++$checks;
    if (!$condition) {
        throw new RuntimeException($message);
    }
};
$expect = static function (callable $action, int $status) use ($check): Throwable {
    try {
        $action();
    } catch (ApiException|HttpExceptionInterface $error) {
        $actual = $error instanceof ApiException ? $error->status() : $error->getStatusCode();
        $check($actual === $status, 'Expected HTTP '.$status.', got '.$actual.'.');

        return $error;
    }
    throw new RuntimeException('Expected HTTP '.$status.', but the operation succeeded.');
};
$request = static function (?string $token = null, string $ip = '192.0.2.1'): Request {
    $request = Request::create('/api/session', 'POST', [], [], [], ['REMOTE_ADDR' => $ip]);
    if ($token !== null) {
        $request->headers->set('Authorization', 'Bearer '.$token);
    }

    return $request;
};

try {
    // Every application table touched by AuthService is shadowed on this one connection.
    // Temporary tables disappear on close; no migration or persistent user data is touched.
    $db->executeStatement("SET time_zone = '+00:00'");
    $db->executeStatement('CREATE TEMPORARY TABLE users (
        id CHAR(36) PRIMARY KEY, username VARCHAR(64) NOT NULL UNIQUE, display_name VARCHAR(100) NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE, password_hash VARCHAR(255) NULL, role VARCHAR(16) NOT NULL DEFAULT \'user\',
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
    foreach (['auth_tokens', 'auth_invitations'] as $table) {
        $db->executeStatement('CREATE TEMPORARY TABLE '.$table.' (
            token_hash CHAR(64) PRIMARY KEY, user_id CHAR(36) NOT NULL, expires_at DATETIME NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
    }
    $db->executeStatement('CREATE TEMPORARY TABLE auth_login_attempts (
        attempt_key CHAR(64) PRIMARY KEY, attempts INT NOT NULL DEFAULT 0, window_started_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');

    $auth = new AuthService($db);
    $controller = new AuthController($auth);
    $legacy = $request();
    $legacy->headers->set('X-Fishing-User', 'operator');
    $check($auth->user($legacy, false) === null, 'Legacy identity must remain anonymous on public routes.');
    $expect(fn () => $auth->user($legacy), 401);
    $legacy->query->set('token', bin2hex(random_bytes(32)));
    $legacy->cookies->set('token', bin2hex(random_bytes(32)));
    $check($auth->user($legacy, false) === null, 'Query parameters and cookies cannot authenticate.');
    foreach (['Basic invalid', 'Bearer short', '', 'Bearer '.bin2hex(random_bytes(32)).', Bearer invalid'] as $header) {
        $invalid = $request();
        $invalid->headers->set('Authorization', $header);
        $expect(fn () => $auth->user($invalid, false), 401);
    }
    $duplicate = $request();
    $duplicate->headers->set('Authorization', ['Bearer '.bin2hex(random_bytes(32)), 'Bearer '.bin2hex(random_bytes(32))]);
    $expect(fn () => $auth->user($duplicate), 401);

    $invitation = $auth->invite(' Operator ', true, 'Operator');
    $rootId = $invitation['user']['id'];
    $check($invitation['user']['username'] === 'operator' && $invitation['user']['role'] === 'admin', 'CLI invitation normalizes username and can bootstrap an administrator.');
    $check((bool) preg_match('/\A[a-f0-9]{64}\z/', $invitation['invitationToken']), 'Invitation must encode 32 random bytes.');
    $check(abs(strtotime($invitation['expiresAt']) - time() - 48 * 3600) < 5, 'Invitation expires in 48 hours.');
    $check($db->fetchOne('SELECT token_hash FROM auth_invitations WHERE user_id = ?', [$rootId]) === hash('sha256', $invitation['invitationToken']), 'Only the invitation hash is stored.');
    $password = '  '.bin2hex(random_bytes(50)).'  ';
    $unactivated = $expect(fn () => $auth->login($request(), ['username' => 'operator', 'password' => $password]), 401);
    $missing = $expect(fn () => $auth->login($request(), ['username' => 'not-an-account', 'password' => $password]), 401);
    $check($unactivated->getMessage() === $missing->getMessage(), 'Unactivated and unknown accounts have the same login error.');
    $expect(fn () => $auth->activate($request(), ['username' => 'operator', 'password' => $password]), 401);
    foreach ([str_repeat('x', 11), str_repeat('x', 129), ['not-a-string']] as $invalidPassword) {
        $expect(fn () => $auth->activate($request(), ['username' => 'operator', 'invitationToken' => $invitation['invitationToken'], 'password' => $invalidPassword]), 400);
    }
    $rootSession = $auth->activate($request(), ['username' => 'operator', 'invitationToken' => $invitation['invitationToken'], 'password' => $password]);
    $root = $request($rootSession['token']);
    $check($auth->admin($root)['id'] === $rootId, 'Activated administrator authenticates.');
    $check(abs(strtotime($rootSession['expiresAt']) - time() - 30 * 86400) < 5, 'Session expires in 30 days.');
    $check($db->fetchOne('SELECT token_hash FROM auth_tokens WHERE user_id = ?', [$rootId]) === hash('sha256', $rootSession['token']), 'Only the session hash is stored.');
    $storedPassword = $db->fetchOne('SELECT password_hash FROM users WHERE id = ?', [$rootId]);
    $check(password_get_info($storedPassword)['algoName'] === 'argon2id' && password_verify($password, $storedPassword), 'Passwords use Argon2id.');
    $check(!password_verify(trim($password), $storedPassword), 'Password whitespace is significant.');
    $check(!password_verify(substr_replace($password, 'z', 90, 1), $storedPassword), 'Password suffix beyond bcrypt limits is significant.');
    $check(array_keys($rootSession['user']) === ['id', 'username', 'displayName', 'active', 'role', 'createdAt', 'updatedAt'], 'ApiUser only exposes approved fields.');
    $check(is_bool($rootSession['user']['active']), 'ApiUser active is a boolean.');
    $expect(fn () => $auth->activate($request(), ['username' => 'operator', 'invitationToken' => $invitation['invitationToken'], 'password' => $password]), 401);
    $check((int) $db->fetchOne('SELECT COUNT(*) FROM auth_invitations WHERE user_id = ?', [$rootId]) === 0, 'Activation consumes invitations.');
    $check(json_decode($controller->session($root)->getContent(), true)['user'] === $rootSession['user'], 'GET session returns user, never the bearer token.');
    $root->headers->set('X-Fishing-User', 'someone-else');
    $check($auth->user($root)['id'] === $rootId, 'Legacy header cannot override a valid bearer.');
    $expect(fn () => $auth->updateUser($root, $rootId, ['active' => false]), 409);
    $expect(fn () => $auth->updateUser($root, $rootId, ['role' => 'user']), 409);

    $login = $auth->login($request(), ['username' => ' OPERATOR ', 'password' => $password]);
    $check($login['token'] !== $rootSession['token'], 'Login issues a fresh opaque token.');
    $check($controller->logout($request($login['token']))->getStatusCode() === 204, 'Logout returns 204.');
    $auth->logout($request($login['token']));
    $expect(fn () => $auth->user($request($login['token'])), 401);
    $expect(fn () => $auth->logout($legacy), 401);
    $expired = $auth->login($request(), ['username' => 'operator', 'password' => $password]);
    $db->executeStatement('UPDATE auth_tokens SET expires_at = UTC_TIMESTAMP() WHERE token_hash = ?', [hash('sha256', $expired['token'])]);
    $expect(fn () => $auth->user($request($expired['token'])), 401);

    $expect(fn () => $auth->createUser($legacy, ['username' => 'attacker']), 401);
    $expect(fn () => $auth->createUser($root, ['username' => 'invalid name']), 400);
    $expect(fn () => $auth->createUser($root, ['username' => 'angler', 'role' => 'admin']), 400);
    $created = $auth->createUser($root, ['username' => 'Angler', 'displayName' => 'Angler']);
    $userId = $created['user']['id'];
    $check($created['user']['active'] && $created['user']['role'] === 'user', 'API creates active ordinary users only.');
    $expect(fn () => $auth->createUser($root, ['username' => 'ANGLER']), 409);
    $expect(fn () => $auth->createUser($root, ['username' => "\u{00e1}ngler"]), 409);
    $check($auth->updateUser($root, $userId, ['displayName' => 'Angler'])['id'] === $userId, 'Idempotent user update is not a false 404.');
    $expect(fn () => $auth->updateUser($root, $userId, ['active' => 'false']), 400);
    $expect(fn () => $auth->updateUser($root, $userId, ['password' => $password]), 400);
    $userPassword = bin2hex(random_bytes(6));
    $userSession = $auth->activate($request(), ['username' => 'angler', 'invitationToken' => $created['invitationToken'], 'password' => $userPassword]);
    $user = $request($userSession['token']);
    $expect(fn () => $auth->users($user), 403);
    $expect(fn () => $auth->createUser($user, ['username' => 'attacker']), 403);
    $expect(fn () => $auth->updateUser($user, $userId, ['role' => 'admin']), 403);
    $expect(fn () => $auth->invitation($user, $rootId), 403);

    $oldInvitation = $auth->invitation($root, $userId);
    $newInvitation = $auth->invitation($root, $userId);
    $check($oldInvitation['invitationToken'] !== $newInvitation['invitationToken'], 'Reissuing an invitation rotates its secret.');
    $check($auth->user($user)['id'] === $userId, 'Issuing a reset invitation alone does not replace credentials.');
    $resetPassword = bin2hex(random_bytes(64));
    $expect(fn () => $auth->activate($request(), ['username' => 'angler', 'invitationToken' => $oldInvitation['invitationToken'], 'password' => $resetPassword]), 401);
    $reset = $auth->activate($request(), ['username' => 'angler', 'invitationToken' => $newInvitation['invitationToken'], 'password' => $resetPassword]);
    $expect(fn () => $auth->user($user), 401);
    $expect(fn () => $auth->login($request(), ['username' => 'angler', 'password' => $userPassword]), 401);
    $check($auth->login($request(), ['username' => 'angler', 'password' => $resetPassword])['user']['id'] === $userId, 'A 128-character reset password works.');
    $pending = $auth->invitation($root, $userId);
    $disabled = $auth->updateUser($root, $userId, ['active' => false]);
    $check(!$disabled['active'], 'Administrator can disable a regular user.');
    $expect(fn () => $auth->user($request($reset['token']), false), 401);
    $inactive = $expect(fn () => $auth->login($request(), ['username' => 'angler', 'password' => $resetPassword]), 401);
    $check($inactive->getMessage() === $missing->getMessage(), 'Inactive accounts have the same generic login error.');
    $expect(fn () => $auth->activate($request(), ['username' => 'angler', 'invitationToken' => $pending['invitationToken'], 'password' => $resetPassword]), 401);
    $expect(fn () => $auth->invitation($root, $userId), 409);
    $expect(fn () => $auth->invite('angler', true), 409);
    $check($db->fetchOne('SELECT role FROM users WHERE id = ?', [$userId]) === 'user', 'Failed invitation rolls back operator role changes.');
    $check(count($auth->users($root, false)) === 1 && count($auth->users($root)) === 2, 'Inactive listing filter works.');
    $check((int) $db->fetchOne('SELECT COUNT(*) FROM auth_tokens WHERE user_id = ?', [$userId]) === 0, 'Disablement deletes all user sessions.');
    $check((int) $db->fetchOne('SELECT COUNT(*) FROM auth_invitations WHERE user_id = ?', [$userId]) === 0, 'Disablement deletes pending invitations.');
    $auth->updateUser($root, $userId, ['active' => true]);
    $expect(fn () => $auth->user($request($reset['token'])), 401);

    $second = $auth->invite('second-admin', true);
    $secondSession = $auth->activate($request(), ['username' => 'second-admin', 'invitationToken' => $second['invitationToken'], 'password' => $password]);
    $expect(fn () => $auth->updateUser($root, $rootId, ['role' => 'user']), 403);
    $expect(fn () => $auth->updateUser($root, strtoupper($rootId), ['role' => 'user']), 403);
    $auth->updateUser($root, $second['user']['id'], ['role' => 'user']);
    $expect(fn () => $auth->admin($request($secondSession['token'])), 401);
    $expect(fn () => $auth->updateUser($root, $rootId, ['active' => false]), 409);
    $auth->invite('second-admin', true);
    $check($auth->invite('second-admin')['user']['role'] === 'admin', 'Omitting CLI --admin never demotes an existing admin.');
    $expiredInvitation = $auth->invite('expired-invite');
    $db->executeStatement('UPDATE auth_invitations SET expires_at = UTC_TIMESTAMP() WHERE token_hash = ?', [hash('sha256', $expiredInvitation['invitationToken'])]);
    $expect(fn () => $auth->activate($request(), ['username' => 'expired-invite', 'invitationToken' => $expiredInvitation['invitationToken'], 'password' => $password]), 401);

    $command = new CommandTester(new UserInviteCommand($auth));
    $check($command->execute(['username' => 'cli-account', '--admin' => true, '--display-name' => 'CLI Account']) === 0, 'Invitation command succeeds against isolated tables.');
    $check(preg_match_all('/Invitation token: ([a-f0-9]{64})/', $command->getDisplay(), $matches) === 1, 'CLI prints the activation token exactly once.');
    $check((bool) $db->fetchOne('SELECT user_id FROM auth_invitations WHERE token_hash = ?', [hash('sha256', $matches[1][0])]), 'CLI stores only the printed token hash.');

    $db->executeStatement('DELETE FROM auth_login_attempts');
    for ($i = 1; $i <= 10; ++$i) {
        $expect(fn () => $auth->login($request(null, '192.0.2.'.$i), ['username' => $i % 2 ? ' ANGLER ' : "\u{00e1}ngler", 'password' => 'incorrect-password']), 401);
    }
    $limited = $expect(fn () => $auth->login($request(null, '192.0.2.99'), ['username' => 'angler', 'password' => $resetPassword]), 429);
    $check((int) $limited->getHeaders()['Retry-After'] >= 1 && (int) $limited->getHeaders()['Retry-After'] <= 900, 'Username limit has bounded Retry-After, independent of IP and collation aliases.');
    $db->executeStatement('UPDATE auth_login_attempts SET window_started_at = UTC_TIMESTAMP() - INTERVAL 16 MINUTE');
    $check($auth->login($request(null, '192.0.2.99'), ['username' => 'angler', 'password' => $resetPassword])['user']['id'] === $userId, 'An expired rate window resets.');
    $check((int) $db->fetchOne('SELECT attempts FROM auth_login_attempts WHERE attempt_key = ?', [hash('sha256', "login\0username\0angler")]) === 1, 'Reset window starts at one attempt.');
    $db->insert('auth_login_attempts', ['attempt_key' => hash('sha256', "login\0ip\0".'198.51.100.1'), 'attempts' => 60, 'window_started_at' => gmdate('Y-m-d H:i:s')]);
    $expect(fn () => $auth->login($request(null, '198.51.100.1'), ['username' => 'rotating-name', 'password' => $password]), 429);

    $db->executeStatement('DELETE FROM auth_login_attempts');
    for ($i = 1; $i <= 10; ++$i) {
        $expect(fn () => $auth->activate($request(null, '192.0.2.'.$i), ['username' => 'same-target', 'password' => 'short']), 400);
    }
    $expect(fn () => $auth->activate($request(null, '192.0.2.99'), ['username' => 'SAME-TARGET', 'password' => 'short']), 429);
    $db->executeStatement('DELETE FROM auth_login_attempts');
    for ($i = 1; $i <= 60; ++$i) {
        $expect(fn () => $auth->activate($request(null, '198.51.100.2'), ['username' => 'target-'.$i, 'password' => 'short']), 400);
    }
    for ($i = 0; $i < 3; ++$i) {
        $expect(fn () => $auth->activate($request(null, '198.51.100.2'), ['username' => 'another-target', 'password' => 'short']), 429);
    }
    $check((int) $db->fetchOne('SELECT COUNT(*) FROM auth_login_attempts') === 61, 'IP limit stops creation of arbitrary username buckets.');
    $check((int) $db->fetchOne('SELECT MAX(attempts) FROM auth_login_attempts') === 61, 'Rejected attempts commit but counters saturate.');

    foreach (['[]', 'null', '{', str_repeat(' ', 16385)] as $body) {
        $expect(fn () => $controller->login(Request::create('/api/session', 'POST', [], [], [], [], $body)), strlen($body) > 16384 ? 413 : 400);
    }

    $subscriber = new ApiSubscriber();
    $kernel = new Kernel('test', false);
    foreach (['https://localhost', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://[::1]:3000', 'capacitor://localhost', 'https://fishing.ddev.site'] as $origin) {
        $cors = Request::create('https://fishing.ddev.site/api/session', 'OPTIONS');
        $cors->headers->set('Origin', $origin);
        $event = new RequestEvent($kernel, $cors, HttpKernelInterface::MAIN_REQUEST);
        $subscriber->onRequest($event);
        $response = $event->getResponse();
        $subscriber->onResponse(new ResponseEvent($kernel, $cors, HttpKernelInterface::MAIN_REQUEST, $response));
        $check($response->getStatusCode() === 204 && $response->headers->get('Access-Control-Allow-Origin') === $origin, 'Known client CORS preflight succeeds.');
        $check(str_contains($response->headers->get('Access-Control-Allow-Headers'), 'Authorization'), 'CORS permits Authorization.');
        $check(!$response->headers->has('Access-Control-Allow-Credentials'), 'CORS never enables cookie credentials.');
    }
    foreach (['https://localhost.attacker.test', 'null', 'https://attacker.test', 'https://fishing.ddev.site.attacker.test'] as $origin) {
        $cors = Request::create('https://fishing.ddev.site/api');
        $cors->headers->set('Origin', $origin);
        $response = new JsonResponse(['public' => true], 200, ['Cache-Control' => 'public, max-age=3600', 'ETag' => 'old']);
        $subscriber->onResponse(new ResponseEvent($kernel, $cors, HttpKernelInterface::MAIN_REQUEST, $response));
        $check(!$response->headers->has('Access-Control-Allow-Origin'), 'Untrusted origins receive no CORS grant.');
        $check($response->headers->hasCacheControlDirective('no-store') && !$response->headers->has('ETag'), 'Even public API JSON is no-store without validators.');
        $check(in_array('Authorization', $response->getVary(), true) && in_array('Origin', $response->getVary(), true), 'API responses vary on authorization and origin.');
    }
    $event = new ExceptionEvent($kernel, $request(), HttpKernelInterface::MAIN_REQUEST, new TooManyRequestsHttpException(900, 'Try later.'));
    $subscriber->onException($event);
    $check($event->getResponse()->getStatusCode() === 429 && $event->getResponse()->headers->get('Retry-After') === '900', 'Subscriber preserves rate-limit status and Retry-After.');
    $event = new ExceptionEvent($kernel, $request(), HttpKernelInterface::MAIN_REQUEST, new ApiException('Authentication required.', 401));
    $subscriber->onException($event);
    $check($event->getResponse()->headers->get('WWW-Authenticate') === 'Bearer', '401 responses challenge for bearer authentication.');
    $event = new ExceptionEvent($kernel, $request(), HttpKernelInterface::MAIN_REQUEST, new RuntimeException('Private database detail'));
    $subscriber->onException($event);
    $check($event->getResponse()->getStatusCode() === 500 && !str_contains($event->getResponse()->getContent(), 'Private database detail'), 'Unexpected exceptions do not leak internals.');
    $outside = new Response();
    $subscriber->onResponse(new ResponseEvent($kernel, Request::create('/apiculture'), HttpKernelInterface::MAIN_REQUEST, $outside));
    $check(!$outside->headers->has('Access-Control-Allow-Origin') && !$outside->headers->hasCacheControlDirective('no-store'), 'Subscriber does not change non-API routes.');

    fwrite(STDOUT, 'Authentication checks passed: '.$checks.". Only connection-local temporary tables were used.\n");
} finally {
    $db->close();
}
