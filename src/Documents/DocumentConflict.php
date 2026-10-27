<?php

declare(strict_types=1);

namespace SilvaMentis\Documents;

/**
 * A write was based on an outdated version. Carries the server's current document (or null if
 * it does not exist) so the client can resolve the conflict without another request.
 */
final class DocumentConflict extends \RuntimeException
{
    /** @param array{id: string, payload: ?string, version: int, seq: int, deleted: bool}|null $current */
    public function __construct(public readonly ?array $current)
    {
        parent::__construct('The document was changed elsewhere.');
    }
}
