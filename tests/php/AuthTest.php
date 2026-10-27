<?php

declare(strict_types=1);

// Setup, login, sessions, password change and recovery through the real routes.

use Tests\TestServer;
use function Tests\{assertError, assertSame, assertTrue, assertFalse, envelope, kdf, test};
use const Tests\{KEY_A, KEY_B, KEY_C, KEY_R, KEY_S};

test('setup: status asks for setup and creates a token file', function (): void {
    $server = new TestServer();
    $status = $server->get('status')->data();
    assertSame('normal', $status['mode']);
    assertTrue($status['needsSetup']);
    assertFalse($status['authenticated']);
    assertTrue((bool) preg_match('/^setup-token-[0-9a-f]{8}\.txt$/', $status['setup']['tokenFile']));
    assertSame(null, $status['setup']['dataPath']);
    $token = $server->setupToken();
    assertTrue((bool) preg_match('/^[0-9a-f]{32}$/', $token));
    assertSame('0600', substr(sprintf('%o', fileperms(glob($server->dataDir . '/setup-token-*')[0])), -4));
    // Asking again keeps the same token.
    $server->get('status');
    assertSame($token, $server->setupToken());
});

test('setup: wrong token is refused and counted', function (): void {
    $server = new TestServer();
    $server->setupToken();
    $response = $server->post('setup', [
        'setupToken' => str_repeat('0', 32), 'username' => 'ada', 'authKey' => KEY_A, 'kdf' => kdf(),
        'wrappedKey' => envelope('w'), 'recoveryAuthKey' => KEY_R, 'recoveryWrappedKey' => envelope('r'),
    ]);
    assertError(401, 'unauthorized', $response);
    assertSame(1, (int) $server->database->run('SELECT COUNT(*) FROM attempts WHERE scope = \'credential\'')->fetchColumn());
});

test('setup: success logs in, deletes the token and closes registration', function (): void {
    $server = new TestServer();
    $response = $server->register();
    assertSame(201, $response->status, $response->body);
    assertSame(['username' => 'ada'], $response->data());
    assertTrue(str_contains($response->cookies[0], 'HttpOnly'));
    assertTrue(str_contains($response->cookies[0], 'SameSite=Strict'));
    assertSame([], glob($server->dataDir . '/setup-token-*'));
    $status = $server->get('status')->data();
    assertFalse($status['needsSetup']);
    assertTrue($status['authenticated']);
    assertSame('ada', $status['username']);
    assertSame(null, $status['setup']);
    assertError(403, 'setup_closed', $server->register());
});

test('setup: the token may be pasted with dashes and spaces', function (): void {
    $server = new TestServer();
    $token = implode('-', str_split(strtoupper($server->setupToken()), 4));
    $response = $server->post('setup', [
        'setupToken' => " $token ", 'username' => 'ada', 'authKey' => KEY_A, 'kdf' => kdf(),
        'wrappedKey' => envelope('w'), 'recoveryAuthKey' => KEY_R, 'recoveryWrappedKey' => envelope('r'),
    ]);
    assertSame(201, $response->status, $response->body);
});

test('setup: weak kdf records and malformed keys are rejected', function (): void {
    $server = new TestServer();
    $base = [
        'setupToken' => $server->setupToken(), 'username' => 'ada', 'authKey' => KEY_A, 'kdf' => kdf(),
        'wrappedKey' => envelope('w'), 'recoveryAuthKey' => KEY_R, 'recoveryWrappedKey' => envelope('r'),
    ];
    $bad = [
        ['kdf' => ['alg' => 'PBKDF2-SHA256', 'iterations' => 1000, 'salt' => 'c2FsdHNhbHRzYWx0c2FsdA']],
        ['kdf' => ['alg' => 'MD5', 'iterations' => 600000, 'salt' => 'c2FsdHNhbHRzYWx0c2FsdA']],
        ['kdf' => ['alg' => 'PBKDF2-SHA256', 'iterations' => 600000, 'salt' => 'short']],
        ['authKey' => 'tooshort'],
        ['username' => ''],
        ['username' => " ada"],
        ['username' => "ad\na"],
        ['wrappedKey' => '{"v":0,"plain":"x"}'],
    ];
    foreach ($bad as $change) {
        assertError(400, 'bad_request', $server->post('setup', $change + $base));
    }
});

