<?php

declare(strict_types=1);

namespace SilvaMentis\Auth;

use SilvaMentis\Config;
use SilvaMentis\Database;
use SilvaMentis\Http\HttpException;
use SilvaMentis\Http\Input;
use SilvaMentis\Http\Request;
use SilvaMentis\Http\Response;
use SilvaMentis\Security\ClientAddress;
use SilvaMentis\Security\RateLimiter;

/**
 * Account routes: status, first registration, login, logout, password and recovery-key changes.
 *
 * The browser never sends the password. It sends authKey, a value derived from the password that
 * is useless for decrypting notes (see public/js/crypto/vault.js). The server stores a bcrypt hash of
 * it, exactly as it would store a password.
 */
final class AuthController
{
    public function __construct(
        private readonly Config $config,
        private readonly Database $database,
        private readonly UserRepository $users,
        private readonly SessionManager $sessions,
        private readonly SetupToken $setupToken,
        private readonly RateLimiter $rateLimiter,
        private readonly ClientAddress $clientAddress,
    ) {
    }

    /** GET status — what the start screen should show. Never fails because of a missing login. */
    public function status(Request $request): Response
    {
        $needsSetup = !$this->users->exists();
        $authenticated = !$needsSetup && $this->sessions->isValid($this->sessionToken($request));
        $setup = null;
        if ($needsSetup) {
            $setup = ['tokenFile' => null, 'dataPath' => $this->exposedDataPath($request), 'problem' => null];
            try {
                $setup['tokenFile'] = $this->setupToken->ensure();
            } catch (\RuntimeException $error) {
                $setup['problem'] = $error->getMessage();
            }
        }
        return Response::json([
            'mode' => $this->config->mode,
            'needsSetup' => $needsSetup,
            'authenticated' => $authenticated,
            'username' => $authenticated ? $this->users->find()['username'] : null,
            'setup' => $setup,
        ]);
    }

    /** POST setup — creates the only account. Needs the token from the data folder. */
    public function setup(Request $request): Response
    {
        if ($this->users->exists()) {
            throw new HttpException(403, 'setup_closed', 'This installation already has an account.');
        }
        $data = $request->json();
        $token = Input::setupToken($data);
        $username = Input::username($data);
        $authKey = Input::derivedKey($data, 'authKey');
        $kdf = Input::kdf($data, 'kdf');
        $wrappedKey = Input::wrappedKey($data, 'wrappedKey');
        $recoveryAuthKey = Input::derivedKey($data, 'recoveryAuthKey');
        $recoveryWrappedKey = Input::wrappedKey($data, 'recoveryWrappedKey');

        $client = $this->clientKey($request);
        $this->rateLimiter->check($client);
        if ($this->setupToken->read() === null) {
            $this->setupToken->ensure();
        }
        if (!$this->setupToken->verify($token)) {
            $this->rateLimiter->recordFailure($client);
            throw HttpException::unauthorized('The setup token is not correct. Copy it again from the file in the data folder.');
        }

        try {
            $this->database->transaction(fn () => $this->users->create(
                $username,
                password_hash($authKey, PASSWORD_DEFAULT),
                json_encode($kdf, JSON_THROW_ON_ERROR),
                $wrappedKey,
                password_hash($recoveryAuthKey, PASSWORD_DEFAULT),
                $recoveryWrappedKey,
            ));
        } catch (\PDOException) {
            throw new HttpException(403, 'setup_closed', 'This installation already has an account.');
        }
        $this->setupToken->delete();
        $this->rateLimiter->recordSuccess($client);

        return $this->withNewSession($request, Response::json(['username' => $username], 201));
    }

    /** GET login-params — the salt and iteration count the browser needs to derive authKey. */
    public function loginParams(Request $request): Response
    {
        $user = $this->users->find() ?? throw HttpException::notFound('No account exists yet.');
        return Response::json(['kdf' => json_decode($user['kdf'], true)]);
    }

    /** POST login */
    public function login(Request $request): Response
    {
        $data = $request->json();
        $username = Input::username($data);
        $authKey = Input::derivedKey($data, 'authKey');
        $user = $this->users->find() ?? throw new HttpException(409, 'setup_required', 'No account exists yet.');

        $this->checkCredential($request, $user, $username, 'auth_hash', $authKey, 'Wrong username or password.');
        return $this->withNewSession($request, Response::json([
            'username' => $user['username'],
            'kdf' => json_decode($user['kdf'], true),
            'wrappedKey' => $user['wrapped_key'],
        ]));
    }

    /** POST logout */
    public function logout(Request $request): Response
    {
        $this->sessions->end((string) $request->sessionToken());
        return Response::json(['ok' => true])
            ->withCookie($this->sessions->clearCookie($this->clientAddress->isHttps($request)));
    }

    /** POST password — new password, same data key. Ends every other session. */
    public function changePassword(Request $request): Response
    {
        $data = $request->json();
        $authKey = Input::derivedKey($data, 'authKey');
        $newAuthKey = Input::derivedKey($data, 'newAuthKey');
        $newKdf = Input::kdf($data, 'newKdf');
        $newWrappedKey = Input::wrappedKey($data, 'newWrappedKey');
        $user = $this->users->find();

        $this->checkCredential($request, $user, $user['username'], 'auth_hash', $authKey, 'The current password is not correct.');
        $this->database->transaction(function () use ($newAuthKey, $newKdf, $newWrappedKey, $request): void {
            $this->users->updatePassword(
                password_hash($newAuthKey, PASSWORD_DEFAULT),
                json_encode($newKdf, JSON_THROW_ON_ERROR),
                $newWrappedKey,
            );
            $this->sessions->endOthers((string) $request->sessionToken());
        });
        return Response::json(['ok' => true]);
    }

