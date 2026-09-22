import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGuardedReadOnlyContext, ReadOnlyViolationError } from '../src/read-only-adapter.mjs';

describe('ReadOnlyAdapter Boundary & Handle Trapping Tests', () => {

  it('1. Traps direct storageDomain mutation methods', () => {
    const rawCtx = {
      storageDomain: {
        delete: () => {},
        put: () => {},
        update: () => {},
        drop: () => {},
      }
    };
    const guarded = createGuardedReadOnlyContext(rawCtx);

    assert.throws(() => guarded.storageDomain.delete('id'), ReadOnlyViolationError);
    assert.throws(() => guarded.storageDomain.put('id', {}), ReadOnlyViolationError);
    assert.throws(() => guarded.storageDomain.update('id', () => {}), ReadOnlyViolationError);
    assert.throws(() => guarded.storageDomain.drop(), ReadOnlyViolationError);
  });

  it('2. Traps returned table handles from storageDomain.table(name)', () => {
    const mockTable = {
      name: 'sessions',
      get: (id) => ({ id, data: 'read-ok' }),
      delete: () => { throw new Error('Raw delete must not be reached'); },
      put: () => { throw new Error('Raw put must not be reached'); },
      update: () => { throw new Error('Raw update must not be reached'); },
    };

    const rawCtx = {
      storageDomain: {
        table: (tableName) => mockTable,
      }
    };

    const guarded = createGuardedReadOnlyContext(rawCtx);
    const tableHandle = guarded.storageDomain.table('sessions');

    // Read method passes through cleanly
    assert.deepEqual(tableHandle.get('s1'), { id: 's1', data: 'read-ok' });

    // Mutation methods on the returned handle throw ReadOnlyViolationError
    assert.throws(() => tableHandle.delete('s1'), ReadOnlyViolationError);
    assert.throws(() => tableHandle.put('s1', {}), ReadOnlyViolationError);
    assert.throws(() => tableHandle.update('s1', () => {}), ReadOnlyViolationError);
  });

  it('3. Traps fs mutations (unlink, rm, rename, writeFile, truncate)', () => {
    const guarded = createGuardedReadOnlyContext({});

    assert.throws(() => guarded.fs.unlink('/path/file'), ReadOnlyViolationError);
    assert.throws(() => guarded.fs.rm('/path/dir', { recursive: true }), ReadOnlyViolationError);
    assert.throws(() => guarded.fs.rename('/path/a', '/path/b'), ReadOnlyViolationError);
    assert.throws(() => guarded.fs.writeFile('/path/f', 'data'), ReadOnlyViolationError);
    assert.throws(() => guarded.fs.truncate('/path/f'), ReadOnlyViolationError);
  });
});
