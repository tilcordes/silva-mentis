<?php

declare(strict_types=1);

namespace SilvaMentis\Http;

/**
 * One incoming HTTP request as plain data. Built from PHP's globals in production and by hand
 * in tests, so the whole app can be exercised without a web server.
 */
final class Request
{
    /** @var array<string, string> header names in lower case */
    private array $headers = [];
    private ?string $sessionToken = null;
    private ?array $decodedJson = null;

    /**
     * @param array<string, string> $query
     * @param array<string, string> $headers
     * @param array<string, string> $cookies
     */
    public function __construct(
        public readonly string $method = 'GET',
        public readonly array $query = [],
        array $headers = [],
        public readonly string $body = '',
        public readonly array $cookies = [],
        public readonly string $remoteAddr = '127.0.0.1',
        public readonly bool $https = false,
        public readonly string $documentRoot = '',
    ) {
        foreach ($headers as $name => $value) {
            $this->headers[strtolower($name)] = $value;
        }
    }

    /** Builds the request PHP is currently handling. The body is read up to $maxBodyBytes + 1. */
    public static function fromGlobals(int $maxBodyBytes): self
    {
        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (str_starts_with($key, 'HTTP_')) {
                $headers[str_replace('_', '-', strtolower(substr($key, 5)))] = (string) $value;
            }
        }
        if (isset($_SERVER['CONTENT_TYPE'])) {
            $headers['content-type'] = (string) $_SERVER['CONTENT_TYPE'];
        }
        $body = (string) file_get_contents('php://input', false, null, 0, $maxBodyBytes + 1);
        $https = !empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off';

        return new self(
            method: strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')),
            query: array_map('strval', array_filter($_GET, 'is_scalar')),
            headers: $headers,
            body: $body,
            cookies: array_map('strval', array_filter($_COOKIE, 'is_scalar')),
            remoteAddr: (string) ($_SERVER['REMOTE_ADDR'] ?? ''),
            https: $https,
            documentRoot: (string) ($_SERVER['DOCUMENT_ROOT'] ?? ''),
        );
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    public function queryValue(string $name): ?string
    {
        return $this->query[$name] ?? null;
    }

    public function cookie(string $name): ?string
    {
        return $this->cookies[$name] ?? null;
    }

    /**
     * The JSON object in the body. Anything else (no body, invalid JSON, a list) is a bad request.
     *
     * @return array<string, mixed>
     */
    public function json(): array
    {
        if ($this->decodedJson === null) {
            try {
                $data = json_decode($this->body === '' ? '{}' : $this->body, true, 32, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                throw HttpException::badRequest('The request body is not valid JSON.');
            }
            if (!is_array($data) || ($data !== [] && array_is_list($data))) {
                throw HttpException::badRequest('The request body must be a JSON object.');
            }
            $this->decodedJson = $data;
        }
        return $this->decodedJson;
    }

    /** The host name without port, lower case ("localhost", "[::1]", "notes.example.com"). */
    public function hostName(): string
    {
        $host = strtolower(trim($this->header('host') ?? ''));
        if (str_starts_with($host, '[')) {
            $end = strpos($host, ']');
            return $end === false ? $host : substr($host, 0, $end + 1);
        }
        $colon = strrpos($host, ':');
        return $colon === false ? $host : substr($host, 0, $colon);
    }

    /** A copy that remembers the validated session token (set by App before calling a handler). */
    public function withSessionToken(?string $token): self
    {
        $copy = clone $this;
        $copy->sessionToken = $token;
        return $copy;
    }

    public function sessionToken(): ?string
    {
        return $this->sessionToken;
    }
}
