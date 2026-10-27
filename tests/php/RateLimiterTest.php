<?php

declare(strict_types=1);

// Rate limiting of credential checks.

use SilvaMentis\Clock;
use SilvaMentis\Database;
use SilvaMentis\Http\HttpException;
use SilvaMentis\Security\RateLimiter;
use function Tests\{assertSame, assertThrows, test};

function limiter(): array
{
    $clock = Clock::fixed(1_000_000);
    return [new RateLimiter(Database::open(':memory:'), $clock), $clock];
}

test('rate limit: five failures per client, then wait out the 15 minute window', function (): void {
    [$limiter, $clock] = limiter();
    for ($i = 0; $i < 5; $i++) {
        $limiter->check('198.51.100.1');
        $limiter->recordFailure('198.51.100.1');
        $clock->advance(10);
    }
    $error = assertThrows(HttpException::class, fn () => $limiter->check('198.51.100.1'));
    assertSame(429, $error->status);
    assertSame('too_many_requests', $error->errorCode);
    assertSame(15 * 60 - 50, $error->extra['retryAfter']);
    assertSame((string) (15 * 60 - 50), $error->headers['Retry-After']);
    $limiter->check('198.51.100.2'); // another client is not affected
    $clock->advance(15 * 60);
    $limiter->check('198.51.100.1');
});

test('rate limit: global slow-down after 10 failures doubles from 30 s', function (): void {
    [$limiter, $clock] = limiter();
    for ($i = 0; $i < 10; $i++) {
        $limiter->recordFailure("203.0.113.$i");
    }
    $error = assertThrows(HttpException::class, fn () => $limiter->check('192.0.2.200'));
    assertSame(30, $error->extra['retryAfter']);
    $clock->advance(30);
    $limiter->check('192.0.2.200');
    $limiter->recordFailure('192.0.2.201');
    $error = assertThrows(HttpException::class, fn () => $limiter->check('192.0.2.202'));
    assertSame(60, $error->extra['retryAfter']);
});

test('rate limit: global delay is capped at 15 minutes', function (): void {
    [$limiter] = limiter();
    for ($i = 0; $i < 40; $i++) {
        $limiter->recordFailure("client-$i");
    }
    $error = assertThrows(HttpException::class, fn () => $limiter->check('someone'));
    assertSame(900, $error->extra['retryAfter']);
});

test('rate limit: a success resets the global counter', function (): void {
    [$limiter] = limiter();
    for ($i = 0; $i < 10; $i++) {
        $limiter->recordFailure("client-$i");
    }
    $limiter->recordSuccess('owner');
    $limiter->check('someone');
});
