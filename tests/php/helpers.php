<?php

declare(strict_types=1);

// Assertions and fixtures shared by the PHP tests.

namespace Tests;

use SilvaMentis\App;
use SilvaMentis\Clock;
use SilvaMentis\Config;
use SilvaMentis\Database;
use SilvaMentis\Http\Request;
use SilvaMentis\Http\Response;

final class AssertionFailed extends \RuntimeException
{
}

/** @var array<string, \Closure> */
$GLOBALS['silva_mentis_tests'] = [];
/** @var list<string> */
$GLOBALS['silva_mentis_tmp'] = [];

function test(string $name, \Closure $body): void
{
    $GLOBALS['silva_mentis_tests'][$name] = $body;
}

/** @return array<string, \Closure> */
function registeredTests(): array
{
    return $GLOBALS['silva_mentis_tests'];
}

function assertSame(mixed $expected, mixed $actual, string $message = ''): void
{
    if ($expected !== $actual) {
        throw new AssertionFailed(trim("$message\nexpected " . var_export($expected, true) . "\n     got " . var_export($actual, true)));
    }
}

function assertTrue(bool $condition, string $message = 'expected true'): void
{
    if (!$condition) {
        throw new AssertionFailed($message);
    }
}

function assertFalse(bool $condition, string $message = 'expected false'): void
{
    assertTrue(!$condition, $message);
}

/** Runs $body and returns the exception it throws; fails if it throws nothing or the wrong class. */
function assertThrows(string $class, \Closure $body): \Throwable
{
    try {
        $body();
    } catch (\Throwable $error) {
        if (!$error instanceof $class) {
            throw new AssertionFailed("expected $class, got " . $error::class . ': ' . $error->getMessage());
        }
        return $error;
    }
    throw new AssertionFailed("expected $class to be thrown");
}

/** Asserts a JSON error response with the given status and error code. */
function assertError(int $status, string $code, Response $response): void
{
    assertSame($status, $response->status, 'status of ' . $response->body);
    assertSame($code, $response->data()['error'] ?? null, 'error code');
}

function failureLocation(\Throwable $error): string
{
    foreach ($error->getTrace() as $frame) {
        if (isset($frame['file']) && str_ends_with($frame['file'], 'Test.php')) {
            return basename($frame['file']) . ':' . $frame['line'];
        }
    }
    return basename($error->getFile()) . ':' . $error->getLine();
}

/** A fresh, empty folder below tests/.tmp, removed after the test. */
function temporaryFolder(): string
{
    $base = __DIR__ . '/../.tmp';
    if (!is_dir($base)) {
        mkdir($base, 0700, true);
    }
    $folder = $base . '/php-' . bin2hex(random_bytes(6));
    mkdir($folder, 0700);
    $GLOBALS['silva_mentis_tmp'][] = $folder;
    return $folder;
}

function cleanTemporaryFolders(): void
{
    foreach ($GLOBALS['silva_mentis_tmp'] as $folder) {
        foreach (array_diff(scandir($folder) ?: [], ['.', '..']) as $name) {
            if (is_file("$folder/$name")) {
                unlink("$folder/$name");
            }
        }
        @rmdir($folder);
    }
    $GLOBALS['silva_mentis_tmp'] = [];
}

/**
 * The whole server with an in-memory database and a fixed clock, called the way a browser would.
 */
final class TestServer
{
    public readonly App $app;
    public readonly Clock $clock;
    public readonly Database $database;
    public readonly string $dataDir;
    /** @var array<string, string> cookies the "browser" currently holds */
    public array $cookies = [];
    public string $remoteAddr = '127.0.0.1';
    public bool $https = false;

    /** @param array<string, mixed> $settings Config keys, e.g. ['mode' => 'test'] */
    public function __construct(array $settings = [])
    {
        $this->dataDir = temporaryFolder();
        $config = Config::fromArray($settings + ['data_dir' => $this->dataDir], $this->dataDir);
        $this->clock = Clock::fixed(1_760_000_000);
        $this->database = Database::open(':memory:');
        $this->app = App::create($config, $this->database, $this->clock);
    }

    /** @param array<string, mixed>|null $body */
    public function post(string $route, ?array $body = [], array $headers = []): Response
    {
        return $this->send('POST', $route, $body === null ? '' : json_encode($body), [], $headers);
    }

    /** @param array<string, string> $query */
    public function get(string $route, array $query = [], array $headers = []): Response
    {
        return $this->send('GET', $route, '', $query, $headers);
    }

    /** @param array<string, string> $query */
    public function send(string $method, string $route, string $body, array $query = [], array $headers = []): Response
    {
        $request = new Request(
            method: $method,
            query: ['route' => $route] + $query,
            headers: $headers + ['X-Silva-Mentis' => '1', 'Host' => 'localhost:8080'],
            body: $body,
            cookies: $this->cookies,
            remoteAddr: $this->remoteAddr,
            https: $this->https,
        );
        $response = $this->app->handle($request);
        foreach ($response->cookies as $cookie) {
            [$pair] = explode(';', $cookie, 2);
            [$name, $value] = explode('=', $pair, 2);
            if ($value === '' || str_contains($cookie, 'Max-Age=0')) {
                unset($this->cookies[$name]);
            } else {
                $this->cookies[$name] = $value;
            }
        }
        return $response;
    }

    /** The setup token the server wrote into the data folder (asks status first to create it). */
    public function setupToken(): string
    {
        $this->get('status');
        $files = glob($this->dataDir . '/setup-token-*.txt') ?: [];
        return $files === [] ? '' : trim((string) file_get_contents($files[0]));
    }

    /** Registers the account "ada" with password key $authKey and returns the setup response. */
    public function register(string $authKey = KEY_A, string $recoveryKey = KEY_R): Response
    {
        return $this->post('setup', [
            'setupToken' => $this->setupToken(),
            'username' => 'ada',
            'authKey' => $authKey,
            'kdf' => kdf(),
            'wrappedKey' => envelope('wrapped'),
            'recoveryAuthKey' => $recoveryKey,
            'recoveryWrappedKey' => envelope('recovery'),
        ]);
    }

    public function login(string $authKey = KEY_A, string $username = 'ada'): Response
    {
        return $this->post('login', ['username' => $username, 'authKey' => $authKey]);
    }
}

const KEY_A = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const KEY_B = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const KEY_C = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
const KEY_R = 'RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR';
const KEY_S = 'SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS';

/** @return array{alg: string, iterations: int, salt: string} */
function kdf(string $salt = 'c2FsdHNhbHRzYWx0c2FsdA'): array
{
    return ['alg' => 'PBKDF2-SHA256', 'iterations' => 600000, 'salt' => $salt];
}

/** A syntactically valid encrypted envelope; the server never looks inside. */
function envelope(string $marker): string
{
    return json_encode(['v' => 1, 'kid' => 'k1', 'iv' => 'aXZpdml2aXZpdml2', 'ct' => base64_encode($marker)]);
}
