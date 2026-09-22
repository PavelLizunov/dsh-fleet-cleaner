import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RetentionPlanner } from '../src/retention-planner.mjs';
import { createGuardedReadOnlyContext, ReadOnlyViolationError } from '../src/read-only-adapter.mjs';
import { validateConfig, ELIGIBILITY_VERDICTS, ConfigError } from '../src/types.mjs';

describe('RetentionPlanner Unit & Integration Tests (Doubles)', () => {

  function createMockCandidate(id, overrides = {}) {
    const asOf = 1788000000000;
    const completedAt = asOf - (15 * 24 * 60 * 60 * 1000);
    return {
      header: {
        id,
        version: 1,
        origin: 'subagent',
        parentSession: 'root-1',
        subagentMode: 'one-shot',
        cwd: '/var/lib/dsh',
      },
      settlement: { status: 'settled', completedAt, runAttempt: 'attempt-1' },
      lastDurableActivityAt: completedAt,
      receipt: { receiptId: `rcpt-${id}`, childSessionId: id, runAttempt: 'attempt-1' },
      references: {
        runningDescendantsCount: 0,
        hasActiveContinuation: false,
        hasPendingRetry: false,
        activeReadersCount: 0,
        activeWritersCount: 0,
      },
      openInUI: false,
      ...overrides,
    };
  }

  it('1. Config rejection: strictly rejects dryRun: false and missing dryRun', () => {
    assert.throws(
      () => validateConfig({ dryRun: false }),
      ConfigError
    );
    assert.throws(
      () => validateConfig({}),
      ConfigError
    );
    const valid = validateConfig({ dryRun: true, retentionDays: 7 });
    assert.equal(valid.dryRun, true);
    assert.equal(valid.retentionDays, 7);
  });

  it('2. Read-Only Guard: throws immediately on any mutation attempt', () => {
    const rawCtx = {
      storageDomain: {
        delete: () => { throw new Error('Raw delete should not be called'); },
      }
    };
    const guardedCtx = createGuardedReadOnlyContext(rawCtx);

    assert.throws(
      () => guardedCtx.storageDomain.delete('some-id'),
      ReadOnlyViolationError
    );
    assert.throws(
      () => guardedCtx.fs.unlink('some-path'),
      ReadOnlyViolationError
    );
    assert.throws(
      () => guardedCtx.fs.rename('src', 'dest'),
      ReadOnlyViolationError
    );
  });

  it('3. Scan budgeting: truncates when maxScanItems is reached and sets status: partial', async () => {
    const guardedCtx = createGuardedReadOnlyContext({});
    const planner = new RetentionPlanner(guardedCtx, { dryRun: true, maxScanItems: 10 });

    async function* generate50Items() {
      for (let i = 0; i < 50; i++) {
        yield createMockCandidate(`sub-${i}`);
      }
    }

    const plan = await planner.generatePlan({ candidateSource: generate50Items(), asOf: 1788000000000 });

    assert.equal(plan.readOnly, true);
    assert.equal(plan.applicable, false);
    assert.equal(plan.status, 'partial');
    assert.equal(plan.truncated, true);
    assert.equal(plan.totalScanned, 10);
    assert.equal(plan.candidates.length, 10);
    assert.equal(plan.eligibleCount, 10);
  });

  it('4. Scan budgeting: truncates when maxScanTimeMs is reached', async () => {
    const guardedCtx = createGuardedReadOnlyContext({});
    const planner = new RetentionPlanner(guardedCtx, { dryRun: true, maxScanTimeMs: 100, maxScanItems: 500 });

    async function* slowGenerator() {
      for (let i = 0; i < 100; i++) {
        await new Promise(r => setTimeout(r, 25));
        yield createMockCandidate(`sub-${i}`);
      }
    }

    const plan = await planner.generatePlan({ candidateSource: slowGenerator(), asOf: 1788000000000 });

    assert.equal(plan.truncated, true);
    assert.equal(plan.status, 'partial');
    assert.ok(plan.totalScanned < 100, `Expected truncation before 100 items, scanned: ${plan.totalScanned}`);
  });

  it('5. Single-flight coalescing: concurrent calls share in-flight promise and return identical plan', async () => {
    const guardedCtx = createGuardedReadOnlyContext({});
    const planner = new RetentionPlanner(guardedCtx, { dryRun: true });

    async function* delayedSource() {
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 5));
        yield createMockCandidate(`sub-${i}`);
      }
    }

    const source = delayedSource();
    const p1 = planner.generatePlan({ candidateSource: source, asOf: 1788000000000 });
    const p2 = planner.generatePlan({ candidateSource: source, asOf: 1788000000000 });

    assert.equal(p1, p2, 'Concurrent callers must receive the exact same in-flight promise');
    const [plan1, plan2] = await Promise.all([p1, p2]);
    assert.deepEqual(plan1, plan2);
    assert.equal(plan1.status, 'complete');
    assert.equal(plan1.totalScanned, 5);
  });

  it('6. Fail-closed: source exception or candidate error marks candidate REJECTED_SOURCE_ERROR', async () => {
    const guardedCtx = createGuardedReadOnlyContext({});
    const planner = new RetentionPlanner(guardedCtx, { dryRun: true });

    async function* throwingSource() {
      yield createMockCandidate('sub-ok');
      yield null;
      yield {
        header: {
          get id() { throw new Error('Unreadable storage sector'); }
        }
      };
    }

    const plan = await planner.generatePlan({ candidateSource: throwingSource(), asOf: 1788000000000 });

    assert.equal(plan.totalScanned, 3);
    assert.equal(plan.eligibleCount, 1);
    assert.equal(plan.rejectedCount, 2);
    assert.equal(plan.verdictBreakdown[ELIGIBILITY_VERDICTS.REJECTED_SOURCE_ERROR], 2);
  });

  it('7. Guarantees Zero Mutation: no storage or fs write operations were executed during plan generation', async () => {
    let writeOperationsAttempted = 0;
    const rawCtx = {
      storageDomain: {
        delete: () => { writeOperationsAttempted++; },
        put: () => { writeOperationsAttempted++; },
        update: () => { writeOperationsAttempted++; },
      },
      sessionQuery: {
        listSessions: async () => [
          { header: { id: 's1', version: 1, origin: 'subagent', parentSession: 'r', subagentMode: 'one-shot', cwd: '/var/lib/dsh' } }
        ]
      }
    };
    const guardedCtx = createGuardedReadOnlyContext(rawCtx);
    const planner = new RetentionPlanner(guardedCtx, { dryRun: true });

    const plan = await planner.generatePlan({ asOf: 1788000000000 });
    assert.equal(plan.readOnly, true);
    assert.equal(plan.applicable, false);
    assert.equal(writeOperationsAttempted, 0, 'Zero write operations must be attempted');
  });
});
