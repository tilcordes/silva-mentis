<?php

declare(strict_types=1);

namespace SilvaMentis\Http;

/**
 * An outgoing HTTP response. Immutable: the with…() methods return changed copies.
 */
final class Response
{
    /**
     * @param array<string, string> $headers
     * @param list<string> $cookies complete Set-Cookie header values
     */
    public function __construct(
        public readonly int $status,
        public readonly string $body,
        public readonly array $headers = [],
        public readonly array $cookies = [],
    ) {
    }

    /** @param array<string, mixed> $data */
    public static function json(array $data, int $status = 200): self
    {
        $body = json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        return new self($status, $body, ['Content-Type' => 'application/json; charset=utf-8']);
    }

    public static function html(string $html, int $status = 200): self
    {
        return new self($status, $html, ['Content-Type' => 'text/html; charset=utf-8']);
    }

    public function withHeader(string $name, string $value): self
    {
        return new self($this->status, $this->body, [$name => $value] + $this->headers, $this->cookies);
    }

    /** @param array<string, string> $headers */
    public function withHeaders(array $headers): self
    {
        return new self($this->status, $this->body, $headers + $this->headers, $this->cookies);
    }

    public function withCookie(string $setCookie): self
    {
        return new self($this->status, $this->body, $this->headers, [...$this->cookies, $setCookie]);
    }

    /** The decoded JSON body (used by tests). */
    public function data(): array
    {
        return json_decode($this->body, true, 64, JSON_THROW_ON_ERROR);
    }

    public function send(): void
    {
        http_response_code($this->status);
        foreach ($this->headers as $name => $value) {
            header("$name: $value");
        }
        foreach ($this->cookies as $cookie) {
            header("Set-Cookie: $cookie", false);
        }
        echo $this->body;
    }
}
