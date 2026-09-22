/**
 * Asynchronous Bounded Retention Planner.
 *
 * Enforces:
 * 1. Strict single-flight lock and explicit source ownership:
 *    - Holds ownership of BOTH pending next() and return().
 *    - Holds ownership of in-flight initial listSessions() across timeouts.
 *    - Does NOT drop source ownership on a grace timeout.
 *    - If an uncancellable iterator next() is still pending, drain remains active
 *      and blocks overlapping passes until the source is actually settled.
 * 2. Strict scan budget with per-step and overall deadline protection:
 *    - Races default listSessions against remaining deadline with abort signal.
 * 3. Cooperative yielding to Event Loop (setImmediate) every 25 items with immediate
 *    signal abort check before synchronous or asynchronous next().
 * 4. Cancellation & lifecycle disposal:
 *    - Calls iterator.return() on abort/dispose so generator finally blocks ALWAYS execute.
 *    - dispose() aborts current in-flight scan, stops drain, and rejects new calls with LifecycleDisposedError.
 * 5. Structured observational report with complete metadata (applicable: false, readOnly: true).
 * 6. Error handling at reading boundary:
 *    - Missing, throwing, or invalid (non-array) default listSessions returns status: 'unavailable'.
 *    - Synchronous iterators (arrays, sync generators) work seamlessly without TypeError.
 */

import { evaluateCandidate } from './eligibility.mjs';
import { ELIGIBILITY_VERDICTS, validateConfig } from './types.mjs';

export class LifecycleDisposedError extends Error {
  constructor(message = 'RetentionPlanner is disposed.') {
    super(`dsh-fleet-cleaner [LifecycleDisposed]: ${message}`);
    this.name = 'LifecycleDisposedError';
  }
}

export class ScanConflictError extends Error {
  constructor(message = 'Previous scan or source drain is still in-flight. Overlapping pass rejected.') {
    super(`dsh-fleet-cleaner [ScanConflict]: ${message}`);
    this.name = 'ScanConflictError';
  }
}

/**
 * Pull next item from async iterator racing against remaining deadline and cancellation signal.
 */
