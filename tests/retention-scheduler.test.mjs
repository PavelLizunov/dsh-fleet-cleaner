import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { RetentionScheduler } from '../src/retention-scheduler.mjs';
import { QuarantineJournal } from '../src/quarantine-journal.mjs';
import { ObservabilityService } from '../src/observability-service.mjs';

describe('RetentionScheduler & Phase 3 Automation Tests', () => {

  it('1. Lifecycle: starts timer with valid interval, updates nextSweepAt, stops cleanly', () => {
    const mockPlanner = {
      disposed: false,
      generatePlan: async () => ({ totalScanned: 10, eligibleCount: 2, rejectedCount: 8, candidates: [] })
    };

    const scheduler = new RetentionScheduler({
      retentionPlanner: mockPlanner,
      config: { scheduleIntervalHours: 12, dryRun: true }
    });

    assert.equal(scheduler.running, false);
    assert.equal(scheduler.nextSweepAt, null);

    scheduler.start();
    assert.equal(scheduler.running, true);
    assert.ok(scheduler.nextSweepAt > Date.now());
    assert.equal(scheduler.getStatus().intervalHours, 12);

    scheduler.stop();
    assert.equal(scheduler.running, false);
    assert.equal(scheduler.nextSweepAt, null);
  });

  it('2. Single-flight lock: concurrent triggerSweep calls do not run in parallel', async () => {
    let activeSweeps = 0;
    let maxConcurrent = 0;

    const mockPlanner = {
      disposed: false,
      generatePlan: async () => {
        activeSweeps++;
        maxConcurrent = Math.max(maxConcurrent, activeSweeps);
        await new Promise(r => setTimeout(r, 40));
        activeSweeps--;
        return { totalScanned: 50, eligibleCount: 0, rejectedCount: 50, candidates: [] };
      }
    };

    const scheduler = new RetentionScheduler({
      retentionPlanner: mockPlanner,
      config: { dryRun: true }
    });

    const [res1, res2] = await Promise.all([
      scheduler.triggerSweep(),
      scheduler.triggerSweep()
    ]);

    assert.equal(maxConcurrent, 1, 'Only one sweep may execute concurrently');
    const skippedOne = res1.skipped || res2.skipped;
    assert.ok(skippedOne, 'Second concurrent call must be skipped due to lock');
  });

  it('3. DryRun compliance: automated sweep in dryRun: true generates plan but never mutates disk', async () => {
    let quarantineCalls = 0;
    const mockPlanner = {
      disposed: false,
      generatePlan: async () => ({
        totalScanned: 100,
        eligibleCount: 5,
        rejectedCount: 95,
        candidates: [{ sessionId: 'sub-1', verdict: 'ELIGIBLE' }]
      })
    };

    const mockQuarantine = {
      quarantineBatch: async () => {
        quarantineCalls++;
        return { quarantined: 1, errors: 0 };
      }
    };

    const scheduler = new RetentionScheduler({
      retentionPlanner: mockPlanner,
      quarantineService: mockQuarantine,
      config: { dryRun: true }
    });

    const result = await scheduler.triggerSweep();
    assert.equal(result.dryRun, true);
    assert.equal(result.eligibleCount, 5);
    assert.equal(result.quarantined, 0, 'Quarantine must not be executed in dryRun');
    assert.equal(quarantineCalls, 0, 'quarantineBatch must never be called when dryRun is true');
  });

  it('4. Multi-engine browser detection: correctly distinguishes master browser instance from child processes', async () => {
    const service = new ObservabilityService({});
    const metrics = await service._countBrowsers();

    assert.ok(typeof metrics.totalInstances === 'number');
    assert.ok(typeof metrics.instances === 'object');
    assert.ok(typeof metrics.instances.neko === 'number');
    assert.ok(typeof metrics.instances.playwright === 'number');
    assert.ok(typeof metrics.instances.chromium === 'number');
    assert.ok(typeof metrics.instances.firefox === 'number');
    assert.ok(typeof metrics.summary === 'string');

    // Neko is currently running on the host as 1 master instance with ~13 child processes
    assert.equal(metrics.instances.neko, 1, 'Host has exactly 1 Neko browser instance, not child process count');
    assert.match(metrics.summary, /1 Neko/);
  });

  it('5. Journal Compaction: compact() creates safe atomic snapshot without data corruption', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-journal-'));
    const journalFile = path.join(tempDir, 'quarantine-journal.jsonl');

    try {
      const journal = new QuarantineJournal(journalFile);
      await journal.recordPrepared({ operationId: 'op-1', sessionId: 'sub-comp-1' });
      await journal.recordQuarantined({ operationId: 'op-1', sessionId: 'sub-comp-1' });
      await journal.recordPrepared({ operationId: 'op-2', sessionId: 'sub-comp-2' });
      await journal.recordRestored({ sessionId: 'sub-comp-2' });

      // Append raw corrupted noise line to verify cleanup
      await fs.promises.appendFile(journalFile, 'INVALID_JSON_CORRUPTED_LINE\n', 'utf8');

      // Execute compaction
      await journal.compact();

      // Read back compacted journal
      const freshJournal = new QuarantineJournal(journalFile);
      await freshJournal.load();

      assert.equal(freshJournal.getEntry('sub-comp-1').state, 'QUARANTINED');
      assert.equal(freshJournal.getEntry('sub-comp-2').state, 'RESTORED');
      assert.equal(freshJournal.listQuarantined().length, 1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
