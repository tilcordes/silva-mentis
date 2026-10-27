<?php

declare(strict_types=1);

namespace SilvaMentis\Security;

use SilvaMentis\Http\Request;

/**
 * Who is asking, and over which scheme. Proxy headers (X-Forwarded-For, X-Forwarded-Proto) are
 * believed only when the direct peer is one of the configured trusted proxies (addresses or
 * networks); otherwise anyone could fake their address to dodge the rate limiter.
 */
final class ClientAddress
{
    /** @param list<string> $trustedProxies */
    public function __construct(private readonly array $trustedProxies = [])
    {
    }

    public function ip(Request $request): string
    {
        $peer = $request->remoteAddr;
        if (!$this->isTrusted($peer)) {
            return $peer;
        }
        // Walk the chain from the nearest hop; the first untrusted address is the client.
        $chain = array_reverse(array_map('trim', explode(',', $request->header('x-forwarded-for') ?? '')));
        foreach ($chain as $hop) {
            if (filter_var($hop, FILTER_VALIDATE_IP) === false) {
                break;
            }
            if (!$this->isTrusted($hop)) {
                return $hop;
            }
        }
        return $peer;
    }

    public function isHttps(Request $request): bool
    {
        if ($request->https) {
            return true;
        }
        return $this->isTrusted($request->remoteAddr)
            && strtolower(trim($request->header('x-forwarded-proto') ?? '')) === 'https';
    }

    /**
     * The key failures are counted under: the IPv4 address, or the /64 network of an IPv6
     * address (one household or server usually owns a whole /64).
     */
    public static function networkKey(string $ip): string
    {
        $packed = @inet_pton($ip);
        if ($packed === false) {
            return 'unknown';
        }
        if (strlen($packed) === 4) {
            return $ip;
        }
        if (str_starts_with($packed, str_repeat("\0", 10) . "\xff\xff")) {
            return (string) inet_ntop(substr($packed, 12)); // IPv4-mapped IPv6
        }
        return bin2hex(substr($packed, 0, 8)) . '::/64';
    }

    public static function isLoopback(string $ip): bool
    {
        $packed = @inet_pton($ip);
        if ($packed === false) {
            return false;
        }
        if (strlen($packed) === 4) {
            return $packed[0] === "\x7f";
        }
        return $packed === str_repeat("\0", 15) . "\x01"
            || (str_starts_with($packed, str_repeat("\0", 10) . "\xff\xff") && $packed[12] === "\x7f");
    }

    private function isTrusted(string $ip): bool
    {
        foreach ($this->trustedProxies as $entry) {
            if ($ip !== '' && self::matches($ip, $entry)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Whether an address equals $entry or lies in it, when $entry is a network such as
     * "172.16.0.0/12" or "fd00::/8" (a container network whose addresses change).
     */
    public static function matches(string $ip, string $entry): bool
    {
        [$network, $bits] = array_pad(explode('/', trim($entry), 2), 2, null);
        $address = @inet_pton($ip);
        $base = @inet_pton($network);
        if ($address === false || $base === false || strlen($address) !== strlen($base)) {
            return false;
        }
        $length = strlen($address) * 8;
        $bits = $bits === null ? $length : (int) $bits;
        if ($bits < 0 || $bits > $length) {
            return false;
        }
        $wholeBytes = intdiv($bits, 8);
        if (substr($address, 0, $wholeBytes) !== substr($base, 0, $wholeBytes)) {
            return false;
        }
        $rest = $bits % 8;
        if ($rest === 0) {
            return true;
        }
        $mask = (0xff << (8 - $rest)) & 0xff;
        return (ord($address[$wholeBytes]) & $mask) === (ord($base[$wholeBytes]) & $mask);
    }
}
