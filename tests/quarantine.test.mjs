import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { QuarantineService } from '../src/quarantine-service.mjs';
import { ELIGIBILITY_VERDICTS } from '../src/types.mjs';

describe('QuarantineService Unit & Safety Tests (Phase 2)', () => {
  let tmpBase;
  let sessionsDir;
  let quarantineDir;
  let deletedKeys = [];
  const asOf = 1788000000000;
  const oldTimestamp = asOf - (20 * 24 * 60 * 60 * 1000); // 20 days ago

  function makeSubagentFixture(id, overrides = {}) {
    return {
      header: {
        id,
        version: 1,
        origin: 'subagent',
        parentSession: 'root-main',
        subagentMode: 'one-shot',
        cwd: '/var/lib/dsh',
        ...overrides.header,
      },
      settlement: {
        status: 'settled',
        completedAt: oldTimestamp,
        runAttempt: 'att-1',
        ...overrides.settlement,
      },
      lastDurableActivityAt: oldTimestamp,
      receipt: {
        receiptId: `rcpt-${id}`,
        childSessionId: id,
        runAttempt: 'att-1',
        ...overrides.receipt,
      },
      references: {
        runningDescendantsCount: 0,
        hasActiveContinuation: false,
        hasPendingRetry: false,
        activeReadersCount: 0,
        activeWritersCount: 0,
        ...overrides.references,
      },
      openInUI: overrides.openInUI ?? false,
    };
  }

  beforeEach(async () => {
    tmpBase = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dsh-quarantine-test-'));
    sessionsDir = path.join(tmpBase, 'sessions');
    quarantineDir = path.join(tmpBase, 'quarantine');
    await fs.promises.mkdir(sessionsDir, { recursive: true });
    await fs.promises.mkdir(quarantineDir, { recursive: true });
    deletedKeys = [];
  });

  afterEach(async () => {
    if (tmpBase) {
      await fs.promises.rm(tmpBase, { recursive: true, force: true });
    }
  });

  it('1. Happy Path: moves confirmed ELIGIBLE subagent to quarantine and evicts from projection cache', async () => {
    const sessionId = 'sub-test-eligible-1';
    const fixture = makeSubagentFixture(sessionId);

    // Create session directory on disk with files
    const sessionPath = path.join(sessionsDir, sessionId);
    await fs.promises.mkdir(sessionPath, { recursive: true });
    await fs.promises.writeFile(path.join(sessionPath, 'session.json'), JSON.stringify(fixture), 'utf8');
    await fs.promises.writeFile(path.join(sessionPath, 'data.txt'), 'test payload', 'utf8');

    const mockStorageTable = {
      delete: async (id) => { deletedKeys.push(id); }
    };

    const service = new QuarantineService({
      sessionsDir,
      quarantineDir,
      storageTable: mockStorageTable,
      holdHours: 72,
    });

    const res = await service.quarantineBatch([fixture], { asOf });

    assert.equal(res.quarantined, 1);
    assert.equal(res.skipped, 0);

    // Verify source moved, destination exists
    assert.equal(fs.existsSync(sessionPath), false, 'Source session must no longer exist in sessions directory');
    const targetPath = path.join(quarantineDir, sessionId);
    assert.equal(fs.existsSync(targetPath), true, 'Target must exist in quarantine directory');
    assert.equal(fs.readFileSync(path.join(targetPath, 'data.txt'), 'utf8'), 'test payload');

    // Verify cache eviction
    assert.deepEqual(deletedKeys, [sessionId]);

    // Verify journal
    const quarantinedList = await service.listQuarantined();
    assert.equal(quarantinedList.length, 1);
    assert.equal(quarantinedList[0].sessionId, sessionId);
    assert.equal(quarantinedList[0].state, 'QUARANTINED');
    assert.ok(quarantinedList[0].holdUntil >= asOf + (72 * 60 * 60 * 1000));
  });

  it('2. Instant Undo: restores quarantined session back to active sessions directory', async () => {
    const sessionId = 'sub-test-restore-1';
    const fixture = makeSubagentFixture(sessionId);

    const sessionPath = path.join(sessionsDir, sessionId);
    const targetPath = path.join(quarantineDir, sessionId);

    await fs.promises.mkdir(sessionPath, { recursive: true });
    await fs.promises.writeFile(path.join(sessionPath, 'session.json'), JSON.stringify(fixture), 'utf8');

    const service = new QuarantineService({ sessionsDir, quarantineDir });
    await service.quarantineBatch([fixture], { asOf });
    assert.equal(fs.existsSync(targetPath), true);
    assert.equal(fs.existsSync(sessionPath), false);

    // Execute Undo / Restore
    const restoreRes = await service.restoreSessions([sessionId]);
    assert.deepEqual(restoreRes.restored, [sessionId]);
    assert.equal(restoreRes.failed.length, 0);

    // Verify restored back to sessions, removed from quarantine
    assert.equal(fs.existsSync(sessionPath), true, 'Session must be restored back to sessions directory');
    assert.equal(fs.existsSync(targetPath), false, 'Session must no longer be in quarantine directory');

    // Journal status
    const list = await service.listQuarantined();
    assert.equal(list.length, 0, 'Restored session must no longer be in active quarantine list');
  });

  it('3. Root User Chat Immunity: root sessions are 100% protected and never moved', async () => {
    const rootId = 'root-user-chat-1';
    const rootFixture = {
      header: { id: rootId, version: 1, origin: undefined, cwd: '/var/lib/dsh' }
    };

    const sessionPath = path.join(sessionsDir, rootId);
    await fs.promises.mkdir(sessionPath, { recursive: true });
    await fs.promises.writeFile(path.join(sessionPath, 'session.json'), JSON.stringify(rootFixture), 'utf8');

    const service = new QuarantineService({ sessionsDir, quarantineDir });
    const res = await service.quarantineBatch([rootFixture], { asOf });

    assert.equal(res.quarantined, 0);
    assert.equal(res.skipped, 1);
    assert.equal(res.results[0].verdict, ELIGIBILITY_VERDICTS.REJECTED_NON_SUBAGENT);

    // Must still exist in sessionsDir!
    assert.equal(fs.existsSync(sessionPath), true);
    assert.equal(fs.existsSync(path.join(quarantineDir, rootId)), false);
  });

  it('4. Legacy Record Immunity: version 0 sessions are 100% protected and never moved', async () => {
    const legacyId = 'legacy-v0-session';
    const legacyFixture = {
      header: { id: legacyId, version: 0 }
    };

    const sessionPath = path.join(sessionsDir, legacyId);
    await fs.promises.mkdir(sessionPath, { recursive: true });
    await fs.promises.writeFile(path.join(sessionPath, 'session.json'), JSON.stringify(legacyFixture), 'utf8');

    const service = new QuarantineService({ sessionsDir, quarantineDir });
    const res = await service.quarantineBatch([legacyFixture], { asOf });

    assert.equal(res.quarantined, 0);
    assert.equal(res.skipped, 1);
    assert.equal(res.results[0].verdict, ELIGIBILITY_VERDICTS.REJECTED_UNSUPPORTED_VERSION);

    assert.equal(fs.existsSync(sessionPath), true);
    assert.equal(fs.existsSync(path.join(quarantineDir, legacyId)), false);
  });

  it('5. Fresh TTL Immunity: subagents completed recently are protected', async () => {
    const freshId = 'sub-fresh-ttl';
    const freshFixture = makeSubagentFixture(freshId, {
      settlement: { status: 'settled', completedAt: asOf - (2 * 24 * 60 * 60 * 1000) } // 2 days ago (< 14 days)
    });

    const sessionPath = path.join(sessionsDir, freshId);
    await fs.promises.mkdir(sessionPath, { recursive: true });
    await fs.promises.writeFile(path.join(sessionPath, 'session.json'), JSON.stringify(freshFixture), 'utf8');

    const service = new QuarantineService({ sessionsDir, quarantineDir });
    const res = await service.quarantineBatch([freshFixture], { asOf });

    assert.equal(res.quarantined, 0);
    assert.equal(res.skipped, 1);
    assert.equal(res.results[0].verdict, ELIGIBILITY_VERDICTS.REJECTED_TTL_NOT_EXPIRED);
    assert.equal(fs.existsSync(sessionPath), true);
  });

  it('6. Active UI/Reference Immunity: subagent open in UI is protected', async () => {
    const activeId = 'sub-open-ui';
    const activeFixture = makeSubagentFixture(activeId, { openInUI: true });

    const sessionPath = path.join(sessionsDir, activeId);
    await fs.promises.mkdir(sessionPath, { recursive: true });
    await fs.promises.writeFile(path.join(sessionPath, 'session.json'), JSON.stringify(activeFixture), 'utf8');

    const service = new QuarantineService({ sessionsDir, quarantineDir });
    const res = await service.quarantineBatch([activeFixture], { asOf });

    assert.equal(res.quarantined, 0);
    assert.equal(res.skipped, 1);
    assert.equal(res.results[0].verdict, ELIGIBILITY_VERDICTS.REJECTED_OPEN_IN_UI);
    assert.equal(fs.existsSync(sessionPath), true);
  });

  it('7. Destination Collision Safety: skips and rejects overwrite if target already exists', async () => {
    const colId = 'sub-collision';
    const fixture = makeSubagentFixture(colId);

    const sessionPath = path.join(sessionsDir, colId);
    const targetPath = path.join(quarantineDir, colId);

    await fs.promises.mkdir(sessionPath, { recursive: true });
    await fs.promises.writeFile(path.join(sessionPath, 'session.json'), JSON.stringify(fixture), 'utf8');

    // Pre-create target in quarantine
    await fs.promises.mkdir(targetPath, { recursive: true });
    await fs.promises.writeFile(path.join(targetPath, 'existing.txt'), 'pre-existing', 'utf8');

    const service = new QuarantineService({ sessionsDir, quarantineDir });
    const res = await service.quarantineBatch([fixture], { asOf });

    assert.equal(res.quarantined, 0);
    assert.equal(res.skipped, 1);
    assert.equal(res.results[0].result, 'conflict');

    // Neither was overwritten!
    assert.equal(fs.existsSync(sessionPath), true);
    assert.equal(fs.readFileSync(path.join(targetPath, 'existing.txt'), 'utf8'), 'pre-existing');
  });

  it('8. Path Traversal & Injection Security: invalid session IDs are rejected', async () => {
    const dangerousIds = ['../evil', 'sub/../../etc', 'sub*name', ''];
    const service = new QuarantineService({ sessionsDir, quarantineDir });

    const res = await service.quarantineBatch(dangerousIds, { asOf });
    assert.equal(res.quarantined, 0);
    assert.equal(res.skipped, dangerousIds.length);
    for (const r of res.results) {
      assert.equal(r.result, 'skipped');
      assert.match(r.reason, /Invalid or unsafe session ID/);
    }
  });

  it('9. Zero Physical Purge Guarantee: service exposes no unlink or rm mutation methods', () => {
    const service = new QuarantineService({ sessionsDir, quarantineDir });
    assert.equal(typeof service.purge, 'undefined', 'purge method must not exist');
    assert.equal(typeof service.delete, 'undefined', 'delete method must not exist');
    assert.equal(typeof service.remove, 'undefined', 'remove method must not exist');
    assert.equal(typeof service.unlink, 'undefined', 'unlink method must not exist');
  });

  it('10. Partitioned Workspace Hierarchy: quarantines and restores session located under --workspace--/id', async () => {
    const wsName = '--var-lib-dsh-Project-demo--';
    const subId = 'sub-partitioned-123';
    const fixture = makeSubagentFixture(subId);

    const wsDir = path.join(sessionsDir, wsName);
    const sessionPath = path.join(wsDir, subId);
    await fs.promises.mkdir(sessionPath, { recursive: true });
    await fs.promises.writeFile(path.join(sessionPath, 'session.json'), JSON.stringify(fixture), 'utf8');

    const service = new QuarantineService({ sessionsDir, quarantineDir });
    const res = await service.quarantineBatch([fixture], { asOf });

    assert.equal(res.quarantined, 1);
    assert.equal(fs.existsSync(sessionPath), false);

    const qPath = path.join(quarantineDir, wsName, subId);
    assert.equal(fs.existsSync(qPath), true, 'Must quarantine into mirrored workspace subdirectory');

    // Restore test
    const restoreRes = await service.restoreSessions([subId]);
    assert.deepEqual(restoreRes.restored, [subId]);
    assert.equal(fs.existsSync(sessionPath), true, 'Must restore back to original workspace subdirectory');
    assert.equal(fs.existsSync(qPath), false);
  });

  it('11. Canary Verification: quarantines exactly 5 subagents, leaves root chats immune, and cleanly restores all 5', async () => {
    const wsName = '--var-lib-dsh-Project-canary--';
    const wsDir = path.join(sessionsDir, wsName);
    await fs.promises.mkdir(wsDir, { recursive: true });

    // Create 5 eligible subagents
    const subIds = ['canary-sub-1', 'canary-sub-2', 'canary-sub-3', 'canary-sub-4', 'canary-sub-5'];
    const fixtures = [];
    for (const id of subIds) {
      const fix = makeSubagentFixture(id, { header: { cwd: '/var/lib/dsh/Project/canary' } });
      fixtures.push(fix);
      const sPath = path.join(wsDir, id);
      await fs.promises.mkdir(sPath, { recursive: true });
      await fs.promises.writeFile(path.join(sPath, 'session.json'), JSON.stringify(fix), 'utf8');
      await fs.promises.writeFile(path.join(sPath, 'payload.bin'), Buffer.from([1, 2, 3, 4]));
    }

    // Create 2 root chats (which must remain immune)
    const rootIds = ['canary-root-1', 'canary-root-2'];
    for (const rid of rootIds) {
      const rFix = { header: { id: rid, version: 1, origin: undefined } };
      fixtures.push(rFix);
      const rPath = path.join(wsDir, rid);
      await fs.promises.mkdir(rPath, { recursive: true });
      await fs.promises.writeFile(path.join(rPath, 'session.json'), JSON.stringify(rFix), 'utf8');
    }

    const service = new QuarantineService({ sessionsDir, quarantineDir, holdHours: 72 });

    // 1. Run Quarantine Batch
    const res = await service.quarantineBatch(fixtures, { asOf });
    assert.equal(res.quarantined, 5, 'Exactly 5 subagents must be quarantined');
    assert.equal(res.skipped, 2, '2 root chats must be skipped');

    // 2. Verify files on disk: subagents moved to quarantine, roots untouched
    for (const id of subIds) {
      assert.equal(fs.existsSync(path.join(wsDir, id)), false);
      const qPath = path.join(quarantineDir, wsName, id);
      assert.equal(fs.existsSync(qPath), true);
      assert.deepEqual(fs.readFileSync(path.join(qPath, 'payload.bin')), Buffer.from([1, 2, 3, 4]));
    }
    for (const rid of rootIds) {
      assert.equal(fs.existsSync(path.join(wsDir, rid)), true, 'Root chat must remain in sessions dir');
    }

    // 3. Test Full Rollback / Undo
    const restoreRes = await service.restoreSessions(subIds);
    assert.equal(restoreRes.restored.length, 5);
    assert.equal(restoreRes.failed.length, 0);

    for (const id of subIds) {
      assert.equal(fs.existsSync(path.join(wsDir, id)), true, 'Subagent must be restored back to workspace sessions');
      assert.equal(fs.existsSync(path.join(quarantineDir, wsName, id)), false);
      assert.deepEqual(fs.readFileSync(path.join(wsDir, id, 'payload.bin')), Buffer.from([1, 2, 3, 4]));
    }
  });
});
