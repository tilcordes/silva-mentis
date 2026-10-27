<?php

declare(strict_types=1);

// JSON API front controller: every request goes to api.php?route=<name> (routes: src/App.php).

use SilvaMentis\App;
use SilvaMentis\Config;
use SilvaMentis\Http\Request;
use SilvaMentis\Http\Response;
use SilvaMentis\Security\SecurityHeaders;

require __DIR__ . '/../src/bootstrap.php';
SilvaMentis\installErrorHandling();

$config = Config::load(SilvaMentis\PROJECT_ROOT);
// Under `php -S` (bin/serve) a new setup token is also printed to the console.
$announce = PHP_SAPI === 'cli-server' ? static fn (string $message) => error_log($message) : null;

try {
    $app = App::create($config, announce: $announce);
} catch (RuntimeException $error) {
    error_log('silva-mentis: ' . $error->getMessage());
    Response::json(['error' => 'server_error', 'message' => $error->getMessage()], 500)
        ->withHeaders(SecurityHeaders::all(false))
        ->send();
    exit;
}

$app->handle(Request::fromGlobals(App::maxBodyBytes($config)))->send();