    /** POST recovery-key — replaces the recovery key (the old one stops working). */
    public function replaceRecoveryKey(Request $request): Response
    {
        $data = $request->json();
        $authKey = Input::derivedKey($data, 'authKey');
        $recoveryAuthKey = Input::derivedKey($data, 'recoveryAuthKey');
        $recoveryWrappedKey = Input::wrappedKey($data, 'recoveryWrappedKey');
        $user = $this->users->find();

        $this->checkCredential($request, $user, $user['username'], 'auth_hash', $authKey, 'The password is not correct.');
        $this->users->updateRecovery(password_hash($recoveryAuthKey, PASSWORD_DEFAULT), $recoveryWrappedKey);
        return Response::json(['ok' => true]);
    }

    /** POST recover — step 1 of a password reset: prove the recovery key, get the wrapped data key. */
    public function recover(Request $request): Response
    {
        $data = $request->json();
        $username = Input::username($data);
        $recoveryAuthKey = Input::derivedKey($data, 'recoveryAuthKey');
        $user = $this->users->find() ?? throw new HttpException(409, 'setup_required', 'No account exists yet.');

        $this->checkCredential($request, $user, $username, 'recovery_auth_hash', $recoveryAuthKey, 'Wrong username or recovery key.');
        return Response::json([
            'kdf' => json_decode($user['kdf'], true),
            'recoveryWrappedKey' => $user['recovery_wrapped_key'],
        ]);
    }

    /**
     * POST recover-finish — step 2: a new password and a new recovery key replace the old ones,
     * every existing session ends and this device is logged in.
     */
    public function recoverFinish(Request $request): Response
    {
        $data = $request->json();
        $username = Input::username($data);
        $recoveryAuthKey = Input::derivedKey($data, 'recoveryAuthKey');
        $newAuthKey = Input::derivedKey($data, 'newAuthKey');
        $newKdf = Input::kdf($data, 'newKdf');
        $newWrappedKey = Input::wrappedKey($data, 'newWrappedKey');
        $newRecoveryAuthKey = Input::derivedKey($data, 'newRecoveryAuthKey');
        $newRecoveryWrappedKey = Input::wrappedKey($data, 'newRecoveryWrappedKey');
        $user = $this->users->find() ?? throw new HttpException(409, 'setup_required', 'No account exists yet.');

        $this->checkCredential($request, $user, $username, 'recovery_auth_hash', $recoveryAuthKey, 'Wrong username or recovery key.');
        $this->database->transaction(function () use ($newAuthKey, $newKdf, $newWrappedKey, $newRecoveryAuthKey, $newRecoveryWrappedKey): void {
            $this->users->updatePassword(password_hash($newAuthKey, PASSWORD_DEFAULT), json_encode($newKdf, JSON_THROW_ON_ERROR), $newWrappedKey);
            $this->users->updateRecovery(password_hash($newRecoveryAuthKey, PASSWORD_DEFAULT), $newRecoveryWrappedKey);
            $this->sessions->endAll();
        });
        return $this->withNewSession($request, Response::json(['username' => $user['username']]));
    }

    /** POST sessions-revoke — "log out other devices". Asks for the password again. */
    public function revokeOtherSessions(Request $request): Response
    {
        $authKey = Input::derivedKey($request->json(), 'authKey');
        $user = $this->users->find();
        $this->checkCredential($request, $user, $user['username'], 'auth_hash', $authKey, 'The password is not correct.');
        $this->sessions->endOthers((string) $request->sessionToken());
        return Response::json(['ok' => true]);
    }

    /** The session token sent by the browser, if any. */
    public function sessionToken(Request $request): ?string
    {
        return $request->cookie(SessionManager::cookieName($this->clientAddress->isHttps($request)));
    }

    /**
     * Verifies a username + secret pair through the rate limiter. Both parts are always checked,
     * so a wrong username takes as long as a wrong password.
     *
     * @param array<string, mixed> $user
     */
    private function checkCredential(Request $request, array $user, string $username, string $hashColumn,
                                     string $secret, string $failureMessage): void
    {
        $client = $this->clientKey($request);
        $this->rateLimiter->check($client);
        $secretOk = password_verify($secret, $user[$hashColumn]);
        $usernameOk = hash_equals($user['username'], $username);
        if (!$secretOk || !$usernameOk) {
            $this->rateLimiter->recordFailure($client);
            throw HttpException::unauthorized($failureMessage);
        }
        $this->rateLimiter->recordSuccess($client);
    }

    private function withNewSession(Request $request, Response $response): Response
    {
        $token = $this->sessions->start();
        return $response->withCookie($this->sessions->cookie($token, $this->clientAddress->isHttps($request)));
    }

    private function clientKey(Request $request): string
    {
        return ClientAddress::networkKey($this->clientAddress->ip($request));
    }

    /**
     * If the data folder sits inside the web server's document root, its URL path; else null.
     * The setup screen then checks whether that URL is really reachable from the web.
     */
    private function exposedDataPath(Request $request): ?string
    {
        $documentRoot = $request->documentRoot === '' ? false : realpath($request->documentRoot);
        $dataDir = realpath($this->config->dataDir);
        if ($documentRoot === false || $dataDir === false) {
            return null;
        }
        $documentRoot = rtrim($documentRoot, '/');
        if (!str_starts_with($dataDir . '/', $documentRoot . '/')) {
            return null;
        }
        return '/' . ltrim(substr($dataDir, strlen($documentRoot)), '/');
    }
}
