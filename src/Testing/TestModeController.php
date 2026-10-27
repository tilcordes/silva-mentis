<?php

declare(strict_types=1);

namespace SilvaMentis\Testing;

use SilvaMentis\Documents\DocumentRepository;
use SilvaMentis\Http\Request;
use SilvaMentis\Http\Response;

/**
 * Routes that exist only in the test version. App never registers them in normal mode.
 */
final class TestModeController
{
    public function __construct(private readonly DocumentRepository $documents)
    {
    }

    /** GET status — the test version is always "logged in" and never needs setup. */
    public function status(Request $request): Response
    {
        return Response::json([
            'mode' => 'test',
            'needsSetup' => false,
            'authenticated' => true,
            'username' => null,
            'setup' => null,
        ]);
    }

    /** POST test-reset — forget every test note so the sample notes can be loaded again. */
    public function reset(Request $request): Response
    {
        $this->documents->deleteAll();
        return Response::json(['ok' => true]);
    }
}