async function nextWithTimeout(nextPromise, remainingMs, signal) {
  if (signal?.aborted) {
    throw signal.reason || new Error('Scan aborted');
  }

  if (remainingMs <= 0) {
    const timeoutErr = new Error('RetentionPlanner scan deadline exceeded');
    timeoutErr.name = 'TimeoutError';
    throw timeoutErr;
  }

  let timerId;
  let onAbort;

  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      const err = new Error('RetentionPlanner scan deadline exceeded');
      err.name = 'TimeoutError';
      reject(err);
    }, remainingMs);
  });

  const abortPromise = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason || new Error('Scan aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
  });

  try {
    return await Promise.race([
      nextPromise,
      timeoutPromise,
      abortPromise,
    ]);
  } finally {
    clearTimeout(timerId);
    if (signal && onAbort) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

export class RetentionPlanner {
  constructor(guardedCtx, config = {}) {
    this.ctx = guardedCtx;
    this.config = validateConfig(config);
    this.inFlightPromise = null;
    this.drainPromise = null;
    this.disposed = false;
    this.activeAbortController = null;
  }

  /**
   * Dispose the planner: abort any in-flight task and reject future calls.
   */
  dispose() {
    this.disposed = true;
    if (this.activeAbortController) {
      this.activeAbortController.abort(new LifecycleDisposedError());
      this.activeAbortController = null;
    }
    this.inFlightPromise = null;
  }

  /**
   * Run one bounded observational plan generation.
   *
   * @param {object} [options] - { signal, candidateSource, asOf }
   * @returns {Promise<object>} RetentionPlan
   */
  generatePlan(options = {}) {
    if (this.disposed) {
      return Promise.reject(new LifecycleDisposedError());
    }

    const { signal } = options;
    signal?.throwIfAborted();

    // If a previous scan is still draining/settling its iterator: reject overlap
    if (this.drainPromise !== null) {
      return Promise.reject(new ScanConflictError());
    }

    // Single-flight coalescing: reuse active running scan
    if (this.inFlightPromise !== null) {
      return this.inFlightPromise;
    }

    const scanController = new AbortController();
    this.activeAbortController = scanController;

    const combinedSignal = signal ? AbortSignal.any([signal, scanController.signal]) : scanController.signal;

    const task = this._runScan({ ...options, signal: combinedSignal, scanController })
      .finally(() => {
        if (this.inFlightPromise === task) {
          this.inFlightPromise = null;
        }
        if (this.activeAbortController === scanController) {
          this.activeAbortController = null;
        }
      });

    this.inFlightPromise = task;
    return task;
  }

  async _runScan(options) {
    const { signal, scanController, candidateSource } = options;
    const asOf = options.asOf ?? Date.now();
    const startTime = performance.now();

    const candidates = [];
    const verdictBreakdown = Object.fromEntries(
      Object.values(ELIGIBILITY_VERDICTS).map(v => [v, 0])
    );

    let activeSourcePromise = null;
    let activeSourceSettled = true;
    let pendingNextPromise = null;
    let pendingNextSettled = true;
    let iterator = null;
    let sourceExhausted = false;

    let totalScanned = 0;
    let eligibleCount = 0;
    let rejectedCount = 0;
    let isTruncated = false;

    try {
      // 1. Resolve candidate source at the boundary of real reading
      let source;
      if (candidateSource) {
        source = candidateSource;
      } else {
        if (!this.ctx?.sessionQuery || typeof this.ctx.sessionQuery.listSessions !== 'function') {
          return {
            readOnly: true,
            applicable: false,
            policyVersion: '1.0.0',
            asOf,
            status: 'unavailable',
            truncated: false,
            scanDurationMs: 0,
            totalScanned: 0,
            eligibleCount: 0,
            rejectedCount: 0,
            verdictBreakdown,
            candidates: [],
            error: 'sessionQuery.listSessions service is unavailable in current context',
          };
        }

        const elapsedMs = performance.now() - startTime;
        const remainingMs = this.config.maxScanTimeMs - elapsedMs;
        if (remainingMs <= 0) {
          scanController?.abort(new Error('RetentionPlanner scan deadline exceeded'));
          return {
            readOnly: true,
            applicable: false,
            policyVersion: '1.0.0',
            asOf,
            status: 'partial',
            truncated: true,
            scanDurationMs: Number((performance.now() - startTime).toFixed(2)),
            totalScanned: 0,
            eligibleCount: 0,
            rejectedCount: 0,
            verdictBreakdown,
            candidates: [],
          };
        }

        let records;
        const rawListPromise = this.ctx.sessionQuery.listSessions(signal);
        activeSourcePromise = rawListPromise;
        activeSourceSettled = false;
        rawListPromise.then(
          () => { activeSourceSettled = true; },
          () => { activeSourceSettled = true; }
        );

        try {
          let timerId;
          let onAbort;
          const timeoutPromise = new Promise((_, reject) => {
            timerId = setTimeout(() => {
              const err = new Error('RetentionPlanner scan deadline exceeded');
              err.name = 'TimeoutError';
              reject(err);
            }, remainingMs);
          });
          const abortPromise = new Promise((_, reject) => {
            onAbort = () => reject(signal.reason || new Error('Scan aborted'));
            signal.addEventListener('abort', onAbort, { once: true });
          });

          try {
            records = await Promise.race([rawListPromise, timeoutPromise, abortPromise]);
          } finally {
            clearTimeout(timerId);
            if (signal && onAbort) signal.removeEventListener('abort', onAbort);
          }
        } catch (err) {
          if (err.name === 'TimeoutError') {
            scanController?.abort(new Error('RetentionPlanner scan deadline exceeded during listSessions'));
            return {
              readOnly: true,
              applicable: false,
              policyVersion: '1.0.0',
              asOf,
              status: 'partial',
              truncated: true,
              scanDurationMs: Number((performance.now() - startTime).toFixed(2)),
              totalScanned: 0,
              eligibleCount: 0,
              rejectedCount: 0,
              verdictBreakdown,
              candidates: [],
            };
          }
          return {
            readOnly: true,
            applicable: false,
            policyVersion: '1.0.0',
            asOf,
            status: 'unavailable',
            truncated: false,
            scanDurationMs: Number((performance.now() - startTime).toFixed(2)),
            totalScanned: 0,
            eligibleCount: 0,
            rejectedCount: 0,
            verdictBreakdown,
            candidates: [],
            error: `Failed to read sessionQuery.listSessions: ${err.message}`,
          };
        }

        if (!Array.isArray(records)) {
          return {
            readOnly: true,
            applicable: false,
            policyVersion: '1.0.0',
            asOf,
            status: 'unavailable',
            truncated: false,
            scanDurationMs: Number((performance.now() - startTime).toFixed(2)),
            totalScanned: 0,
            eligibleCount: 0,
            rejectedCount: 0,
            verdictBreakdown,
            candidates: [],
            error: 'sessionQuery.listSessions returned invalid non-array result',
          };
        }

        source = (async function*() {
          for (const record of records) {
            if (signal?.aborted) break;
            yield { header: record?.header };
          }
        })();
      }

      if (!source || (typeof source[Symbol.asyncIterator] !== 'function' && typeof source[Symbol.iterator] !== 'function')) {
        return {
          readOnly: true,
          applicable: false,
          policyVersion: '1.0.0',
          asOf,
          status: 'unavailable',
          truncated: false,
          scanDurationMs: 0,
          totalScanned: 0,
          eligibleCount: 0,
          rejectedCount: 0,
          verdictBreakdown,
          candidates: [],
          error: 'Candidate source is null or non-iterable',
        };
      }

      iterator = source[Symbol.asyncIterator] ? source[Symbol.asyncIterator]() : source[Symbol.iterator]();

      while (true) {
        signal?.throwIfAborted();

        const elapsedMs = performance.now() - startTime;
        const remainingMs = this.config.maxScanTimeMs - elapsedMs;

        if (remainingMs <= 0) {
          isTruncated = true;
          scanController?.abort(new Error('RetentionPlanner scan deadline exceeded'));
          break;
        }

        if (totalScanned >= this.config.maxScanItems) {
          isTruncated = true;
          scanController?.abort(new Error('RetentionPlanner maxScanItems reached'));
          break;
        }

        // Cooperative yield to Event Loop every 25 items
        if (totalScanned > 0 && totalScanned % 25 === 0) {
          await new Promise(resolve => setImmediate(resolve));
          // Re-check signal immediately after cooperative yield before invoking next()
          signal?.throwIfAborted();
        }

        let rawNextResult;
        rawNextResult = iterator.next();

        const isAsyncNext = rawNextResult && typeof rawNextResult.then === 'function';
        let nextItem;

        if (isAsyncNext) {
          pendingNextSettled = false;
          pendingNextPromise = rawNextResult;
          rawNextResult.then(
            () => { pendingNextSettled = true; },
            () => { pendingNextSettled = true; }
          );

          try {
            nextItem = await nextWithTimeout(rawNextResult, remainingMs, signal);
          } catch (err) {
            if (err.name === 'TimeoutError') {
              isTruncated = true;
              scanController?.abort(new Error('RetentionPlanner scan step timed out'));
              break;
            }
            // Signal abort or lifecycle cancellation throws without disabling iterator.return()
            throw err;
          }
        } else {
          nextItem = rawNextResult;
        }

        if (nextItem.done) {
          sourceExhausted = true;
          break;
        }

        totalScanned++;
        const rawCandidate = nextItem.value;

        let candidateId = `unknown-${totalScanned}`;
        let parentSessionId = undefined;
        let evalResult;

        try {
          candidateId = rawCandidate?.header?.id || candidateId;
          parentSessionId = rawCandidate?.header?.parentSession;
          evalResult = evaluateCandidate(rawCandidate, asOf, this.config.retentionDays);
        } catch (err) {
          evalResult = {
            verdict: ELIGIBILITY_VERDICTS.REJECTED_SOURCE_ERROR,
            reason: `Evaluation exception: ${err.message}`
          };
        }

        verdictBreakdown[evalResult.verdict] = (verdictBreakdown[evalResult.verdict] || 0) + 1;

        if (evalResult.verdict === ELIGIBILITY_VERDICTS.ELIGIBLE) {
          eligibleCount++;
        } else {
          rejectedCount++;
        }

        candidates.push({
          sessionId: candidateId,
          parentSessionId,
          verdict: evalResult.verdict,
          eligibleAfter: evalResult.eligibleAfter,
          reason: evalResult.reason,
        });
      }
    } finally {
      // Complete Source Ownership & Drain covering both listSessions and iterator.return():
      const drainPromises = [];

      if (!activeSourceSettled && activeSourcePromise) {
        drainPromises.push(activeSourcePromise.then(() => {}, () => {}));
      }

      if (!pendingNextSettled && pendingNextPromise && typeof pendingNextPromise.then === 'function') {
        drainPromises.push(pendingNextPromise.then(() => {}, () => {}));
      }

      // iterator.return() is ALWAYS called if !sourceExhausted, including upon abort/dispose
      // so generator finally blocks are guaranteed to execute!
      if (!sourceExhausted && iterator && typeof iterator.return === 'function') {
        try {
          const ret = iterator.return();
          if (ret && typeof ret.then === 'function') {
            drainPromises.push(ret.then(() => {}, () => {}));
          }
        } catch {
          // Synchronous return error caught safely
        }
      }

      if (drainPromises.length > 0) {
        const fullDrain = Promise.all(drainPromises).then(() => {});
        this.drainPromise = fullDrain;
        fullDrain.finally(() => {
          if (this.drainPromise === fullDrain) {
            this.drainPromise = null;
          }
        });
      }
    }

    return {
      readOnly: true,
      applicable: false,
      policyVersion: '1.0.0',
      asOf,
      status: isTruncated ? 'partial' : 'complete',
      truncated: isTruncated,
      scanDurationMs: Number((performance.now() - startTime).toFixed(2)),
      totalScanned,
      eligibleCount,
      rejectedCount,
      verdictBreakdown,
      candidates,
    };
  }
}
