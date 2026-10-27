<?php

declare(strict_types=1);

// Router, request parsing, the X-Silva-Mentis header and security headers.

use SilvaMentis\Http\HttpException;
use SilvaMentis\Http\Request;
use SilvaMentis\Http\Response;
use SilvaMentis\Http\Router;
use SilvaMentis\Security\ClientAddress;
use SilvaMentis\Security\SecurityHeaders;
use Tests\TestServer;
use function Tests\{assertError, assertSame, assertTrue, assertFalse, assertThrows, test};

test('router: unknown route is a JSON 404, wrong method a 405', function (): void {
    $router = new Router();
    $router->add('POST', 'thing', fn () => Response::json(['ok' => true]));
    $error = assertThrows(HttpException::class, fn () => $router->match(new Request('POST', ['route' => 'nope'])));
    assertSame(404, $error->status);
    $error = assertThrows(HttpException::class, fn () => $router->match(new Request('GET', ['route' => 'thing'])));
    assertSame(405, $error->status);
    assertSame('POST', $error->headers['Allow']);
});

test('request: body must be a JSON object', function (): void {
    assertSame(['a' => 1], (new Request('POST', [], [], '{"a":1}'))->json());
    assertSame([], (new Request('POST', [], [], ''))->json());
    foreach (['[1,2]', 'nope', '"text"', '{"a":'] as $body) {
        $error = assertThrows(HttpException::class, fn () => (new Request('POST', [], [], $body))->json());
        assertSame('bad_request', $error->errorCode);
    }
});

test('request: host name without port', function (): void {
    assertSame('localhost', (new Request(headers: ['Host' => 'localhost:8080']))->hostName());
    assertSame('[::1]', (new Request(headers: ['Host' => '[::1]:8081']))->hostName());
    assertSame('notes.example.com', (new Request(headers: ['Host' => 'Notes.Example.com']))->hostName());
});

test('api: requests without X-Silva-Mentis header are refused', function (): void {
    $server = new TestServer();
    assertError(403, 'forbidden', $server->get('status', [], ['X-Silva-Mentis' => '0']));
    assertSame(200, $server->get('status')->status);
});

test('api: every response carries the security headers, errors included', function (): void {
    $server = new TestServer();
    foreach ([$server->get('status'), $server->get('nope'), $server->get('documents')] as $response) {
        assertSame(SecurityHeaders::CONTENT_SECURITY_POLICY, $response->headers['Content-Security-Policy']);
        assertSame('nosniff', $response->headers['X-Content-Type-Options']);
        assertSame('no-store', $response->headers['Cache-Control']);
        assertSame('DENY', $response->headers['X-Frame-Options']);
        assertSame('application/json; charset=utf-8', $response->headers['Content-Type']);
        assertFalse(isset($response->headers['Strict-Transport-Security']));
    }
    $server->https = true;
    assertSame('max-age=31536000', $server->get('status')->headers['Strict-Transport-Security']);
});

test('api: oversized bodies are refused before parsing', function (): void {
    $server = new TestServer(['max_document_bytes' => 2000]);
    $response = $server->send('POST', 'login', str_repeat('x', 2000 + 65_537));
    assertError(413, 'payload_too_large', $response);
});

test('csp: meta fallback drops frame-ancestors only', function (): void {
    $meta = SecurityHeaders::metaPolicy();
    assertFalse(str_contains($meta, 'frame-ancestors'));
    assertTrue(str_contains($meta, "script-src 'self'"));
    assertTrue(str_contains($meta, "trusted-types 'none'"));
});

test('shell: the app shell has no inline script or style', function (): void {
    $html = file_get_contents(__DIR__ . '/../../src/View/app.html');
    assertFalse((bool) preg_match('/<script(?![^>]*\ssrc=)[^>]*>/i', $html), 'inline <script>');
    assertFalse((bool) preg_match('/<style/i', $html), '<style> element');
    assertFalse((bool) preg_match('/\sstyle\s*=/i', $html), 'style attribute');
    assertFalse((bool) preg_match('/\son[a-z]+\s*=/i', $html), 'inline event handler');
    assertTrue(str_contains($html, SecurityHeaders::metaPolicy()), 'meta CSP matches the header');
});

test('client address: proxies are believed only when trusted', function (): void {
    $plain = new ClientAddress();
    $proxied = new ClientAddress(['10.0.0.1']);
    $request = new Request(headers: ['X-Forwarded-For' => '203.0.113.9, 10.0.0.1', 'X-Forwarded-Proto' => 'https'], remoteAddr: '10.0.0.1');
    assertSame('10.0.0.1', $plain->ip($request));
    assertFalse($plain->isHttps($request));
    assertSame('203.0.113.9', $proxied->ip($request));
    assertTrue($proxied->isHttps($request));
    $spoofed = new Request(headers: ['X-Forwarded-For' => '1.2.3.4'], remoteAddr: '198.51.100.7');
    assertSame('198.51.100.7', $proxied->ip($spoofed));
});

test('client address: trusted proxies may be networks', function (): void {
    assertTrue(ClientAddress::matches('172.18.0.3', '172.16.0.0/12'));
    assertFalse(ClientAddress::matches('172.32.0.1', '172.16.0.0/12'));
    assertTrue(ClientAddress::matches('10.1.2.3', '10.1.2.3'));
    assertFalse(ClientAddress::matches('10.1.2.4', '10.1.2.3'));
    assertTrue(ClientAddress::matches('fd00::1', 'fd00::/8'));
    assertFalse(ClientAddress::matches('fd00::1', '10.0.0.0/8'), 'mixed families never match');
    assertFalse(ClientAddress::matches('10.0.0.1', 'garbage/8'));
    $proxied = new ClientAddress(['172.16.0.0/12']);
    $request = new Request(headers: ['X-Forwarded-For' => '203.0.113.9', 'X-Forwarded-Proto' => 'https'], remoteAddr: '172.20.0.2');
    assertSame('203.0.113.9', $proxied->ip($request));
    assertTrue($proxied->isHttps($request));
});

test('client address: IPv6 is grouped by /64, loopback detection', function (): void {
    assertSame(ClientAddress::networkKey('2001:db8:1:2::1'), ClientAddress::networkKey('2001:db8:1:2:ffff::9'));
    assertTrue(ClientAddress::networkKey('2001:db8:1:2::1') !== ClientAddress::networkKey('2001:db8:1:3::1'));
    assertSame('192.0.2.4', ClientAddress::networkKey('192.0.2.4'));
    assertSame('192.0.2.4', ClientAddress::networkKey('::ffff:192.0.2.4'));
    assertTrue(ClientAddress::isLoopback('127.0.0.1'));
    assertTrue(ClientAddress::isLoopback('127.8.9.1'));
    assertTrue(ClientAddress::isLoopback('::1'));
    assertFalse(ClientAddress::isLoopback('192.168.1.2'));
    assertFalse(ClientAddress::isLoopback('garbage'));
});
