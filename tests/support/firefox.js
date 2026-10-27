// A minimal WebDriver BiDi client for headless Firefox, using Node's built-in WebSocket.
// Enough to load pages, run scripts, type and click, and take screenshots.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { freePort, TMP } from './server.js';

export function findFirefox() {
  if (process.env.FIREFOX) return process.env.FIREFOX;
  for (const candidate of ['/usr/bin/firefox', '/usr/bin/firefox-esr', '/Applications/Firefox.app/Contents/MacOS/firefox']) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export class Firefox {
  static async launch({ width = 1280, height = 900 } = {}) {
    const binary = findFirefox();
    if (!binary) throw new Error('Firefox not found (set FIREFOX=/path/to/firefox)');
    const port = await freePort();
    const profile = mkdtempSync(join(TMP, 'firefox-'));
    // Quiet, fast, local-only profile.
    writeFileSync(join(profile, 'user.js'), [
      'user_pref("browser.shell.checkDefaultBrowser", false);',
      'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
      'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
      'user_pref("browser.startup.homepage_override.mstone", "ignore");',
      'user_pref("app.update.enabled", false);',
      'user_pref("network.proxy.type", 0);',
      'user_pref("dom.disable_beforeunload", true);',
      'user_pref("ui.prefersReducedMotion", 1);',
    ].join('\n'));
    const child = spawn(binary, ['--headless', '--no-remote', '--profile', profile, `--remote-debugging-port=${port}`, `--width=${width}`, `--height=${height}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, MOZ_HEADLESS: '1', HOME: profile, XDG_CACHE_HOME: join(profile, 'cache') },
    });
    let log = '';
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Firefox did not start:\n${log}`)), 30000);
      const onData = (chunk) => {
        log += chunk;
        if (log.includes('WebDriver BiDi listening')) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stderr.on('data', onData);
      child.stdout.on('data', onData);
      child.once('exit', () => reject(new Error(`Firefox exited:\n${log}`)));
    });
    const browser = new Firefox(child, profile);
    await browser.connect(`ws://127.0.0.1:${port}/session`);
    return browser;
  }

  constructor(child, profile) {
    this.child = child;
    this.profile = profile;
    this.nextId = 1;
    this.pending = new Map();
    this.consoleMessages = [];
  }

  async connect(url) {
    this.socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = () => reject(new Error('BiDi connection failed'));
    });
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.type === 'error') reject(new Error(`${message.error}: ${message.message}`));
        else resolve(message.result);
      } else if (message.method === 'log.entryAdded') {
        this.consoleMessages.push(`${message.params.level}: ${message.params.text}`);
      }
    };
    await this.send('session.new', { capabilities: { alwaysMatch: { acceptInsecureCerts: true, unhandledPromptBehavior: { default: 'dismiss' } } } });
    await this.send('session.subscribe', { events: ['log.entryAdded'] });
    const tree = await this.send('browsingContext.getTree', {});
    this.context = tree.contexts[0].context;
  }

  send(method, params) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async goto(url) {
    await this.send('browsingContext.navigate', { context: this.context, url, wait: 'complete' });
  }

  /**
   * Runs a function in the page and returns its (JSON-serialisable) result.
   * @param {string|Function} fn function source or function; called with `args`
   */
  async eval(fn, ...args) {
    const source = typeof fn === 'function' ? fn.toString() : fn;
    const result = await this.send('script.callFunction', {
      functionDeclaration: `async (...raw) => JSON.stringify(await (${source})(...raw.map((value) => JSON.parse(value))))`,
      arguments: args.map((value) => ({ type: 'string', value: JSON.stringify(value) })),
      target: { context: this.context },
      awaitPromise: true,
      resultOwnership: 'none',
    });
    if (result.type === 'exception') throw new Error(`Page error: ${result.exceptionDetails.text}`);
    const value = result.result.value;
    return value === undefined ? undefined : JSON.parse(value);
  }

  /** Waits until fn() returns something truthy in the page. */
  async waitFor(fn, { timeout = 10000, message = 'condition' } = {}, ...args) {
    const start = Date.now();
    for (;;) {
      const value = await this.eval(fn, ...args);
      if (value) return value;
      if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${message}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** Clicks the centre of the first element matching a selector (real pointer events). */
  async click(selector, { shift = false } = {}) {
    const box = await this.eval((s) => {
      const element = document.querySelector(s);
      if (!element) return null;
      element.scrollIntoView({ block: 'center' });
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.left + Math.min(rect.width / 2, 20)), y: Math.round(rect.top + rect.height / 2) };
    }, selector);
    if (!box) throw new Error(`No element ${selector}`);
    const keyDown = shift ? [{ type: 'keyDown', value: '\uE008' }] : [];
    const keyUp = shift ? [{ type: 'keyUp', value: '\uE008' }] : [];
    await this.send('input.performActions', {
      context: this.context,
      actions: [
        { type: 'key', id: 'keyboard', actions: [...keyDown, { type: 'pause', duration: 0 }, { type: 'pause', duration: 0 }, { type: 'pause', duration: 0 }, ...keyUp] },
        { type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
          { type: 'pause', duration: 0 },
          { type: 'pointerMove', x: box.x, y: box.y },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerUp', button: 0 },
        ] },
      ],
    });
    await this.send('input.releaseActions', { context: this.context });
  }

  /**
   * Types text with real key events. Special keys: '\uE007' Enter, '\uE004' Tab, '\uE003'
   * Backspace, '\uE00C' Escape, '\uE013' ArrowUp, '\uE015' ArrowDown.
   * @param {string} text
   * @param {{modifiers?: string[]}} [options] e.g. ['\uE009'] (Control), ['\uE008'] (Shift)
   */
  async type(text, { modifiers = [] } = {}) {
    const actions = [];
    for (const modifier of modifiers) actions.push({ type: 'keyDown', value: modifier });
    for (const char of text) actions.push({ type: 'keyDown', value: char }, { type: 'keyUp', value: char });
    for (const modifier of [...modifiers].reverse()) actions.push({ type: 'keyUp', value: modifier });
    await this.send('input.performActions', { context: this.context, actions: [{ type: 'key', id: 'keyboard', actions }] });
    await this.send('input.releaseActions', { context: this.context });
  }

  /** Drags with a real pointer from one element to a point relative to another element. */
  async drag(fromSelector, toSelector, { dx = 0, dyRatio = 0.75 } = {}) {
    const points = await this.eval((from, to, offsetX, ratio) => {
      const a = document.querySelector(from)?.getBoundingClientRect();
      const b = document.querySelector(to)?.getBoundingClientRect();
      if (!a || !b) return null;
      return {
        from: { x: Math.round(a.left + a.width / 2), y: Math.round(a.top + a.height / 2) },
        to: { x: Math.round(b.left + 10 + offsetX), y: Math.round(b.top + b.height * ratio) },
      };
    }, fromSelector, toSelector, dx, dyRatio);
    if (!points) throw new Error(`Cannot drag ${fromSelector} to ${toSelector}`);
    const steps = [];
    for (let i = 1; i <= 8; i += 1) {
      steps.push({ type: 'pointerMove', duration: 20, x: Math.round(points.from.x + ((points.to.x - points.from.x) * i) / 8), y: Math.round(points.from.y + ((points.to.y - points.from.y) * i) / 8) });
    }
    await this.send('input.performActions', {
      context: this.context,
      actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
        { type: 'pointerMove', x: points.from.x, y: points.from.y },
        { type: 'pointerDown', button: 0 },
        ...steps,
        { type: 'pointerUp', button: 0 },
      ] }],
    });
    await this.send('input.releaseActions', { context: this.context });
  }

  async screenshot(path) {
    const { data } = await this.send('browsingContext.captureScreenshot', { context: this.context, origin: 'document' });
    writeFileSync(path, Buffer.from(data, 'base64'));
  }

  async setViewport(width, height) {
    await this.send('browsingContext.setViewport', { context: this.context, viewport: { width, height } });
  }

  async close() {
    try {
      await this.send('session.end', {});
    } catch {
      // already gone
    }
    this.socket?.close();
    this.child.kill();
    await new Promise((r) => this.child.once('exit', r));
    rmSync(this.profile, { recursive: true, force: true });
  }
}

export const KEYS = {
  enter: '\uE007', tab: '\uE004', backspace: '\uE003', escape: '\uE00C', up: '\uE013', down: '\uE015',
  left: '\uE012', right: '\uE014', home: '\uE011', end: '\uE010', shift: '\uE008', control: '\uE009',
  alt: '\uE00A', delete: '\uE017',
};
