<?php

declare(strict_types=1);

// Shared startup for every PHP entry point and for the tests: class autoloader and error handling.
// Configuration is read by the entry points with Config::load(), so tests can build their own.

namespace SilvaMentis;

const PROJECT_ROOT = __DIR__ . '/..';

// Classes live in src/ with folders mirroring the namespace: SilvaMentis\Http\Request → src/Http/Request.php.
spl_autoload_register(static function (string $class): void {
    $prefix = 'SilvaMentis\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $file = __DIR__ . '/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

/**
 * Never show PHP errors to visitors: they could leak paths or break the JSON protocol.
 * Errors become exceptions; anything uncaught is logged and answered with a JSON server_error.
 */
function installErrorHandling(): void
{
    ini_set('display_errors', '0');
    ini_set('log_errors', '1');
    error_reporting(E_ALL);

    set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
        if (!(error_reporting() & $severity)) {
            return false;
        }
        throw new \ErrorException($message, 0, $severity, $file, $line);
    });

    set_exception_handler(static function (\Throwable $error): void {
        error_log('silva-mentis: ' . $error);
        if (!headers_sent()) {
            http_response_code(500);
            header('Content-Type: application/json; charset=utf-8');
            header('X-Content-Type-Options: nosniff');
            header('Cache-Control: no-store');
        }
        echo '{"error":"server_error","message":"The server ran into an unexpected problem."}';
    });
}
