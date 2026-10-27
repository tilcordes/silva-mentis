<?php

declare(strict_types=1);

namespace SilvaMentis\Documents;

use SilvaMentis\Http\HttpException;
use SilvaMentis\Http\Input;
use SilvaMentis\Http\Request;
use SilvaMentis\Http\Response;

/**
 * Routes for reading and writing encrypted documents: documents, document-save, document-delete.
 */
final class DocumentController
{
    public function __construct(private readonly DocumentRepository $documents, private readonly int $maxDocumentBytes)
    {
    }

    /** GET documents?since=<seq> */
    public function list(Request $request): Response
    {
        $since = $request->queryValue('since') ?? '0';
        if (preg_match('/^\d{1,18}$/', $since) !== 1) {
            throw HttpException::badRequest('since must be a non-negative integer.');
        }
        return Response::json($this->documents->since((int) $since));
    }

    /** POST document-save {id, payload, baseVersion} */
    public function save(Request $request): Response
    {
        $data = $request->json();
        $id = Input::documentId($data);
        $payload = Input::payload($data, $this->maxDocumentBytes);
        $baseVersion = Input::version($data);
        try {
            return Response::json($this->documents->save($id, $payload, $baseVersion));
        } catch (DocumentConflict $conflict) {
            throw self::conflict($conflict);
        }
    }

    /** POST document-delete {id, baseVersion} */
    public function delete(Request $request): Response
    {
        $data = $request->json();
        $id = Input::documentId($data);
        $baseVersion = Input::version($data);
        try {
            return Response::json($this->documents->delete($id, $baseVersion));
        } catch (DocumentConflict $conflict) {
            throw self::conflict($conflict);
        }
    }

    private static function conflict(DocumentConflict $conflict): HttpException
    {
        return new HttpException(409, 'conflict', 'This page was changed on another device.', ['current' => $conflict->current]);
    }
}
