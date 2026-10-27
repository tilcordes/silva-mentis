<?php

declare(strict_types=1);

namespace SilvaMentis\Auth;

use SilvaMentis\Clock;
use SilvaMentis\Database;

/**
 * The one and only account. The table allows a single row (id = 1); its existence is what
 * closes registration.
 */
final class UserRepository
{
    public function __construct(private readonly Database $database, private readonly Clock $clock)
    {
    }

    public function exists(): bool
    {
        return $this->database->run('SELECT 1 FROM user WHERE id = 1')->fetchColumn() !== false;
    }

    /**
     * @return array{username: string, auth_hash: string, kdf: string, wrapped_key: string,
     *               recovery_auth_hash: string, recovery_wrapped_key: string}|null
     */
    public function find(): ?array
    {
        $row = $this->database->run('SELECT * FROM user WHERE id = 1')->fetch();
        return $row === false ? null : $row;
    }

    /**
     * Inserts the account. Fails (constraint violation) if one exists, so two racing setups
     * can't both succeed.
     */
    public function create(string $username, string $authHash, string $kdf, string $wrappedKey,
                           string $recoveryAuthHash, string $recoveryWrappedKey): void
    {
        $now = $this->clock->now();
        $this->database->run(
            'INSERT INTO user (id, username, auth_hash, kdf, wrapped_key, recovery_auth_hash, recovery_wrapped_key, created_at, updated_at)
             VALUES (1, :username, :auth_hash, :kdf, :wrapped_key, :recovery_auth_hash, :recovery_wrapped_key, :now, :now)',
            [
                'username' => $username,
                'auth_hash' => $authHash,
                'kdf' => $kdf,
                'wrapped_key' => $wrappedKey,
                'recovery_auth_hash' => $recoveryAuthHash,
                'recovery_wrapped_key' => $recoveryWrappedKey,
                'now' => $now,
            ],
        );
    }

    public function updatePassword(string $authHash, string $kdf, string $wrappedKey): void
    {
        $this->database->run(
            'UPDATE user SET auth_hash = :auth_hash, kdf = :kdf, wrapped_key = :wrapped_key, updated_at = :now WHERE id = 1',
            ['auth_hash' => $authHash, 'kdf' => $kdf, 'wrapped_key' => $wrappedKey, 'now' => $this->clock->now()],
        );
    }

    public function updateRecovery(string $recoveryAuthHash, string $recoveryWrappedKey): void
    {
        $this->database->run(
            'UPDATE user SET recovery_auth_hash = :hash, recovery_wrapped_key = :wrapped, updated_at = :now WHERE id = 1',
            ['hash' => $recoveryAuthHash, 'wrapped' => $recoveryWrappedKey, 'now' => $this->clock->now()],
        );
    }
}
