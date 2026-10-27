<?php

declare(strict_types=1);

// A tiny test runner, so the PHP tests need nothing but PHP itself.
//
//   php tests/php/run.php            run every *Test.php file in this folder
//   php tests/php/run.php session    run only tests whose name contains "session"
//
// Test files call test('name', function () { ... }) and use the assert helpers from helpers.php.

require __DIR__ . '/../../src/bootstrap.php';
require __DIR__ . '/helpers.php';

$filter = strtolower($argv[1] ?? '');
foreach (glob(__DIR__ . '/*Test.php') as $file) {
    require $file;
}

$passed = 0;
$failed = [];
foreach (Tests\registeredTests() as $name => $body) {
    if ($filter !== '' && !str_contains(strtolower($name), $filter)) {
        continue;
    }
    try {
        $body();
        $passed++;
        echo "  ✓ $name\n";
    } catch (Throwable $error) {
        $failed[] = $name;
        echo "  ✗ $name\n      " . str_replace("\n", "\n      ", $error->getMessage()) . "\n";
        echo '      at ' . Tests\failureLocation($error) . "\n";
    } finally {
        Tests\cleanTemporaryFolders();
    }
}

echo "\n$passed passed, " . count($failed) . " failed\n";
exit($failed === [] ? 0 : 1);
