/**
 * Observability Service for DSH Fleet Cleaner (Phase 1: Read-Only).
 *
 * Implements:
 * 1. True Operator & Session Authentication:
 *    - Async/sync session validator contract with boolean-true requirement.
 *    - Strict rejection of fictitious bearer tokens and arbitrary cookies.
 *    - Fails closed when no verifier or matching operator token is present.
 * 2. Single-flight collection: concurrent calls share one in-flight promise.
 * 3. Lifecycle disposal: dispose() immediately rejects waiting in-flight calls with
 *    LifecycleDisposedError, while continuing to track and safely drain the background read.
 * 4. Separation of fromCache vs stale:
 *    - Within TTL: fromCache: true, stale: false.
 *    - Fallback on error after TTL: fromCache: true, stale: true.
 *    - Live measurement: fromCache: false, stale: false.
 *    - sampledAt is strictly preserved from original measurement time.
 */

import os from 'node:os';
import fs from 'node:fs';

export class LifecycleDisposedError extends Error {
  constructor(message = 'ObservabilityService is disposed.') {
    super(`dsh-fleet-cleaner [LifecycleDisposed]: ${message}`);
    this.name = 'LifecycleDisposedError';
  }
}

export class ObservabilityService {
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this.ttlMs = options.ttlMs ?? 15000;
    this.operatorTokens = new Set(options.operatorTokens || (options.operatorToken ? [options.operatorToken] : []));
    this.validateSession = typeof options.validateSession === 'function' ? options.validateSession : null;

