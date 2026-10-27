<?php

declare(strict_types=1);

namespace SilvaMentis\Http;

/**
 * Maps a route name (the ?route= query value) and method to a handler. Every route also says
 * whether it needs a logged-in session; App enforces that before the handler runs.
 */
final class Router
{
    /** @var array<string, array{method: string, needsSession: bool, handler: callable(Request): Response}> */
    private array $routes = [];

    /** @param callable(Request): Response $handler */
    public function add(string $method, string $route, callable $handler, bool $needsSession = false): void
    {
        $this->routes[$route] = ['method' => $method, 'needsSession' => $needsSession, 'handler' => $handler];
    }

    public function has(string $route): bool
    {
        return isset($this->routes[$route]);
    }

    /**
     * Finds the route for a request.
     *
     * @return array{method: string, needsSession: bool, handler: callable(Request): Response}
     */
    public function match(Request $request): array
    {
        $name = $request->queryValue('route') ?? '';
        $route = $this->routes[$name] ?? null;
        if ($route === null) {
            throw HttpException::notFound('Unknown route.');
        }
        if ($route['method'] !== $request->method) {
            throw new HttpException(405, 'bad_request', "Use {$route['method']} for this route.", [], ['Allow' => $route['method']]);
        }
        return $route;
    }
}
