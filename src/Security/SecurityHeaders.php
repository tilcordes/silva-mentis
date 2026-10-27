<?php

declare(strict_types=1);

namespace SilvaMentis\Security;

/**
 * The headers every PHP response carries. The policy forbids
 * inline scripts and styles and any foreign origin, so injected markup has nothing to run.
 */
final class SecurityHeaders
{
    public const CONTENT_SECURITY_POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; "
        . "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; "
        . "base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; "
        . "require-trusted-types-for 'script'; trusted-types 'none'";

    /** @return array<string, string> */
    public static function all(bool $https): array
    {
        $headers = [
            'Content-Security-Policy' => self::CONTENT_SECURITY_POLICY,
            'X-Content-Type-Options' => 'nosniff',
            'Referrer-Policy' => 'no-referrer',
            'Cross-Origin-Opener-Policy' => 'same-origin',
            'Cross-Origin-Resource-Policy' => 'same-origin',
            'Permissions-Policy' => 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
            'X-Frame-Options' => 'DENY',
            'Cache-Control' => 'no-store',
        ];
        if ($https) {
            $headers['Strict-Transport-Security'] = 'max-age=31536000';
        }
        return $headers;
    }

    /** The policy for the shell's <meta> fallback: frame-ancestors is not allowed there. */
    public static function metaPolicy(): string
    {
        return str_replace("frame-ancestors 'none'; ", '', self::CONTENT_SECURITY_POLICY);
    }
}
