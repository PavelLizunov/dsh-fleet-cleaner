import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RetentionPlanner } from '../src/retention-planner.mjs';
import { createGuardedReadOnlyContext } from '../src/read-only-adapter.mjs';
import { ELIGIBILITY_VERDICTS } from '../src/types.mjs';

describe('RetentionPlanner Integration & Lifecycle Doubles Tests', () => {

  const asOf = 1788000000000;
  const oldTimestamp = asOf - (20 * 24 * 60 * 60 * 1000);

  function makeSubagent(id, openInUI = false) {
    return {
      header: {
        id,
        version: 1,
        origin: 'subagent',
        parentSession: 'root-main',
        subagentMode: 'one-shot',
        cwd: '/var/lib/dsh/proj',
      },
      settlement: { status: 'settled', completedAt: oldTimestamp, runAttempt: 'att-1' },
      lastDurableActivityAt: oldTimestamp,
      receipt: { receiptId: `rcpt-${id}`, childSessionId: id, runAttempt: 'att-1' },
      references: {
        runningDescendantsCount: 0,
        hasActiveContinuation: false,
        hasPendingRetry: false,
        activeReadersCount: 0,
        activeWritersCount: 0,
      },
      openInUI,
    };
  }

  it('1. Observational race with open()/resume(): session opened during scan is not eligible', async () => {
    let sub2Opened = false;
    const candidates = [
      makeSubagent('sub-1', false),
      makeSubagent('sub-2', false),
      makeSubagent('sub-3', false),
    ];

    async function* concurrentOpeningSource() {
      for (const c of candidates) {
        if (c.header.id === 'sub-2' && sub2Opened) {
          c.openInUI = true;
        }
        yield c;
        if (c.header.id === 'sub-1') {
          sub2Opened = true;
        }
      }
    }

    const guardedCtx = createGuardedReadOnlyContext({});
    const planner = new RetentionPlanner(guardedCtx, { dryRun: true });

    const plan = await planner.generatePlan({ candidateSource: concurrentOpeningSource(), asOf });

    const sub1 = plan.candidates.find(c => c.sessionId === 'sub-1');
    const sub2 = plan.candidates.find(c => c.sessionId === 'sub-2');
    const sub3 = plan.candidates.find(c => c.sessionId === 'sub-3');

    assert.equal(sub1.verdict, ELIGIBILITY_VERDICTS.ELIGIBLE);
    assert.equal(sub2.verdict, ELIGIBILITY_VERDICTS.REJECTED_OPEN_IN_UI);
    assert.equal(sub3.verdict, ELIGIBILITY_VERDICTS.ELIGIBLE);
    assert.equal(plan.eligibleCount, 2);
    assert.equal(plan.rejectedCount, 1);
  });

  it('2. Two concurrent planner runs with identical inputs and fixed asOf return identical plans', async () => {
    const data = [
      makeSubagent('sub-a', false),
      makeSubagent('sub-b', false),
      { header: { id: 'root-chat', version: 1, origin: undefined } },
      { header: { id: 'legacy-zero', version: 0 } },
    ];

    const guardedCtx = createGuardedReadOnlyContext({});
    const planner = new RetentionPlanner(guardedCtx, { dryRun: true });

    const [planA, planB] = await Promise.all([
      planner.generatePlan({ candidateSource: (async function*() { for (const x of data) yield x; })(), asOf }),
      planner.generatePlan({ candidateSource: (async function*() { for (const x of data) yield x; })(), asOf }),
    ]);

    assert.deepEqual(planA, planB);
    assert.equal(planA.totalScanned, 4);
    assert.equal(planA.eligibleCount, 2);
    assert.equal(planA.verdictBreakdown[ELIGIBILITY_VERDICTS.REJECTED_NON_SUBAGENT], 1);
    assert.equal(planA.verdictBreakdown[ELIGIBILITY_VERDICTS.REJECTED_UNSUPPORTED_VERSION], 1);
  });

  it('3. Intermediate failure & malformed json in storage: fails closed per candidate and continues', async () => {
    async function* faultySource() {
      yield makeSubagent('sub-ok-1');
      yield { header: { id: 'corrupt-entry' }, settlement: 'NOT_AN_OBJECT' };
      yield null;
      yield makeSubagent('sub-ok-2');
    }

    const guardedCtx = createGuardedReadOnlyContext({});
    const planner = new RetentionPlanner(guardedCtx, { dryRun: true });

    const plan = await planner.generatePlan({ candidateSource: faultySource(), asOf });

    assert.equal(plan.totalScanned, 4);
    assert.equal(plan.eligibleCount, 2);
    assert.equal(plan.rejectedCount, 2);
    assert.equal(plan.verdictBreakdown[ELIGIBILITY_VERDICTS.REJECTED_SOURCE_ERROR], 1);
    assert.equal(plan.verdictBreakdown[ELIGIBILITY_VERDICTS.REJECTED_UNSUPPORTED_VERSION], 1);
    assert.equal(plan.status, 'complete');
  });

  it('4. Read-Only Verification: 0 mutations attempted across complete integration run', async () => {
    let writeAttempts = 0;
    const rawCtx = {
      storageDomain: {
        delete: () => { writeAttempts++; },
        put: () => { writeAttempts++; },
        update: () => { writeAttempts++; },
      },
      sessionQuery: {
        listSessions: async () => [
          { header: { id: 's1', version: 1, origin: 'subagent', parentSession: 'root', subagentMode: 'one-shot', cwd: '/var/lib/dsh' } },
        ]
      }
    };

    const guardedCtx = createGuardedReadOnlyContext(rawCtx);
    const planner = new RetentionPlanner(guardedCtx, { dryRun: true });

    const plan = await planner.generatePlan({ asOf });
    assert.equal(plan.readOnly, true);
    assert.equal(plan.applicable, false);
    assert.equal(writeAttempts, 0);
  });

  it('5. Synchronous candidate sources (plain arrays, sync generators) work cleanly without TypeError', async () => {
    const guardedCtx = createGuardedReadOnlyContext({});
    const planner = new RetentionPlanner(guardedCtx, { dryRun: true });

    // 1. Empty synchronous array
    const planEmpty = await planner.generatePlan({ candidateSource: [], asOf });
    assert.equal(planEmpty.status, 'complete');
    assert.equal(planEmpty.totalScanned, 0);

    // 2. Synchronous array with 1 eligible candidate
    const planArray = await planner.generatePlan({ candidateSource: [makeSubagent('sub-arr-1')], asOf });
    assert.equal(planArray.status, 'complete');
    assert.equal(planArray.totalScanned, 1);
    assert.equal(planArray.eligibleCount, 1);

    // 3. Synchronous generator (function*)
    function* syncGen() {
      yield makeSubagent('sub-gen-1');
      yield makeSubagent('sub-gen-2');
    }
    const planGen = await planner.generatePlan({ candidateSource: syncGen(), asOf });
    assert.equal(planGen.status, 'complete');
    assert.equal(planGen.totalScanned, 2);
    assert.equal(planGen.eligibleCount, 2);
  });

  it('6. Default source listSessions hanging past maxScanTimeMs times out and enters drain', async () => {
    let listWasAborted = false;
    let listResolved = false;

    const mockCtx = {
      sessionQuery: {
        listSessions: (signal) => new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            listWasAborted = true;
            setTimeout(() => {
              listResolved = true;
              resolve([]);
            }, 60);
          });
        })
      }
    };

    const guardedCtx = createGuardedReadOnlyContext(mockCtx);
    const planner = new RetentionPlanner(guardedCtx, { dryRun: true, maxScanTimeMs: 100 });

    const t0 = performance.now();
    const plan = await planner.generatePlan({ asOf });
    const duration = performance.now() - t0;

    // Caller gets plan promptly at deadline!
    assert.equal(plan.status, 'partial');
    assert.equal(plan.truncated, true);
    assert.equal(plan.totalScanned, 0);
    assert.ok(duration < 250, `Expected return at deadline (~100ms), took ${duration}ms`);

    // Source signal was aborted!
    assert.equal(listWasAborted, true);

    // Drain is active while listSessions is still resolving in the background!
    assert.ok(planner.drainPromise !== null);

    // Overlapping pass while listSessions is still resolving must reject with ScanConflictError
    await assert.rejects(
      () => planner.generatePlan({ asOf }),
      /ScanConflict/
    );

    // Wait for listSessions to finish resolving
    await new Promise(r => setTimeout(r, 70));
    assert.equal(listResolved, true);
    assert.equal(planner.drainPromise, null);

    // Next pass succeeds cleanly
    const planAfter = await planner.generatePlan({ asOf });
    assert.ok(planAfter);
  });
});
