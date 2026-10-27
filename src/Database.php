<?php

declare(strict_types=1);

namespace SilvaMentis;

use PDO;

/**
 * The SQLite connection and its schema. Migrations are numbered; PRAGMA user_version records
 * how many have run, so upgrading an installation only applies the new ones.
 */
final class Database
{
    /** @var list<list<string>> one entry per schema version, each a list of SQL statements */
    private const MIGRATIONS = [
        [
            'CREATE TABLE user (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                username TEXT NOT NULL,
                auth_hash TEXT NOT NULL,
                kdf TEXT NOT NULL,
                wrapped_key TEXT NOT NULL,
                recovery_auth_hash TEXT NOT NULL,
                recovery_wrapped_key TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )',
            'CREATE TABLE sessions (
                token_hash TEXT PRIMARY KEY,
                created_at INTEGER NOT NULL,
                last_seen_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            )',
            'CREATE TABLE documents (
                id TEXT PRIMARY KEY,
                payload TEXT,
                version INTEGER NOT NULL,
                seq INTEGER NOT NULL,
                deleted INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL
            )',
            'CREATE INDEX documents_by_seq ON documents (seq)',
            'CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL)',
            "INSERT INTO counters (name, value) VALUES ('seq', 0)",
            'CREATE TABLE attempts (scope TEXT NOT NULL, client TEXT NOT NULL, at INTEGER NOT NULL)',
            'CREATE INDEX attempts_lookup ON attempts (scope, client, at)',
        ],
    ];

    private function __construct(public readonly PDO $pdo)
    {
    }

    /**
     * Opens (and creates, if needed) the database file and brings the schema up to date.
     * ':memory:' gives a throwaway database for tests.
     */
    public static function open(string $path): self
    {
        if (!extension_loaded('pdo_sqlite')) {
            throw new \RuntimeException('PHP\'s pdo_sqlite extension is missing. Enable it in your hosting panel (it is on by default almost everywhere).');
        }
        if ($path !== ':memory:') {
            $folder = dirname($path);
            if (!is_dir($folder) || !is_writable($folder)) {
                error_log("silva-mentis: the data folder $folder is missing or not writable by PHP.");
                throw new \RuntimeException('The data folder is missing or not writable by PHP. See README.md, "Installation".');
            }
        }
        $pdo = new PDO('sqlite:' . $path, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_STRINGIFY_FETCHES => false,
        ]);
        // Wait instead of failing when another request holds the write lock.
        $pdo->exec('PRAGMA busy_timeout = 5000');
        $pdo->exec('PRAGMA foreign_keys = ON');
        if ($path !== ':memory:') {
            // The classic rollback journal, not WAL: WAL needs shared memory, which fails on the
            // network filesystems some shared hosts use. One user doesn't need WAL's concurrency.
            $pdo->exec('PRAGMA journal_mode = DELETE');
            @chmod($path, 0600);
        }
        $database = new self($pdo);
        $database->migrate();
        return $database;
    }

    /** Applies every migration that has not run yet. */
    public function migrate(): void
    {
        $current = (int) $this->pdo->query('PRAGMA user_version')->fetchColumn();
        foreach (array_slice(self::MIGRATIONS, $current, null, true) as $index => $statements) {
            $this->transaction(function () use ($statements, $index): void {
                foreach ($statements as $sql) {
                    $this->pdo->exec($sql);
                }
                $this->pdo->exec('PRAGMA user_version = ' . ($index + 1));
            });
        }
    }

    /**
     * Runs $work inside one write transaction and returns its result.
     * BEGIN IMMEDIATE takes the write lock up front, so two requests can't deadlock on an upgrade.
     *
     * @template T
     * @param callable(): T $work
     * @return T
     */
    public function transaction(callable $work): mixed
    {
        $this->pdo->exec('BEGIN IMMEDIATE');
        try {
            $result = $work();
            $this->pdo->exec('COMMIT');
            return $result;
        } catch (\Throwable $error) {
            $this->pdo->exec('ROLLBACK');
            throw $error;
        }
    }

    /**
     * Runs a prepared statement and returns it, ready for fetching.
     *
     * @param array<string, mixed> $parameters
     */
    public function run(string $sql, array $parameters = []): \PDOStatement
    {
        $statement = $this->pdo->prepare($sql);
        $statement->execute($parameters);
        return $statement;
    }
}