test('setup: data folder inside the document root is reported', function (): void {
    $server = new TestServer();
    $request = new SilvaMentis\Http\Request(
        method: 'GET', query: ['route' => 'status'], headers: ['X-Silva-Mentis' => '1', 'Host' => 'localhost'],
        documentRoot: dirname($server->dataDir),
    );
    $status = $server->app->handle($request)->data();
    assertSame('/' . basename($server->dataDir), $status['setup']['dataPath']);
});

test('setup: an unwritable data folder fails closed', function (): void {
    $server = new TestServer();
    chmod($server->dataDir, 0500);
    $status = $server->get('status')->data();
    chmod($server->dataDir, 0700);
    assertSame(null, $status['setup']['tokenFile']);
    assertTrue(is_string($status['setup']['problem']));
});

test('login: params, success and wrong credentials', function (): void {
    $server = new TestServer();
    assertError(404, 'not_found', $server->get('login-params'));
    $server->register();
    $server->cookies = [];
    assertSame(kdf(), $server->get('login-params')->data()['kdf']);
    assertError(401, 'unauthorized', $server->login(KEY_B));
    assertError(401, 'unauthorized', $server->login(KEY_A, 'eve'));
    $response = $server->login();
    assertSame(200, $response->status);
    assertSame('ada', $response->data()['username']);
    assertSame(kdf(), $response->data()['kdf']);
    assertSame(envelope('wrapped'), $response->data()['wrappedKey']);
    assertTrue(isset($server->cookies['silva-mentis']));
});

test('login: sixth wrong attempt is rate limited, even with the right key', function (): void {
    $server = new TestServer();
    $server->register();
    for ($i = 0; $i < 5; $i++) {
        assertError(401, 'unauthorized', $server->login(KEY_B));
    }
    $response = $server->login();
    assertError(429, 'too_many_requests', $response);
    assertTrue(isset($response->headers['Retry-After']));
});

test('sessions: documents need a session; logout ends it', function (): void {
    $server = new TestServer();
    assertError(401, 'unauthorized', $server->get('documents'));
    $server->register();
    assertSame(200, $server->get('documents')->status);
    assertSame(['ok' => true], $server->post('logout')->data());
    assertSame([], $server->cookies);
    assertError(401, 'unauthorized', $server->get('documents'));
    assertError(401, 'unauthorized', $server->post('logout'));
});

test('sessions: a forged cookie is useless', function (): void {
    $server = new TestServer();
    $server->register();
    $server->cookies = ['silva-mentis' => str_repeat('A', 43)];
    assertError(401, 'unauthorized', $server->get('documents'));
});

test('sessions: idle and maximum lifetime', function (): void {
    $server = new TestServer();
    $server->register();
    $server->clock->advance(29 * 86_400);
    assertSame(200, $server->get('documents')->status);
    $server->clock->advance(29 * 86_400);
    assertSame(200, $server->get('documents')->status);
    $server->clock->advance(31 * 86_400);
    assertError(401, 'unauthorized', $server->get('documents'), 'idle for 31 days');

    $server->login();
    for ($i = 0; $i < 4; $i++) {
        $server->clock->advance(20 * 86_400);
        assertSame(200, $server->get('documents')->status);
    }
    $server->clock->advance(10 * 86_400);
    assertError(401, 'unauthorized', $server->get('documents'), 'older than 90 days');
});

test('sessions: HTTPS uses the __Host- cookie with Secure', function (): void {
    $server = new TestServer();
    $server->https = true;
    $cookie = $server->register()->cookies[0];
    assertTrue(str_starts_with($cookie, '__Host-silva-mentis='));
    assertTrue(str_contains($cookie, '; Secure'));
    assertTrue(str_contains($cookie, 'Path=/'));
    assertSame(200, $server->get('documents')->status);
});

