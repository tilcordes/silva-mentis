<?php

declare(strict_types=1);

// Configuration loading and mode parsing.

use SilvaMentis\Config;
use function Tests\{assertSame, assertTrue, assertFalse, temporaryFolder, test};

test('config: only the exact string "test" enables test mode', function (): void {
    assertSame('test', Config::parseMode('test'));
    foreach (['TEST', ' test', 'test ', '1', true, null, 'normal', 'debug'] as $value) {
        assertSame('normal', Config::parseMode($value), var_export($value, true));
    }
});

test('config: defaults without a config file', function (): void {
    $root = temporaryFolder();
    $config = Config::load($root, []);
    assertSame('normal', $config->mode);
    assertSame($root . '/data', $config->dataDir);
    assertSame(30, $config->sessionIdleDays);
    assertSame(90, $config->sessionMaxDays);
    assertSame(4_000_000, $config->maxDocumentBytes);
    assertSame($root . '/data/silva-mentis.sqlite', $config->databasePath());
});

test('config: environment overrides the config file', function (): void {
    $root = temporaryFolder();
    mkdir($root . '/config');
    file_put_contents($root . '/config/config.php', "<?php return ['mode' => 'normal', 'session_idle_days' => 7];");
    $config = Config::load($root, ['SILVA_MENTIS_MODE' => 'test', 'SILVA_MENTIS_DATA_DIR' => '/srv/notes/']);
    assertTrue($config->isTestMode());
    assertSame(7, $config->sessionIdleDays);
    assertSame('/srv/notes', $config->dataDir);
    assertSame('/srv/notes/silva-mentis-test.sqlite', $config->databasePath());
    @unlink($root . '/config/config.php');
    @rmdir($root . '/config');
});

test('config: trusted proxies from the environment', function (): void {
    $config = Config::load(temporaryFolder(), ['SILVA_MENTIS_TRUSTED_PROXIES' => ' 172.16.0.0/12, 10.0.0.1 ,']);
    assertSame(['172.16.0.0/12', '10.0.0.1'], $config->trustedProxies);
});

test('config: test_mode_allow_remote must be literally true', function (): void {
    assertFalse(Config::fromArray(['test_mode_allow_remote' => 'yes'], '/x')->testModeAllowRemote);
    assertTrue(Config::fromArray(['test_mode_allow_remote' => true], '/x')->testModeAllowRemote);
});
