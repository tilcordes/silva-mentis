<?php

declare(strict_types=1);

namespace SilvaMentis\Http;

/**
 * An error the client should see: HTTP status, a machine-readable code (bad_request,
 * unauthorized, forbidden, not_found, conflict, too_many_requests, payload_too_large, …) and a
 * human-readable message. Extra fields are merged into the JSON body.
 */
final class HttpException extends \RuntimeException
{
    /**
     * @param array<string, mixed> $extra
     * @param array<string, string> $headers
     */
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        string $message,
        public readonly array $extra = [],
        public readonly array $headers = [],
    ) {
        parent::__construct($message);
    }

    public static function badRequest(string $message): self
    {
        return new self(400, 'bad_request', $message);
    }

    public static function unauthorized(string $message = 'Please log in.'): self
    {
        return new self(401, 'unauthorized', $message);
    }

    public static function forbidden(string $message): self
    {
        return new self(403, 'forbidden', $message);
    }

    public static function notFound(string $message = 'Not found.'): self
    {
        return new self(404, 'not_found', $message);
    }

    public function toResponse(): Response
    {
        $body = ['error' => $this->errorCode, 'message' => $this->getMessage()] + $this->extra;
        $response = Response::json($body, $this->status);
        foreach ($this->headers as $name => $value) {
            $response = $response->withHeader($name, $value);
        }
        return $response;
    }
}
