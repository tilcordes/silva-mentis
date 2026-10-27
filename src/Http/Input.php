<?php

declare(strict_types=1);

namespace SilvaMentis\Http;

/**
 * Validation of request fields. Each method returns the clean
 * value or throws a bad_request naming the field.
 */
final class Input
{
    public const KDF_ALGORITHM = 'PBKDF2-SHA256';
    public const KDF_MIN_ITERATIONS = 600_000;
    private const KDF_MAX_ITERATIONS = 10_000_000;

    /** @param array<string, mixed> $data */
    public static function username(array $data, string $field = 'username'): string
    {
        $value = $data[$field] ?? null;
        if (!is_string($value) || $value === '' || mb_strlen($value) > 64 || !mb_check_encoding($value, 'UTF-8')
            || preg_match('/[\p{C}]/u', $value) === 1 || trim($value) !== $value) {
            throw HttpException::badRequest("$field must be 1–64 printable characters without surrounding spaces.");
        }
        return $value;
    }

    /** A derived 32-byte key as unpadded base64url (authKey, recoveryAuthKey, …). */
    public static function derivedKey(array $data, string $field): string
    {
        $value = $data[$field] ?? null;
        if (!is_string($value) || preg_match('/^[A-Za-z0-9_-]{43}$/', $value) !== 1) {
            throw HttpException::badRequest("$field must be a 32-byte base64url value.");
        }
        return $value;
    }

    /**
     * The key-derivation record. The server enforces the same minimum as the browser, so a
     * mistake on either side can't weaken the password hashing.
     *
     * @return array{alg: string, iterations: int, salt: string}
     */
    public static function kdf(array $data, string $field): array
    {
        $value = $data[$field] ?? null;
        if (!is_array($value)
            || ($value['alg'] ?? null) !== self::KDF_ALGORITHM
            || !is_int($value['iterations'] ?? null)
            || $value['iterations'] < self::KDF_MIN_ITERATIONS
            || $value['iterations'] > self::KDF_MAX_ITERATIONS
            || !is_string($value['salt'] ?? null)
            || preg_match('/^[A-Za-z0-9_-]{22,128}$/', $value['salt']) !== 1
        ) {
            throw HttpException::badRequest("$field must be a PBKDF2-SHA256 record with at least 600000 iterations and a 16-byte salt.");
        }
        return ['alg' => $value['alg'], 'iterations' => $value['iterations'], 'salt' => $value['salt']];
    }

    /** An encrypted envelope {v: 1, kid, iv, ct} holding a wrapped key, kept as its JSON text. */
    public static function wrappedKey(array $data, string $field): string
    {
        $value = $data[$field] ?? null;
        if (!is_string($value) || strlen($value) > 1000) {
            throw HttpException::badRequest("$field must be an encrypted key envelope.");
        }
        $envelope = json_decode($value, true);
        if (!is_array($envelope) || ($envelope['v'] ?? null) !== 1
            || !is_string($envelope['iv'] ?? null) || !is_string($envelope['ct'] ?? null)) {
            throw HttpException::badRequest("$field must be an encrypted key envelope.");
        }
        return $value;
    }

    public static function documentId(array $data, string $field = 'id'): string
    {
        $value = $data[$field] ?? null;
        if (!is_string($value) || preg_match('/^[A-Za-z0-9_-]{1,64}$/', $value) !== 1) {
            throw HttpException::badRequest("$field must be 1–64 letters, digits, '_' or '-'.");
        }
        return $value;
    }

    public static function version(array $data, string $field = 'baseVersion'): int
    {
        $value = $data[$field] ?? null;
        if (!is_int($value) || $value < 0) {
            throw HttpException::badRequest("$field must be an integer of at least 0.");
        }
        return $value;
    }

    public static function payload(array $data, int $maxBytes, string $field = 'payload'): string
    {
        $value = $data[$field] ?? null;
        if (!is_string($value) || $value === '') {
            throw HttpException::badRequest("$field must be a non-empty string.");
        }
        if (strlen($value) > $maxBytes) {
            throw new HttpException(413, 'payload_too_large', "This document is larger than the server accepts ($maxBytes bytes).");
        }
        return $value;
    }

    public static function setupToken(array $data): string
    {
        $value = $data['setupToken'] ?? null;
        if (!is_string($value)) {
            throw HttpException::badRequest('setupToken is required.');
        }
        // People copy the token with spaces or dashes, as the setup screen groups it.
        return strtolower(preg_replace('/[^0-9a-fA-F]/', '', $value) ?? '');
    }
}
