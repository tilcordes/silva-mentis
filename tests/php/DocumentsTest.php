<?php

declare(strict_types=1);

// Encrypted document storage: versions, conflicts, delta sync, tombstones, limits.

use Tests\TestServer;
use function Tests\{assertError, assertSame, assertTrue, test};

function loggedIn(array $settings = []): TestServer
{
    $server = new TestServer($settings);
    $server->register();
    return $server;
}

test('documents: create, update and list', function (): void {
    $server = loggedIn();
    assertSame(['documents' => [], 'cursor' => 0], $server->get('documents')->data());
    assertSame(['version' => 1, 'seq' => 1], $server->post('document-save', ['id' => 'p1', 'payload' => 'one', 'baseVersion' => 0])->data());
    assertSame(['version' => 1, 'seq' => 2], $server->post('document-save', ['id' => 'p2', 'payload' => 'two', 'baseVersion' => 0])->data());
    assertSame(['version' => 2, 'seq' => 3], $server->post('document-save', ['id' => 'p1', 'payload' => 'one!', 'baseVersion' => 1])->data());
    $list = $server->get('documents')->data();
    assertSame(3, $list['cursor']);
    assertSame(['p2', 'p1'], array_column($list['documents'], 'id'));
    assertSame(['id' => 'p1', 'payload' => 'one!', 'version' => 2, 'seq' => 3, 'deleted' => false], $list['documents'][1]);
});

test('documents: outdated baseVersion is a conflict with the current copy', function (): void {
    $server = loggedIn();
    $server->post('document-save', ['id' => 'p1', 'payload' => 'a', 'baseVersion' => 0]);
    $server->post('document-save', ['id' => 'p1', 'payload' => 'b', 'baseVersion' => 1]);
    $response = $server->post('document-save', ['id' => 'p1', 'payload' => 'c', 'baseVersion' => 1]);
    assertError(409, 'conflict', $response);
    assertSame(['id' => 'p1', 'payload' => 'b', 'version' => 2, 'seq' => 2, 'deleted' => false], $response->data()['current']);
    $response = $server->post('document-save', ['id' => 'p1', 'payload' => 'c', 'baseVersion' => 0]);
    assertError(409, 'conflict', $response, 'create over an existing document');
    $response = $server->post('document-save', ['id' => 'new', 'payload' => 'c', 'baseVersion' => 4]);
    assertError(409, 'conflict', $response);
    assertSame(null, $response->data()['current']);
});

test('documents: delta sync returns changes after the cursor, tombstones included', function (): void {
    $server = loggedIn();
    $server->post('document-save', ['id' => 'p1', 'payload' => 'a', 'baseVersion' => 0]);
    $server->post('document-save', ['id' => 'p2', 'payload' => 'b', 'baseVersion' => 0]);
    $cursor = $server->get('documents')->data()['cursor'];
    assertSame(['version' => 2, 'seq' => 3], $server->post('document-delete', ['id' => 'p1', 'baseVersion' => 1])->data());
    $server->post('document-save', ['id' => 'p3', 'payload' => 'c', 'baseVersion' => 0]);
    $delta = $server->get('documents', ['since' => (string) $cursor])->data();
    assertSame(4, $delta['cursor']);
    assertSame(['id' => 'p1', 'payload' => null, 'version' => 2, 'seq' => 3, 'deleted' => true], $delta['documents'][0]);
    assertSame('p3', $delta['documents'][1]['id']);
    $full = $server->get('documents')->data();
    assertSame(['p2', 'p3'], array_column($full['documents'], 'id'), 'full load skips tombstones');
    assertSame(['documents' => [], 'cursor' => 4], $server->get('documents', ['since' => '4'])->data());
});

test('documents: delete needs the current version and an existing document', function (): void {
    $server = loggedIn();
    assertError(409, 'conflict', $server->post('document-delete', ['id' => 'ghost', 'baseVersion' => 0]));
    $server->post('document-save', ['id' => 'p1', 'payload' => 'a', 'baseVersion' => 0]);
    assertError(409, 'conflict', $server->post('document-delete', ['id' => 'p1', 'baseVersion' => 0]));
    assertSame(200, $server->post('document-delete', ['id' => 'p1', 'baseVersion' => 1])->status);
    assertSame(['version' => 3, 'seq' => 3], $server->post('document-save', ['id' => 'p1', 'payload' => 'again', 'baseVersion' => 2])->data(), 'a tombstone can be revived');
});

test('documents: validation of ids, versions, payloads and since', function (): void {
    $server = loggedIn(['max_document_bytes' => 2048]);
    foreach (['', 'has space', '../x', str_repeat('a', 65), 'ü'] as $id) {
        assertError(400, 'bad_request', $server->post('document-save', ['id' => $id, 'payload' => 'x', 'baseVersion' => 0]));
    }
    assertError(400, 'bad_request', $server->post('document-save', ['id' => 'a', 'payload' => 'x', 'baseVersion' => -1]));
    assertError(400, 'bad_request', $server->post('document-save', ['id' => 'a', 'payload' => 'x', 'baseVersion' => '1']));
    assertError(400, 'bad_request', $server->post('document-save', ['id' => 'a', 'payload' => '', 'baseVersion' => 0]));
    assertError(400, 'bad_request', $server->post('document-save', ['id' => 'a', 'payload' => ['x'], 'baseVersion' => 0]));
    assertError(413, 'payload_too_large', $server->post('document-save', ['id' => 'a', 'payload' => str_repeat('x', 2049), 'baseVersion' => 0]));
    assertSame(200, $server->post('document-save', ['id' => 'a', 'payload' => str_repeat('x', 2048), 'baseVersion' => 0])->status);
    assertError(400, 'bad_request', $server->get('documents', ['since' => '-1']));
    assertError(400, 'bad_request', $server->get('documents', ['since' => 'abc']));
    assertError(405, 'bad_request', $server->get('document-save'));
});

test('documents: the server stores the payload byte for byte', function (): void {
    $server = loggedIn();
    $payload = '{"v":1,"kid":"k1","iv":"x","ct":"<script>alert(1)</script>ü"}';
    $server->post('document-save', ['id' => 'p1', 'payload' => $payload, 'baseVersion' => 0]);
    assertSame($payload, $server->get('documents')->data()['documents'][0]['payload']);
});
