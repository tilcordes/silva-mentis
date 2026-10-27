<?php

declare(strict_types=1);

namespace SilvaMentis\Auth;

/**
 * The one-time token that proves the person registering has access to the server's files
 * (the file data/setup-token-….txt). Without it, whoever finds a fresh installation first could
 * claim it.
 */
final class SetupToken
{
    private const PATTERN = 'setup-token-*.txt';

    /** @param (callable(string): void)|null $announce called with a message when a token is created */
    public function __construct(private readonly string $dataDir, private $announce = null)
    {
    }

    /**
     * Makes sure a token file exists and returns its file name. Fails closed: if the file can't
     * be written, nobody can register.
     */
    public function ensure(): string
    {
        $existing = $this->path();
        if ($existing !== null) {
            return basename($existing);
        }
        if (!is_dir($this->dataDir) || !is_writable($this->dataDir)) {
            throw new \RuntimeException('The data folder is not writable, so no setup token can be created.');
        }
        // A random file name keeps the token unguessable even on a server that exposes data/.
        $name = 'setup-token-' . bin2hex(random_bytes(4)) . '.txt';
        $token = bin2hex(random_bytes(16));
        $file = $this->dataDir . '/' . $name;
        $handle = @fopen($file, 'x');
        if ($handle === false) {
            throw new \RuntimeException('The setup token file could not be created.');
        }
        chmod($file, 0600);
        fwrite($handle, $token . "\n");
        fclose($handle);
        if ($this->announce !== null) {
            ($this->announce)("silva-mentis setup token: $token  (also in data/$name)");
        }
        return $name;
    }

    /** The current token, or null if there is none. */
    public function read(): ?string
    {
        $file = $this->path();
        if ($file === null) {
            return null;
        }
        $token = trim((string) @file_get_contents($file));
        return preg_match('/^[0-9a-f]{32}$/', $token) === 1 ? $token : null;
    }

    public function verify(string $candidate): bool
    {
        $token = $this->read();
        return $token !== null && hash_equals($token, $candidate);
    }

    public function delete(): void
    {
        foreach (glob($this->dataDir . '/' . self::PATTERN) ?: [] as $file) {
            @unlink($file);
        }
    }

    private function path(): ?string
    {
        $files = glob($this->dataDir . '/' . self::PATTERN) ?: [];
        return $files[0] ?? null;
    }
}
