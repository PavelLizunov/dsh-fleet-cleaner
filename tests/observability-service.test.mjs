import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ObservabilityService, LifecycleDisposedError } from '../src/observability-service.mjs';

describe('ObservabilityService Tests', () => {

  it('1. Collects valid memory metrics in exact bytes', async () => {
    const mockCtx = {
      sessionQuery: {
        listSessions: async () => [
          { header: { id: 'root', version: 1, origin: undefined } },
          { header: { id: 'sub-1', version: 1, origin: 'subagent' }, live: true, running: true },
          { header: { id: 'sub-2', version: 1, origin: 'subagent' }, live: false, running: false },
          { header: { id: 'legacy', version: 0 } },
        ]
      }
    };

    const service = new ObservabilityService(mockCtx, { ttlMs: 1000 });
    const snapshot = await service.getSnapshot();

    assert.equal(snapshot.fromCache, false);
    assert.equal(snapshot.stale, false);
    assert.ok(snapshot.sampledAt > 0);

    // Memory in bytes
    assert.ok(Number.isSafeInteger(snapshot.memory.rssBytes) && snapshot.memory.rssBytes > 0);
    assert.ok(Number.isSafeInteger(snapshot.memory.nodeHeapUsedBytes) && snapshot.memory.nodeHeapUsedBytes > 0);
    assert.ok(Number.isSafeInteger(snapshot.memory.nodeHeapTotalBytes) && snapshot.memory.nodeHeapTotalBytes > 0);

    // Session counts
    assert.equal(snapshot.sessions.totalCount, 4);
    assert.equal(snapshot.sessions.userChatSessions, 1);
    assert.equal(snapshot.sessions.runningSubagents, 1);
    assert.equal(snapshot.sessions.dormantSubagents, 1);
    assert.equal(snapshot.sessions.unknownRecords, 1);

    // Browser metrics
    assert.ok(typeof snapshot.browsers.playwrightProcesses === 'number');
    assert.ok(typeof snapshot.browsers.nekoProcesses === 'number');
    assert.ok(typeof snapshot.browsers.unconfirmed === 'boolean');
  });

  it('2. TTL Cache: subsequent calls return fromCache: true and stale: false within TTL window', async () => {
    const mockCtx = { sessionQuery: { listSessions: async () => [] } };
    const service = new ObservabilityService(mockCtx, { ttlMs: 200 });

    const snap1 = await service.getSnapshot();
    assert.equal(snap1.fromCache, false);
    assert.equal(snap1.stale, false);

    // Immediate second call: fresh cache hit (fromCache=true, stale=false)
    const snap2 = await service.getSnapshot();
    assert.equal(snap2.fromCache, true);
    assert.equal(snap2.stale, false);
    assert.equal(snap1.sampledAt, snap2.sampledAt, 'sampledAt must remain the original sample timestamp');

    // Wait past TTL expiry (250ms)
    await new Promise(r => setTimeout(r, 250));

    // Next call fetches fresh snapshot
    const snap3 = await service.getSnapshot();
    assert.equal(snap3.fromCache, false);
    assert.equal(snap3.stale, false);
    assert.ok(snap3.sampledAt > snap1.sampledAt);
  });

  it('3. Operator authentication fence: strictly rejects fictitious tokens, accepts configured token', async () => {
    const validToken = 'valid-configured-operator-token-32b';
    const service = new ObservabilityService({}, { operatorToken: validToken });

    // Missing or invalid
    assert.equal(await service.authenticateRequest(null), false);
    assert.equal(await service.authenticateRequest({ headers: {} }), false);
    assert.equal(await service.authenticateRequest({ headers: { authorization: 'Basic 123' } }), false);

    // Fictitious / unconfigured token -> STRICTLY REJECTED!
    assert.equal(await service.authenticateRequest({ headers: { authorization: 'Bearer fictitious-random-token-here' } }), false);

    // Valid configured operator token -> ACCEPTED!
    assert.equal(await service.authenticateRequest({ headers: { authorization: `Bearer ${validToken}` } }), true);
  });

  it('4. Fallback on collection error returns cached snapshot with stale: true', async () => {
    const mockCtx = {
      _testShouldFail: false,
      sessionQuery: { listSessions: async () => [] }
    };
    const service = new ObservabilityService(mockCtx, { ttlMs: 50 });

    // Initial valid collection
    const snap1 = await service.getSnapshot();
    assert.equal(snap1.stale, false);

    // Expire TTL
    await new Promise(r => setTimeout(r, 70));
    mockCtx._testShouldFail = true;

    // Call after failure: falls back to cached snapshot with stale: true!
    const snapFallback = await service.getSnapshot();
    assert.equal(snapFallback.fromCache, true);
    assert.equal(snapFallback.stale, true);
    assert.equal(snapFallback.collectionError, 'Storage collection failed');
    assert.equal(snapFallback.sampledAt, snap1.sampledAt);
  });

  it('5. Dispose rejects calls with LifecycleDisposedError', async () => {
    const service = new ObservabilityService({});
    service.dispose();
    await assert.rejects(() => service.getSnapshot(), LifecycleDisposedError);
  });
});