test('password: change needs the current key and ends other sessions', function (): void {
    $server = new TestServer();
    $server->register();
    $other = $server->cookies;
    $server->cookies = [];
    $server->login();
    $change = ['authKey' => KEY_B, 'newAuthKey' => KEY_C, 'newKdf' => kdf('bmV3c2FsdG5ld3NhbHRuZXc'), 'newWrappedKey' => envelope('new')];
    assertError(401, 'unauthorized', $server->post('password', $change));
    $change['authKey'] = KEY_A;
    assertSame(['ok' => true], $server->post('password', $change)->data());
    assertSame(200, $server->get('documents')->status, 'this session stays');
    $mine = $server->cookies;
    $server->cookies = $other;
    assertError(401, 'unauthorized', $server->get('documents'), 'other session ended');
    $server->cookies = [];
    assertError(401, 'unauthorized', $server->login(KEY_A));
    $login = $server->login(KEY_C)->data();
    assertSame(envelope('new'), $login['wrappedKey']);
    assertSame('bmV3c2FsdG5ld3NhbHRuZXc', $login['kdf']['salt']);
});

test('recovery: recover and recover-finish replace both keys', function (): void {
    $server = new TestServer();
    $server->register();
    $server->cookies = [];
    assertError(401, 'unauthorized', $server->post('recover', ['username' => 'ada', 'recoveryAuthKey' => KEY_S]));
    $step1 = $server->post('recover', ['username' => 'ada', 'recoveryAuthKey' => KEY_R])->data();
    assertSame(envelope('recovery'), $step1['recoveryWrappedKey']);
    assertSame([], $server->cookies, 'step 1 does not log in');

    $finish = [
        'username' => 'ada', 'recoveryAuthKey' => KEY_R, 'newAuthKey' => KEY_B, 'newKdf' => kdf(),
        'newWrappedKey' => envelope('w2'), 'newRecoveryAuthKey' => KEY_S, 'newRecoveryWrappedKey' => envelope('r2'),
    ];
    $response = $server->post('recover-finish', $finish);
    assertSame(['username' => 'ada'], $response->data());
    assertSame(200, $server->get('documents')->status);
    assertError(401, 'unauthorized', $server->post('recover-finish', $finish), 'old recovery key is gone');
    $server->cookies = [];
    assertSame(envelope('w2'), $server->login(KEY_B)->data()['wrappedKey']);
    assertSame(envelope('r2'), $server->post('recover', ['username' => 'ada', 'recoveryAuthKey' => KEY_S])->data()['recoveryWrappedKey']);
});

test('recovery: recovery-key route replaces the recovery key', function (): void {
    $server = new TestServer();
    $server->register();
    $body = ['authKey' => KEY_B, 'recoveryAuthKey' => KEY_S, 'recoveryWrappedKey' => envelope('r3')];
    assertError(401, 'unauthorized', $server->post('recovery-key', $body));
    $body['authKey'] = KEY_A;
    assertSame(['ok' => true], $server->post('recovery-key', $body)->data());
    assertError(401, 'unauthorized', $server->post('recover', ['username' => 'ada', 'recoveryAuthKey' => KEY_R]));
    assertSame(200, $server->post('recover', ['username' => 'ada', 'recoveryAuthKey' => KEY_S])->status);
});

test('sessions-revoke: logs out every other device', function (): void {
    $server = new TestServer();
    $server->register();
    $first = $server->cookies;
    $server->cookies = [];
    $server->login();
    assertError(401, 'unauthorized', $server->post('sessions-revoke', ['authKey' => KEY_B]));
    assertSame(['ok' => true], $server->post('sessions-revoke', ['authKey' => KEY_A])->data());
    assertSame(200, $server->get('documents')->status);
    $server->cookies = $first;
    assertError(401, 'unauthorized', $server->get('documents'));
});

test('auth: test-only route does not exist in normal mode', function (): void {
    $server = new TestServer();
    $server->register();
    assertError(404, 'not_found', $server->post('test-reset'));
});
