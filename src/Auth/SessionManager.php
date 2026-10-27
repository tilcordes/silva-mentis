<?php

declare(strict_types=1);

namespace SilvaMentis\Auth;

use SilvaMentis\Clock;
use SilvaMentis\Database;

/**
 * Login sessions. The cookie carries a random token; the
 * database keeps only its SHA-256 hash, so a copied database can't be used to log in.
 */
final class SessionManager
{
    private const SECURE_COOKIE = '__Host-silva-mentis';
    private const LOCAL_COOKIE = 'silva-mentis';
    private const TOUCH_INTERVAL = 60;

    public function __construct(
        private readonly Database $database,
        private readonly Clock $clock,
        private readonly int $idleDays,
        private readonly int $maxDays,
    ) {
    }

    /** The __Host- prefix requires Secure, which browsers only accept over HTTPS. */
    public static function cookieName(bool $https): string
    {
        return $https ? self::SECURE_COOKIE : self::LOCAL_COOKIE;
    }

    /** Creates a session and returns its token (the cookie value). */
    public function start(): string
    {
        $token = self::base64url(random_bytes(32));
        $now = $this->clock->now();
        $this->database->run(
            'INSERT INTO sessions (token_hash, created_at, last_seen_at, expires_at) VALUES (:hash, :now, :now, :expires)',
            ['hash' => self::hash($token), 'now' => $now, 'expires' => $now + $this->maxDays * 86_400],
        );
        return $token;
    }

    /** True if the token belongs to a live session. Ends idle or too old sessions on the way. */
    public function isValid(?string $token): bool
    {
        if ($token === null || preg_match('/^[A-Za-z0-9_-]{43}$/', $token) !== 1) {
            return false;
        }
        $now = $this->clock->now();
        $idleCutoff = $now - $this->idleDays * 86_400;
        $this->database->run(
            'DELETE FROM sessions WHERE expires_at <= :now OR last_seen_at <= :idle',
            ['now' => $now, 'idle' => $idleCutoff],
        );
        $session = $this->database->run(
            'SELECT last_seen_at FROM sessions WHERE token_hash = :hash',
            ['hash' => self::hash($token)],
        )->fetch();
        if ($session === false) {
            return false;
        }
        // Writing on every request would be wasteful; a minute's precision is plenty for idle checks.
        if ($now - (int) $session['last_seen_at'] >= self::TOUCH_INTERVAL) {
            $this->database->run(
                'UPDATE sessions SET last_seen_at = :now WHERE token_hash = :hash',
                ['now' => $now, 'hash' => self::hash($token)],
            );
        }
        return true;
    }

    public function end(string $token): void
    {
        $this->database->run('DELETE FROM sessions WHERE token_hash = :hash', ['hash' => self::hash($token)]);
    }

    /** "Log out other devices": every session except $keepToken ends. */
    public function endOthers(string $keepToken): void
    {
        $this->database->run('DELETE FROM sessions WHERE token_hash != :hash', ['hash' => self::hash($keepToken)]);
    }

    public function endAll(): void
    {
        $this->database->run('DELETE FROM sessions');
    }

    public function count(): int
    {
        return (int) $this->database->run('SELECT COUNT(*) FROM sessions')->fetchColumn();
    }

    /** The Set-Cookie value that stores $token in the browser. */
    public function cookie(string $token, bool $https): string
    {
        $maxAge = $this->maxDays * 86_400;
        return self::cookieName($https) . "=$token; Max-Age=$maxAge; Path=/; HttpOnly; SameSite=Strict"
            . ($https ? '; Secure' : '');
    }

    /** The Set-Cookie value that removes the session cookie. */
    public function clearCookie(bool $https): string
    {
        return self::cookieName($https) . '=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict' . ($https ? '; Secure' : '');
    }

    private static function hash(string $token): string
    {
        return hash('sha256', $token);
    }

    private static function base64url(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }
}
