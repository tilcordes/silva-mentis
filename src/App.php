<?php

declare(strict_types=1);

namespace SilvaMentis;

use SilvaMentis\Auth\AuthController;
use SilvaMentis\Auth\SessionManager;
use SilvaMentis\Auth\SetupToken;
use SilvaMentis\Auth\UserRepository;
use SilvaMentis\Documents\DocumentController;
use SilvaMentis\Documents\DocumentRepository;
use SilvaMentis\Http\HttpException;
use SilvaMentis\Http\Request;
use SilvaMentis\Http\Response;
use SilvaMentis\Http\Router;
use SilvaMentis\Security\ClientAddress;
use SilvaMentis\Security\RateLimiter;
use SilvaMentis\Security\SecurityHeaders;
use SilvaMentis\Testing\TestModeController;

/**
 * Puts the server together. The mode (normal or test) is decided here and only here: it picks
 * the database file, whether routes need a login and which routes exist at all.
 */
final class App
{
    /** JSON overhead allowed on top of the largest document. */
    private const BODY_OVERHEAD = 65_536;

    private function __construct(
        private readonly Config $config,
        private readonly Router $router,
        private readonly SessionManager $sessions,
        private readonly AuthController $auth,
        private readonly ClientAddress $clientAddress,
    ) {
    }

    /**
     * @param Database|null $database defaults to the mode's SQLite file
     * @param (callable(string): void)|null $announce where to print a new setup token (console under php -S)
     */
    public static function create(Config $config, ?Database $database = null, ?Clock $clock = null, ?callable $announce = null): self
    {
        $clock ??= Clock::system();
        $database ??= Database::open($config->databasePath());
        $clientAddress = new ClientAddress($config->trustedProxies);
        $users = new UserRepository($database, $clock);
        $sessions = new SessionManager($database, $clock, $config->sessionIdleDays, $config->sessionMaxDays);
        $documents = new DocumentRepository($database, $clock);
        $auth = new AuthController(
            $config,
            $database,
            $users,
            $sessions,
            new SetupToken($config->dataDir, $announce),
            new RateLimiter($database, $clock),
            $clientAddress,
        );
        $documentController = new DocumentController($documents, $config->maxDocumentBytes);

        $router = new Router();
        $loginRequired = !$config->isTestMode();
        if ($config->isTestMode()) {
            $testMode = new TestModeController($documents);
            $router->add('GET', 'status', $testMode->status(...));
            $router->add('POST', 'test-reset', $testMode->reset(...));
        } else {
            $router->add('GET', 'status', $auth->status(...));
            $router->add('POST', 'setup', $auth->setup(...));
            $router->add('GET', 'login-params', $auth->loginParams(...));
            $router->add('POST', 'login', $auth->login(...));
            $router->add('POST', 'logout', $auth->logout(...), needsSession: true);
            $router->add('POST', 'password', $auth->changePassword(...), needsSession: true);
            $router->add('POST', 'recovery-key', $auth->replaceRecoveryKey(...), needsSession: true);
            $router->add('POST', 'recover', $auth->recover(...));
            $router->add('POST', 'recover-finish', $auth->recoverFinish(...));
            $router->add('POST', 'sessions-revoke', $auth->revokeOtherSessions(...), needsSession: true);
        }
        $router->add('GET', 'documents', $documentController->list(...), needsSession: $loginRequired);
        $router->add('POST', 'document-save', $documentController->save(...), needsSession: $loginRequired);
        $router->add('POST', 'document-delete', $documentController->delete(...), needsSession: $loginRequired);

        return new self($config, $router, $sessions, $auth, $clientAddress);
    }

    /** The largest request body worth reading. */
    public static function maxBodyBytes(Config $config): int
    {
        return $config->maxDocumentBytes + self::BODY_OVERHEAD;
    }

    /** Answers one API request. Never throws: every failure becomes a JSON error. */
    public function handle(Request $request): Response
    {
        try {
            self::guardTestMode($this->config, $request);
            if ($request->header('x-silva-mentis') !== '1') {
                // Browsers only add custom headers to cross-site requests after a CORS preflight,
                // which this server never approves. So this header proves the request is same-origin.
                throw HttpException::forbidden('Missing X-Silva-Mentis header.');
            }
            if (strlen($request->body) > self::maxBodyBytes($this->config)) {
                throw new HttpException(413, 'payload_too_large', 'The request is larger than the server accepts.');
            }
            $route = $this->router->match($request);
            if ($route['needsSession']) {
                $token = $this->auth->sessionToken($request);
                if (!$this->sessions->isValid($token)) {
                    throw HttpException::unauthorized('Your session has ended. Please log in again.');
                }
                $request = $request->withSessionToken($token);
            }
            $response = ($route['handler'])($request);
        } catch (HttpException $error) {
            $response = $error->toResponse();
        } catch (\Throwable $error) {
            error_log('silva-mentis: ' . $error);
            $response = Response::json(['error' => 'server_error', 'message' => 'The server ran into an unexpected problem.'], 500);
        }
        return $response->withHeaders(SecurityHeaders::all($this->clientAddress->isHttps($request)));
    }

    /** Serves the single-page app shell (public/index.php). Needs no database. */
    public static function shell(Config $config, Request $request): Response
    {
        try {
            self::guardTestMode($config, $request);
            $response = Response::html((string) file_get_contents(__DIR__ . '/View/app.html'));
        } catch (HttpException $error) {
            $response = new Response($error->status, $error->getMessage() . "\n", ['Content-Type' => 'text/plain; charset=utf-8']);
        }
        $https = (new ClientAddress($config->trustedProxies))->isHttps($request);
        return $response->withHeaders(SecurityHeaders::all($https));
    }

    /**
     * The test version has no login, so it answers only this computer: loopback clients, and a
     * Host header naming this computer (that stops DNS-rebinding tricks from websites).
     */
    private static function guardTestMode(Config $config, Request $request): void
    {
        if (!$config->isTestMode()) {
            return;
        }
        if (!$config->testModeAllowRemote && !ClientAddress::isLoopback($request->remoteAddr)) {
            throw HttpException::forbidden('The test version only answers requests from this computer.');
        }
        $allowedHosts = ['localhost', '127.0.0.1', '[::1]', ...$config->allowedHosts];
        if (!in_array($request->hostName(), $allowedHosts, true)) {
            throw HttpException::forbidden('The test version only answers requests for localhost.');
        }
    }
}
