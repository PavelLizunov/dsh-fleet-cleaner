import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RetentionPlanner, LifecycleDisposedError, ScanConflictError } from '../src/retention-planner.mjs';
import { createGuardedReadOnlyContext } from '../src/read-only-adapter.mjs';

describe('RetentionPlanner Lifecycle, Timeout & Recovery Tests', () => {

  it('1. Dispose halts in-flight scan and rejects subsequent calls', async () => {
    let iterationCount = 0;
    async function* infiniteSource() {
      while (true) {
        iterationCount++;
        await new Promise(r => setTimeout(r, 10));
        yield { header: { id: `item-${iterationCount}` } };
      }
    }

    const planner = new RetentionPlanner(createGuardedReadOnlyContext({}), { dryRun: true });

    const planPromise = planner.generatePlan({ candidateSource: infiniteSource() });

    await new Promise(r => setTimeout(r, 25));
    planner.dispose();

    await assert.rejects(async () => planPromise, /LifecycleDisposed|aborted/i);
    await assert.rejects(() => planner.generatePlan(), LifecycleDisposedError);
  });

  it('2. Single-flight recovery: planner recovers cleanly after a thrown error', async () => {
    let shouldThrow = true;
    async function* unstableSource() {
      if (shouldThrow) {
        throw new Error('Database disk failure');
      }
      yield { header: { id: 'recovered-item' } };
    }

    const planner = new RetentionPlanner(createGuardedReadOnlyContext({}), { dryRun: true });

    await assert.rejects(
      () => planner.generatePlan({ candidateSource: unstableSource() }),
      /Database disk failure/
    );

    shouldThrow = false;
    const plan = await planner.generatePlan({ candidateSource: unstableSource() });
    assert.equal(plan.totalScanned, 1);
    assert.equal(plan.status, 'complete');
  });

  it('3. Generator hanging inside next() past deadline is safely aborted and returns partial plan promptly', async () => {
    async function* hangingGenerator() {
      yield { header: { id: 'item-1' } };
      // Hang indefinitely
      await new Promise(() => {});
    }

    const planner = new RetentionPlanner(createGuardedReadOnlyContext({}), { dryRun: true, maxScanTimeMs: 100 });

    const t0 = performance.now();
    const plan = await planner.generatePlan({ candidateSource: hangingGenerator() });
    const duration = performance.now() - t0;

    assert.equal(plan.truncated, true);
    assert.equal(plan.status, 'partial');
    assert.equal(plan.totalScanned, 1);
    assert.ok(duration < 250, `Expected planner to break at deadline, duration was ${duration}ms`);
  });

  it('4. Ownership of pending next() without return: drain stays active until next() settles', async () => {
    let nextResolve;
    const pendingNextPromise = new Promise(r => { nextResolve = r; });

    let callCount = 0;
    const noReturnSource = {
      [Symbol.asyncIterator]() {
        return {
          next: () => {
            callCount++;
            if (callCount === 1) {
              return Promise.resolve({ value: { header: { id: 'i-1' } }, done: false });
            }
            return pendingNextPromise;
          }
        };
      }
    };

    const planner = new RetentionPlanner(createGuardedReadOnlyContext({}), { dryRun: true, maxScanTimeMs: 100 });

    const plan1 = await planner.generatePlan({ candidateSource: noReturnSource });
    assert.equal(plan1.status, 'partial');

    // Second call while pending next() is still unresolved: MUST REJECT!
    await assert.rejects(
      () => planner.generatePlan({ candidateSource: noReturnSource }),
      ScanConflictError
    );

    // Settle next
    nextResolve({ done: true });
    await new Promise(r => setTimeout(r, 10));

    const plan2 = await planner.generatePlan({ candidateSource: noReturnSource });
    assert.ok(plan2);
  });

  it('5. Fast return() does not drop ownership while next() is still in flight', async () => {
    let nextResolve;
    const slowNextPromise = new Promise(r => { nextResolve = r; });

    let callCount = 0;
    let returnCalled = false;
    const fastReturnSource = {
      [Symbol.asyncIterator]() {
        return {
          next: () => {
            callCount++;
            if (callCount === 1) return Promise.resolve({ value: { header: { id: 'i-1' } }, done: false });
            return slowNextPromise;
          },
          return: () => {
            returnCalled = true;
            return Promise.resolve({ done: true });
          }
        };
      }
    };

    const planner = new RetentionPlanner(createGuardedReadOnlyContext({}), { dryRun: true, maxScanTimeMs: 100 });

    const plan1 = await planner.generatePlan({ candidateSource: fastReturnSource });
    assert.equal(plan1.status, 'partial');
    assert.equal(returnCalled, true);

    await assert.rejects(
      () => planner.generatePlan({ candidateSource: fastReturnSource }),
      ScanConflictError
    );

    nextResolve({ done: true });
    await new Promise(r => setTimeout(r, 10));

    const plan2 = await planner.generatePlan({ candidateSource: fastReturnSource });
    assert.ok(plan2);
  });

  it('6. Error return() does not crash planner or drop ownership while next() is pending', async () => {
    let nextResolve;
    const slowNextPromise = new Promise(r => { nextResolve = r; });

    let callCount = 0;
    const errorReturnSource = {
      [Symbol.asyncIterator]() {
        return {
          next: () => {
            callCount++;
            if (callCount === 1) return Promise.resolve({ value: { header: { id: 'i-1' } }, done: false });
            return slowNextPromise;
          },
          return: () => {
            throw new Error('Iterator return exploded');
          }
        };
      }
    };

    const planner = new RetentionPlanner(createGuardedReadOnlyContext({}), { dryRun: true, maxScanTimeMs: 100 });

    const plan1 = await planner.generatePlan({ candidateSource: errorReturnSource });
    assert.equal(plan1.status, 'partial');

    await assert.rejects(
      () => planner.generatePlan({ candidateSource: errorReturnSource }),
      ScanConflictError
    );

    nextResolve({ done: true });
    await new Promise(r => setTimeout(r, 10));

    const plan2 = await planner.generatePlan({ candidateSource: errorReturnSource });
    assert.ok(plan2);
  });

  it('7. Default sessionQuery source missing, throwing, or invalid returns status: unavailable', async () => {
    // 1. Missing sessionQuery
    const planner1 = new RetentionPlanner(createGuardedReadOnlyContext({}), { dryRun: true });
    const res1 = await planner1.generatePlan();
    assert.equal(res1.status, 'unavailable');
    assert.equal(res1.totalScanned, 0);

    // 2. Throwing listSessions
    const planner2 = new RetentionPlanner(createGuardedReadOnlyContext({
      sessionQuery: { listSessions: async () => { throw new Error('Database locked'); } }
    }), { dryRun: true });
    const res2 = await planner2.generatePlan();
    assert.equal(res2.status, 'unavailable');
    assert.match(res2.error, /Database locked/);

    // 3. Non-array listSessions result
    const planner3 = new RetentionPlanner(createGuardedReadOnlyContext({
      sessionQuery: { listSessions: async () => ({ error: 'bad result' }) }
    }), { dryRun: true });
    const res3 = await planner3.generatePlan();
    assert.equal(res3.status, 'unavailable');
    assert.match(res3.error, /non-array/);
  });

  it('8. Generator finally block executes when scan is aborted by signal or dispose', async () => {
    let generatorFinallyExecuted = false;
    async function* cancellableGen() {
      try {
        yield { header: { id: 'item-1' } };
        yield { header: { id: 'item-2' } };
      } finally {
        generatorFinallyExecuted = true;
      }
    }

    const controller = new AbortController();
    const planner = new RetentionPlanner(createGuardedReadOnlyContext({}), { dryRun: true });

    const p = planner.generatePlan({ candidateSource: cancellableGen(), signal: controller.signal });
    controller.abort();

    await assert.rejects(async () => p, /aborted|This operation was aborted/i);
    assert.equal(generatorFinallyExecuted, true, 'Generator finally block must execute on abort');
  });

  it('9. Abort during cooperative yield throws before calling synchronous next()', async () => {
    let callCount = 0;
    const controller = new AbortController();

    const syncSource = {
      [Symbol.iterator]() {
        return {
          next() {
            callCount++;
            if (callCount === 25) {
              controller.abort(new Error('Aborted at yield boundary'));
            }
            return { value: { header: { id: `item-${callCount}` } }, done: false };
          }
        };
      }
    };

    const planner = new RetentionPlanner(createGuardedReadOnlyContext({}), { dryRun: true, maxScanItems: 50 });

    await assert.rejects(
      () => planner.generatePlan({ candidateSource: syncSource, signal: controller.signal }),
      /Aborted at yield boundary/
    );

    // callCount must be exactly 25, item 26 must never have been requested!
    assert.equal(callCount, 25, 'Item 26 must not be called after abort during yield');
  });
});
