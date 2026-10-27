<?php

declare(strict_types=1);

namespace SilvaMentis\Security;

use SilvaMentis\Clock;
use SilvaMentis\Database;
use SilvaMentis\Http\HttpException;

/**
 * Slows down password, setup-token and recovery-key guessing.
 *
 * Two limits apply. Per client: 5 failures per 15 minutes. Globally, against attackers with many
 * addresses: after 10 failures within an hour, one attempt every 30 s, doubling up to 15 minutes.
 * Unlocked devices never need a credential check, so the owner keeps working during an attack.
 */
final class RateLimiter
{
    public const CLIENT_LIMIT = 5;
    public const CLIENT_WINDOW = 15 * 60;
    public const GLOBAL_THRESHOLD = 10;
    public const GLOBAL_WINDOW = 60 * 60;
    public const GLOBAL_BASE_DELAY = 30;
    public const GLOBAL_MAX_DELAY = 15 * 60;

    private const SCOPE_CLIENT = 'credential';
    private const SCOPE_GLOBAL = 'global';
    private const GLOBAL_CLIENT = '*';

    public function __construct(private readonly Database $database, private readonly Clock $clock)
    {
    }

    /** Throws too_many_requests if this client (or everybody) must wait before the next attempt. */
    public function check(string $clientKey): void
    {
        $now = $this->clock->now();
        $this->database->run('DELETE FROM attempts WHERE at < :cutoff', ['cutoff' => $now - 86_400]);

        $clientFailures = $this->database->run(
            'SELECT at FROM attempts WHERE scope = :scope AND client = :client AND at > :since ORDER BY at',
            ['scope' => self::SCOPE_CLIENT, 'client' => $clientKey, 'since' => $now - self::CLIENT_WINDOW],
        )->fetchAll(\PDO::FETCH_COLUMN);
        if (count($clientFailures) >= self::CLIENT_LIMIT) {
            // Wait until the oldest counted failure leaves the window.
            $oldest = (int) $clientFailures[count($clientFailures) - self::CLIENT_LIMIT];
            $this->refuse($oldest + self::CLIENT_WINDOW - $now);
        }

        $globalFailures = $this->database->run(
            'SELECT at FROM attempts WHERE scope = :scope AND client = :client AND at > :since ORDER BY at',
            ['scope' => self::SCOPE_GLOBAL, 'client' => self::GLOBAL_CLIENT, 'since' => $now - self::GLOBAL_WINDOW],
        )->fetchAll(\PDO::FETCH_COLUMN);
        $count = count($globalFailures);
        if ($count >= self::GLOBAL_THRESHOLD) {
            $delay = min(self::GLOBAL_MAX_DELAY, self::GLOBAL_BASE_DELAY * 2 ** min(20, $count - self::GLOBAL_THRESHOLD));
            $last = (int) end($globalFailures);
            if ($now - $last < $delay) {
                $this->refuse($last + $delay - $now);
            }
        }
    }

    public function recordFailure(string $clientKey): void
    {
        $now = $this->clock->now();
        $insert = 'INSERT INTO attempts (scope, client, at) VALUES (:scope, :client, :at)';
        $this->database->run($insert, ['scope' => self::SCOPE_CLIENT, 'client' => $clientKey, 'at' => $now]);
        $this->database->run($insert, ['scope' => self::SCOPE_GLOBAL, 'client' => self::GLOBAL_CLIENT, 'at' => $now]);
    }

    /** The owner got in: forget the global counter and this client's failures. */
    public function recordSuccess(string $clientKey): void
    {
        $this->database->run(
            'DELETE FROM attempts WHERE (scope = :global AND client = :all) OR (scope = :scope AND client = :client)',
            ['global' => self::SCOPE_GLOBAL, 'all' => self::GLOBAL_CLIENT, 'scope' => self::SCOPE_CLIENT, 'client' => $clientKey],
        );
    }

    private function refuse(int $seconds): never
    {
        $seconds = max(1, $seconds);
        throw new HttpException(
            429,
            'too_many_requests',
            "Too many failed attempts. Try again in $seconds seconds.",
            ['retryAfter' => $seconds],
            ['Retry-After' => (string) $seconds],
        );
    }
}
