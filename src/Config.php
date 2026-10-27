<?php

declare(strict_types=1);

namespace SilvaMentis;

/**
 * Immutable installation settings. Read once from config/config.php (optional) and the
 * environment; environment variables win. config/config.example.php lists every key.
 */
final class Config
{
    public const MODE_NORMAL = 'normal';
    public const MODE_TEST = 'test';

    /**
     * @param list<string> $trustedProxies
     * @param list<string> $allowedHosts
     */
    public function __construct(
        public readonly string $mode,
        public readonly string $dataDir,
        public readonly int $sessionIdleDays = 30,
        public readonly int $sessionMaxDays = 90,
        public readonly int $maxDocumentBytes = 4_000_000,
        public readonly array $trustedProxies = [],
        public readonly bool $testModeAllowRemote = false,
        public readonly array $allowedHosts = [],
    ) {
    }

    /**
     * Loads the configuration for the project in $rootDir.
     *
     * @param array<string, string>|null $environment defaults to getenv()
     */
    public static function load(string $rootDir, ?array $environment = null): self
    {
        $environment ??= getenv();
        $file = $rootDir . '/config/config.php';
        $values = is_file($file) ? require $file : [];
        if (!is_array($values)) {
            throw new \RuntimeException('config/config.php must return an array.');
        }
        if (isset($environment['SILVA_MENTIS_MODE'])) {
            $values['mode'] = $environment['SILVA_MENTIS_MODE'];
        }
        if (isset($environment['SILVA_MENTIS_DATA_DIR']) && $environment['SILVA_MENTIS_DATA_DIR'] !== '') {
            $values['data_dir'] = $environment['SILVA_MENTIS_DATA_DIR'];
        }
        if (isset($environment['SILVA_MENTIS_TRUSTED_PROXIES']) && trim($environment['SILVA_MENTIS_TRUSTED_PROXIES']) !== '') {
            // Comma-separated addresses or networks, e.g. "172.16.0.0/12,10.0.0.0/8" (Docker).
            $values['trusted_proxies'] = array_values(array_filter(array_map('trim', explode(',', $environment['SILVA_MENTIS_TRUSTED_PROXIES']))));
        }
        return self::fromArray($values, $rootDir);
    }

    /**
     * Builds a configuration from the keys of config.example.php, filling in defaults.
     *
     * @param array<string, mixed> $values
     */
    public static function fromArray(array $values, string $rootDir): self
    {
        return new self(
            mode: self::parseMode($values['mode'] ?? null),
            dataDir: rtrim((string) ($values['data_dir'] ?? $rootDir . '/data'), '/'),
            sessionIdleDays: max(1, (int) ($values['session_idle_days'] ?? 30)),
            sessionMaxDays: max(1, (int) ($values['session_max_days'] ?? 90)),
            maxDocumentBytes: max(1024, (int) ($values['max_document_bytes'] ?? 4_000_000)),
            trustedProxies: array_values(array_map('strval', (array) ($values['trusted_proxies'] ?? []))),
            testModeAllowRemote: ($values['test_mode_allow_remote'] ?? false) === true,
            allowedHosts: array_values(array_map('strtolower', array_map('strval', (array) ($values['allowed_hosts'] ?? [])))),
        );
    }

    /** Only the exact string "test" enables the test version; anything else is the normal app. */
    public static function parseMode(mixed $value): string
    {
        return $value === self::MODE_TEST ? self::MODE_TEST : self::MODE_NORMAL;
    }

    public function isTestMode(): bool
    {
        return $this->mode === self::MODE_TEST;
    }

    /** Each mode has its own database file, so the test version can never touch real notes. */
    public function databasePath(): string
    {
        $file = $this->isTestMode() ? 'silva-mentis-test.sqlite' : 'silva-mentis.sqlite';
        return $this->dataDir . '/' . $file;
    }
}