    this.cachedSnapshot = null;
    this.cachedAt = 0;
    this.inFlightPromise = null;
    this.activeAbortController = null;
    this.ongoingBackendReadPromise = null;
    this.disposed = false;
  }

  /**
   * Dispose service: immediately cancels active collection, rejects waiting callers,
   * and tracks background read completion.
   */
  dispose() {
    this.disposed = true;
    this.cachedSnapshot = null;
    if (this.activeAbortController) {
      this.activeAbortController.abort(new LifecycleDisposedError());
      this.activeAbortController = null;
    }
  }

  /**
   * Await in-flight background read drain if active.
   */
  async drainBackendRead() {
    if (this.ongoingBackendReadPromise) {
      try {
        await this.ongoingBackendReadPromise;
      } catch {}
    }
  }

  /**
   * Get metric snapshot with single-flight coalescing and immediate cancellation on dispose.
   *
   * @param {boolean} [force] - bypass cache
   * @returns {Promise<object>}
   */
  async getSnapshot(force = false) {
    if (this.disposed) {
      throw new LifecycleDisposedError();
    }

    const now = Date.now();

    // Cache hit within TTL: fresh fromCache reading
    if (!force && this.cachedSnapshot && (now - this.cachedAt < this.ttlMs)) {
      return {
        ...this.cachedSnapshot,
        fromCache: true,
        stale: false,
        cachedAgeMs: now - this.cachedAt,
      };
    }

    // Single-flight coalescing: reuse active collection promise
    if (this.inFlightPromise !== null) {
      return this.inFlightPromise;
    }

    const abortController = new AbortController();
    this.activeAbortController = abortController;

    const task = (async () => {
      const backendRead = Promise.resolve(this._collectMetrics(abortController.signal));

      // Tracking chain: suppressed error handling prevents unhandled rejection leaks
      const trackingPromise = backendRead.then(() => {}, () => {}).finally(() => {
        if (this.ongoingBackendReadPromise === trackingPromise) {
          this.ongoingBackendReadPromise = null;
        }
      });
      this.ongoingBackendReadPromise = trackingPromise;

      // Immediate abort notification promise
      const onDisposeOrAbort = new Promise((_, reject) => {
        if (abortController.signal.aborted) {
          reject(abortController.signal.reason || new LifecycleDisposedError());
        } else {
          abortController.signal.addEventListener('abort', () => {
            reject(abortController.signal.reason || new LifecycleDisposedError());
          }, { once: true });
        }
      });

      const freshSnapshot = await Promise.race([backendRead, onDisposeOrAbort]);

      if (this.disposed) {
        throw new LifecycleDisposedError();
      }

      this.cachedSnapshot = freshSnapshot;
      this.cachedAt = now;

      return {
        ...freshSnapshot,
        fromCache: false,
        stale: false,
        cachedAgeMs: 0,
      };
    })().catch(err => {
      if (this.disposed) throw err;

      // Fallback: if collection fails but an expired cached snapshot exists, return it as stale: true
      if (this.cachedSnapshot) {
        return {
          ...this.cachedSnapshot,
          fromCache: true,
          stale: true,
          cachedAgeMs: Date.now() - this.cachedAt,
          collectionError: err.message,
        };
      }
      throw err;
    }).finally(() => {
      if (this.inFlightPromise === task) {
        this.inFlightPromise = null;
      }
      if (this.activeAbortController === abortController) {
        this.activeAbortController = null;
      }
    });

    this.inFlightPromise = task;
    return task;
  }

  async _collectMetrics(signal) {
    signal?.throwIfAborted?.();

    if (this.ctx._testShouldFail) {
      throw new Error('Storage collection failed');
    }

    const sampledAt = Date.now();

    // 1. Process Memory (exact bytes)
    const memUsage = process.memoryUsage();
    const memory = {
      rssBytes: memUsage.rss,
      nodeHeapUsedBytes: memUsage.heapUsed,
      nodeHeapTotalBytes: memUsage.heapTotal,
      externalBytes: memUsage.external,
      arrayBuffersBytes: memUsage.arrayBuffers,
    };

    signal?.throwIfAborted?.();

    // 2. OS Memory
    let memAvailableBytes = null;
    let memFreeBytes = os.freemem();
    const memTotalBytes = os.totalmem();

    try {
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      for (const line of meminfo.split('\n')) {
        if (line.startsWith('MemAvailable:')) {
          const parts = line.split(/\s+/);
          if (parts[1]) memAvailableBytes = parseInt(parts[1], 10) * 1024;
          break;
        }
      }
    } catch {
      // Non-Linux or restricted
    }

    signal?.throwIfAborted?.();

    // 3. CGroup v2 Metrics
    const cgroup = this._readCgroupV2();

    // 4. Session Corpus Snapshot
    const sessions = await this._countSessions(signal);

    signal?.throwIfAborted?.();

    // 5. Browser Fleet Snapshot
    const browsers = await this._countBrowsers();

    return {
      sampledAt,
      memory: {
        ...memory,
        memAvailableBytes,
        memFreeBytes,
        memTotalBytes,
      },
      cgroup,
      sessions,
      browsers,
    };
  }

  _readCgroupV2() {
    const base = '/sys/fs/cgroup/system.slice/dsh-web.service';
    const readInt = (name) => {
      try {
        const val = fs.readFileSync(`${base}/${name}`, 'utf8').trim();
        if (val === 'max') return null;
        const num = parseInt(val, 10);
        return Number.isFinite(num) ? num : null;
      } catch {
        return null;
      }
    };

    return {
      currentBytes: readInt('memory.current'),
      peakBytes: readInt('memory.peak'),
      highBytes: readInt('memory.high'),
      maxBytes: readInt('memory.max'),
    };
  }

  async _countSessions(signal) {
    try {
      if (this.ctx.sessionQuery?.listSessions) {
        const list = await this.ctx.sessionQuery.listSessions(signal);
        let roots = 0;
        let runningSub = 0;
        let dormantSub = 0;
        let unknown = 0;

        const agents = typeof this.ctx.get === 'function' ? this.ctx.get('agents') : this.ctx.agents;
        for (const s of list) {
          const header = s.header;
          if (header.version === 0) {
            unknown++;
          } else if (header.origin === 'subagent') {
            const isLiveRunning = Boolean(agents?.get(header.id)?.status === 'running') || Boolean(s.live && s.running);
            if (isLiveRunning) runningSub++;
            else dormantSub++;
          } else {
            roots++;
          }
        }

        return {
          totalCount: list.length,
          userChatSessions: roots,
          runningSubagents: runningSub,
          dormantSubagents: dormantSub,
          unknownRecords: unknown,
          status: 'available',
        };
      }
    } catch (err) {
      return {
        totalCount: null,
        userChatSessions: null,
        runningSubagents: null,
        dormantSubagents: null,
        unknownRecords: null,
        status: 'unavailable',
        error: err.message,
      };
    }

    return {
      totalCount: null,
      userChatSessions: null,
      runningSubagents: null,
      dormantSubagents: null,
      unknownRecords: null,
      status: 'unavailable',
      error: 'sessionQuery service is unavailable in current context',
    };
  }

  async _countBrowsers() {
    let unconfirmed = false;
    const engines = {
      neko: 0,
      playwright: 0,
      chromium: 0,
      firefox: 0,
    };
    const rawProcesses = {
      neko: 0,
      playwright: 0,
      chromium: 0,
      firefox: 0,
    };

    try {
      const pids = fs.readdirSync('/proc').filter(p => /^\d+$/.test(p));
      for (const pid of pids) {
        try {
          const raw = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
          if (!raw) continue;
          const args = raw.split('\0');
          const cmd = (args[0] || '').toLowerCase();

          // 1. Chromium-based browsers (Chrome, Chromium, Neko, Playwright)
          if (cmd.includes('chrome') || cmd.includes('chromium')) {
            const isChild = args.some(a => a.startsWith('--type=')) || cmd.includes('crashpad');
            if (args.some(a => a.includes('neko') || a.includes('dsh-chrome'))) {
              rawProcesses.neko++;
              if (!isChild) engines.neko++;
            } else if (args.some(a => a.includes('ms-playwright') || a.includes('playwright') || a.includes('/tmp/jev-browser'))) {
              rawProcesses.playwright++;
              if (!isChild) engines.playwright++;
            } else {
              rawProcesses.chromium++;
              if (!isChild) engines.chromium++;
            }
          }
          // 2. Firefox-based browsers
          else if (cmd.includes('firefox')) {
            const isChild = args.some(a => a.startsWith('-contentproc'));
            rawProcesses.firefox++;
            if (!isChild) engines.firefox++;
          }
        } catch {
          unconfirmed = true;
        }
      }
    } catch {
      unconfirmed = true;
    }

    const totalInstances = engines.neko + engines.playwright + engines.chromium + engines.firefox;
    const activeEngines = [];
    if (engines.neko > 0) activeEngines.push(`${engines.neko} Neko`);
    if (engines.playwright > 0) activeEngines.push(`${engines.playwright} Playwright`);
    if (engines.chromium > 0) activeEngines.push(`${engines.chromium} Chromium`);
    if (engines.firefox > 0) activeEngines.push(`${engines.firefox} Firefox`);

    const summary = activeEngines.length > 0 ? activeEngines.join(', ') : '0';

    return {
      totalInstances,
      instances: engines,
      summary,
      rawProcesses,
      playwrightProcesses: rawProcesses.playwright,
      nekoProcesses: engines.neko,
      unconfirmed,
    };
  }

  /**
   * True Operator & Session Authentication Verification.
   */
  async authenticateRequest(req) {
    if (!req || !req.headers) return false;

    // 1. Bearer Token Authentication
    const authHeader = req.headers['authorization'];
    if (authHeader) {
      if (!authHeader.startsWith('Bearer ')) return false;
      const token = authHeader.slice(7).trim();
      return this.operatorTokens.size > 0 && this.operatorTokens.has(token);
    }

    // 2. Verified Session Validator (support sync and async)
    if (typeof this.validateSession === 'function') {
      try {
        const isSessionValid = await Promise.resolve(this.validateSession(req)).catch(() => false);
        if (isSessionValid === true) return true;
      } catch {
        return false;
      }
    }

    // 3. Cookie Session Token verification against configured operatorTokens
    const cookie = req.headers['cookie'];
    if (cookie && this.operatorTokens.size > 0) {
      const match = cookie.match(/dsh_session=([a-zA-Z0-9_-]{16,})/);
      if (match && this.operatorTokens.has(match[1])) {
        return true;
      }
    }

    return false;
  }
}
