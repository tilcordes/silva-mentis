// Navigation through the URL fragment: #/daily, #/p/<page id>, #/pages, #/graph, #/settings.
// Page ids are random, so the address bar and history never contain a title.

/**
 * @typedef {{name: 'daily'|'page'|'pages'|'graph'|'settings', pageId?: string}} Route
 */

/**
 * @param {string} hash e.g. "#/p/p7k2…"
 * @returns {Route}
 */
export function parseRoute(hash) {
  const path = hash.replace(/^#\/?/, '');
  const [name, id] = path.split('/');
  if (name === 'p' && id && /^[A-Za-z0-9_-]{1,64}$/.test(id)) return { name: 'page', pageId: id };
  if (name === 'pages' || name === 'graph' || name === 'settings') return { name };
  return { name: 'daily' };
}

/** @param {Route} route */
export function routeHash(route) {
  return route.name === 'page' ? `#/p/${route.pageId}` : `#/${route.name}`;
}

export class Router {
  /** @param {(route: Route) => void} onChange */
  constructor(onChange) {
    this.onChange = onChange;
    this.listener = () => this.onChange(this.current());
    window.addEventListener('hashchange', this.listener);
  }

  current() {
    return parseRoute(window.location.hash);
  }

  /** @param {Route} route */
  go(route) {
    const hash = routeHash(route);
    if (window.location.hash === hash) this.onChange(route);
    else window.location.hash = hash;
  }

  destroy() {
    window.removeEventListener('hashchange', this.listener);
  }
}
