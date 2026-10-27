// The HTTP client for public/api.php. Every call sends the X-Silva-Mentis header (the server's
// CSRF protection) and turns error responses into ApiError.

export class ApiError extends Error {
  /**
   * @param {number} status HTTP status, 0 when the server could not be reached
   * @param {string} code error code from the server, or 'network'
   * @param {string} message
   * @param {object} [body] the full error response
   */
  constructor(status, code, message, body = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }

  get isNetworkError() {
    return this.status === 0;
  }
}

export class Api {
  /**
   * @param {string} [endpoint='api.php'] URL of api.php, relative to the page
   * @param {typeof fetch} [fetchImpl] replaced in tests
   */
  constructor(endpoint = 'api.php', fetchImpl = (...args) => fetch(...args)) {
    this.endpoint = endpoint;
    this.fetch = fetchImpl;
    /** Called with the ApiError whenever the server says the session is gone. */
    this.onUnauthorized = null;
  }

  /**
   * @param {'GET'|'POST'} method
   * @param {string} route
   * @param {{query?: Record<string, string|number>, body?: object}} [options]
   * @returns {Promise<any>} the decoded JSON response
   */
  async request(method, route, { query = {}, body } = {}) {
    const params = new URLSearchParams({ route, ...Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])) });
    let response;
    try {
      response = await this.fetch(`${this.endpoint}?${params}`, {
        method,
        headers: { 'X-Silva-Mentis': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } catch {
      throw new ApiError(0, 'network', 'The server could not be reached. Check your connection.');
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new ApiError(response.status, 'server_error', `The server sent an unexpected answer (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      const error = new ApiError(response.status, data.error ?? 'server_error', data.message ?? 'Something went wrong.', data);
      if (response.status === 401 && this.onUnauthorized) this.onUnauthorized(error);
      throw error;
    }
    return data;
  }

  status() { return this.request('GET', 'status'); }
  setup(body) { return this.request('POST', 'setup', { body }); }
  loginParams() { return this.request('GET', 'login-params'); }
  login(username, authKey) { return this.request('POST', 'login', { body: { username, authKey } }); }
  logout() { return this.request('POST', 'logout'); }
  changePassword(body) { return this.request('POST', 'password', { body }); }
  replaceRecoveryKey(body) { return this.request('POST', 'recovery-key', { body }); }
  recover(username, recoveryAuthKey) { return this.request('POST', 'recover', { body: { username, recoveryAuthKey } }); }
  recoverFinish(body) { return this.request('POST', 'recover-finish', { body }); }
  revokeOtherSessions(authKey) { return this.request('POST', 'sessions-revoke', { body: { authKey } }); }
  documents(since = 0) { return this.request('GET', 'documents', { query: { since } }); }
  saveDocument(id, payload, baseVersion) { return this.request('POST', 'document-save', { body: { id, payload, baseVersion } }); }
  deleteDocument(id, baseVersion) { return this.request('POST', 'document-delete', { body: { id, baseVersion } }); }
  testReset() { return this.request('POST', 'test-reset'); }
}
