<?php

declare(strict_types=1);

// The test version: no login, loopback only, its own database, the reset route.

use SilvaMentis\App;
use SilvaMentis\Config;
use SilvaMentis\Http\Request;
use Tests\TestServer;
use function Tests\{assertError, assertSame, assertTrue, assertFalse, temporaryFolder, test};

test('test mode: status reports test mode and documents need no login', function (): void {
    $server = new TestServer(['mode' => 'test']);
    $status = $server->get('status')->data();
    assertSame('test', $status['mode']);
    assertFalse($status['needsSetup']);
    assertTrue($status['authenticated']);
    assertSame(200, $server->post('document-save', ['id' => 'p1', 'payload' => '{"v":0}', 'baseVersion' => 0])->status);
    assertSame(1, count($server->get('documents')->data()['documents']));
});

test('test mode: account routes do not exist, reset does', function (): void {
    $server = new TestServer(['mode' => 'test']);
    foreach (['setup', 'login', 'password', 'recover', 'recover-finish', 'sessions-revoke', 'logout'] as $route) {
        assertError(404, 'not_found', $server->post($route, []));
    }
    assertError(404, 'not_found', $server->get('login-params'));
    $server->post('document-save', ['id' => 'p1', 'payload' => 'x', 'baseVersion' => 0]);
    assertSame(['ok' => true], $server->post('test-reset')->data());
    assertSame(['documents' => [], 'cursor' => 0], $server->get('documents')->data());
});

test('test mode: only loopback clients and local host names', function (): void {
    $server = new TestServer(['mode' => 'test']);
    $server->remoteAddr = '192.168.1.20';
    assertError(403, 'forbidden', $server->get('status'));
    $server->remoteAddr = '::1';
    assertSame(200, $server->get('status')->status);
    assertError(403, 'forbidden', $server->get('status', [], ['Host' => 'evil.example']));
    assertSame(200, $server->get('status', [], ['Host' => '127.0.0.1:8081'])->status);
    assertSame(200, $server->get('status', [], ['Host' => '[::1]:8081'])->status);
});

test('test mode: allow-remote and extra host names are opt-in', function (): void {
    $server = new TestServer(['mode' => 'test', 'test_mode_allow_remote' => true, 'allowed_hosts' => ['notes.lan']]);
    $server->remoteAddr = '192.168.1.20';
    assertSame(200, $server->get('status', [], ['Host' => 'notes.lan:8081'])->status);
    assertError(403, 'forbidden', $server->get('status', [], ['Host' => 'other.lan']));
});

test('test mode: the shell is guarded too; normal mode answers anyone', function (): void {
    $folder = temporaryFolder();
    $remote = new Request(headers: ['Host' => 'localhost'], remoteAddr: '203.0.113.5');
    assertSame(403, App::shell(Config::fromArray(['mode' => 'test', 'data_dir' => $folder], $folder), $remote)->status);
    $shell = App::shell(Config::fromArray(['data_dir' => $folder], $folder), $remote);
    assertSame(200, $shell->status);
    assertSame('text/html; charset=utf-8', $shell->headers['Content-Type']);
    assertTrue(isset($shell->headers['Content-Security-Policy']));
});

test('test mode: uses its own database file', function (): void {
    $folder = temporaryFolder();
    assertTrue(str_ends_with(Config::fromArray(['mode' => 'test', 'data_dir' => $folder], $folder)->databasePath(), 'silva-mentis-test.sqlite'));
    $app = App::create(Config::fromArray(['mode' => 'test', 'data_dir' => $folder], $folder));
    $app->handle(new Request('GET', ['route' => 'status'], ['X-Silva-Mentis' => '1', 'Host' => 'localhost']));
    assertTrue(is_file($folder . '/silva-mentis-test.sqlite'));
    assertFalse(is_file($folder . '/silva-mentis.sqlite'));
});
