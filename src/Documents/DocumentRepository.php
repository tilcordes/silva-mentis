<?php

declare(strict_types=1);

namespace SilvaMentis\Documents;

use SilvaMentis\Clock;
use SilvaMentis\Database;

/**
 * Stores encrypted documents as opaque strings.
 *
 * Two numbers make sync work without the server understanding the content:
 * - version (per document) grows with every write. A save names the version it was based on;
 *   if that is not the current one, another device wrote in between → conflict.
 * - seq (global) grows with every write to any document. A client asks for "everything after
 *   seq N" to catch up (delta sync). Deleted documents stay as tombstones so deletions sync too.
 */
final class DocumentRepository
{
    public function __construct(private readonly Database $database, private readonly Clock $clock)
    {
    }

    /**
     * Every document changed after $since, oldest change first, and the cursor for the next call.
     * The first full load ($since = 0) skips tombstones: there is nothing to delete yet.
     *
     * @return array{documents: list<array{id: string, payload: ?string, version: int, seq: int, deleted: bool}>, cursor: int}
     */
    public function since(int $since): array
    {
        $sql = 'SELECT id, payload, version, seq, deleted FROM documents WHERE seq > :since'
            . ($since === 0 ? ' AND deleted = 0' : '') . ' ORDER BY seq';
        $rows = $this->database->run($sql, ['since' => $since])->fetchAll();
        return ['documents' => array_map(self::present(...), $rows), 'cursor' => $this->currentSeq()];
    }

    /** @return array{id: string, payload: ?string, version: int, seq: int, deleted: bool}|null */
    public function find(string $id): ?array
    {
        $row = $this->database->run(
            'SELECT id, payload, version, seq, deleted FROM documents WHERE id = :id',
            ['id' => $id],
        )->fetch();
        return $row === false ? null : self::present($row);
    }

    /**
     * Writes a document if $baseVersion matches the stored version (0 = the document must not
     * exist yet).
     *
     * @return array{version: int, seq: int}
     * @throws DocumentConflict
     */
    public function save(string $id, string $payload, int $baseVersion): array
    {
        return $this->write($id, $payload, $baseVersion, false);
    }

    /**
     * Turns a document into a tombstone.
     *
     * @return array{version: int, seq: int}
     * @throws DocumentConflict
     */
    public function delete(string $id, int $baseVersion): array
    {
        return $this->write($id, null, $baseVersion, true);
    }

    /** Removes every document (test mode reset). */
    public function deleteAll(): void
    {
        $this->database->transaction(function (): void {
            $this->database->run('DELETE FROM documents');
            $this->database->run("UPDATE counters SET value = 0 WHERE name = 'seq'");
        });
    }

    /** @return array{version: int, seq: int} */
    private function write(string $id, ?string $payload, int $baseVersion, bool $deleted): array
    {
        return $this->database->transaction(function () use ($id, $payload, $baseVersion, $deleted): array {
            $current = $this->find($id);
            $currentVersion = $current['version'] ?? 0;
            if ($currentVersion !== $baseVersion || ($deleted && $current === null)) {
                throw new DocumentConflict($current);
            }
            $this->database->run("UPDATE counters SET value = value + 1 WHERE name = 'seq'");
            $seq = $this->currentSeq();
            $version = $currentVersion + 1;
            $this->database->run(
                'INSERT INTO documents (id, payload, version, seq, deleted, updated_at)
                 VALUES (:id, :payload, :version, :seq, :deleted, :now)
                 ON CONFLICT (id) DO UPDATE SET payload = excluded.payload, version = excluded.version,
                     seq = excluded.seq, deleted = excluded.deleted, updated_at = excluded.updated_at',
                ['id' => $id, 'payload' => $payload, 'version' => $version, 'seq' => $seq,
                 'deleted' => $deleted ? 1 : 0, 'now' => $this->clock->now()],
            );
            return ['version' => $version, 'seq' => $seq];
        });
    }

    private function currentSeq(): int
    {
        return (int) $this->database->run("SELECT value FROM counters WHERE name = 'seq'")->fetchColumn();
    }

    /** @param array<string, mixed> $row */
    private static function present(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'payload' => $row['payload'] === null ? null : (string) $row['payload'],
            'version' => (int) $row['version'],
            'seq' => (int) $row['seq'],
            'deleted' => (bool) $row['deleted'],
        ];
    }
}
