<?php

declare(strict_types=1);

namespace SilvaMentis;

/**
 * The current time in Unix seconds. Sessions and the rate limiter ask the clock instead of
 * calling time() so tests can move time forward.
 */
final class Clock
{
    private function __construct(private ?int $fixed)
    {
    }

    public static function system(): self
    {
        return new self(null);
    }

    /** A clock that stands still at $timestamp until advance() is called (tests only). */
    public static function fixed(int $timestamp): self
    {
        return new self($timestamp);
    }

    public function now(): int
    {
        return $this->fixed ?? time();
    }

    public function advance(int $seconds): void
    {
        if ($this->fixed === null) {
            throw new \LogicException('Only a fixed clock can be advanced.');
        }
        $this->fixed += $seconds;
    }
}
