// An in-memory stand-in for the document routes of api.php, with the same version, sequence
// and conflict rules as src/Documents/DocumentRepository.php.

import { ApiError } from '../../public/js/data/api.js';

export class FakeServer {
  constructor() {
    this.documents = new Map();
    this.seq = 0;
    this.offline = false;
  }

  /** An Api-like client for one device. */
  client() {
    const server = this;
    const guard = () => {
      if (server.offline) throw new ApiError(0, 'network', 'offline');
    };
    return {
      async documents(since = 0) {
        guard();
        const documents = [...server.documents.values()]
          .filter((d) => d.seq > since && (since > 0 || !d.deleted))
          .sort((a, b) => a.seq - b.seq)
          .map((d) => ({ ...d }));
        return { documents, cursor: server.seq };
      },
      async saveDocument(id, payload, baseVersion) {
        guard();
        return server.write(id, payload, baseVersion, false);
      },
      async deleteDocument(id, baseVersion) {
        guard();
        return server.write(id, null, baseVersion, true);
      },
    };
  }

  write(id, payload, baseVersion, deleted) {
    const current = this.documents.get(id);
    if ((current?.version ?? 0) !== baseVersion || (deleted && !current)) {
      throw new ApiError(409, 'conflict', 'conflict', { error: 'conflict', current: current ? { ...current } : null });
    }
    this.seq += 1;
    const version = (current?.version ?? 0) + 1;
    this.documents.set(id, { id, payload, version, seq: this.seq, deleted });
    return { version, seq: this.seq };
  }
}

/** Timers that only fire when the test says so. */
export class ManualTimers {
  constructor() {
    this.pending = new Map();
    this.next = 1;
    this.set = (callback, delay) => {
      const id = this.next++;
      this.pending.set(id, { callback, delay });
      return id;
    };
    this.clear = (id) => this.pending.delete(id);
  }

  /** Runs every pending timer once. */
  async runAll() {
    const due = [...this.pending.values()];
    this.pending.clear();
    for (const timer of due) timer.callback();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  delays() {
    return [...this.pending.values()].map((timer) => timer.delay);
  }
}
