/**
 * Read-Only Guarded Source Adapter.
 *
 * BOUNDARY STATEMENT:
 * This adapter is an in-process cooperation/contract assertion guard against accidental
 * internal mutation calls.
 * IT IS NOT AN OS-LEVEL, KERNEL-LEVEL, OR PROCESS-ISOLATION SECURITY SANDBOX.
 *
 * Enforces:
 * - Safe optional service resolution via ctx.get() conforming to Cordis v4 inject rules.
 * - Narrow allowlist reading interface: exposes only required non-mutating query methods (listSessions, isPathAuthorized).
 * - observeSession is intentionally excluded from the adapter to prevent resource lease and cloning bugs.
 * - Returned listing records and domain records are deeply detached and frozen (Object.freeze)
 *   preventing in-memory mutation.
 * - Calling prohibited mutation methods throws ReadOnlyViolationError immediately.
 */

export class ReadOnlyViolationError extends Error {
  constructor(operation) {
    super(`dsh-fleet-cleaner [ReadOnlyViolation]: Attempted mutation operation "${operation}" in Phase 1 read-only mode.`);
    this.name = 'ReadOnlyViolationError';
  }
}

const FORBIDDEN_STORAGE_MUTATIONS = new Set([
  'put', 'delete', 'update', 'drop', 'clear', 'truncate', 'write', 'batch', 'commit'
]);

const FORBIDDEN_FS_MUTATIONS = new Set([
  'unlink', 'rm', 'rmdir', 'rename', 'writeFile', 'truncate', 'appendFile', 'copyFile', 'chmod', 'chown'
]);

export function deepFreeze(obj) {
  if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    deepFreeze(obj[key]);
  }
  return obj;
}

function getService(ctx, name) {
  if (!ctx || typeof ctx !== 'object') return undefined;
  if (typeof ctx.get === 'function') {
    try {
      return ctx.get(name);
    } catch {
      return undefined;
    }
  }
  return ctx[name];
}

function createGuardedTableHandle(rawTable, tableName) {
  if (!rawTable || typeof rawTable !== 'object') return rawTable;
  return {
    name: tableName,
    get: (...args) => {
      const rec = rawTable.get?.(...args);
      return rec ? deepFreeze(structuredClone(rec)) : rec;
    },
    put: () => { throw new ReadOnlyViolationError(`storageDomain.table("${tableName}").put`); },
    delete: () => { throw new ReadOnlyViolationError(`storageDomain.table("${tableName}").delete`); },
    update: () => { throw new ReadOnlyViolationError(`storageDomain.table("${tableName}").update`); },
  };
}

export function createGuardedReadOnlyContext(rawCtx = {}) {
  const sessionQuery = getService(rawCtx, 'sessionQuery');
  const workspaces = getService(rawCtx, 'workspaces');
  const storageDomain = getService(rawCtx, 'storageDomain');

  return {
    // Narrow allowlist: listSessions only. observeSession intentionally omitted.
    sessionQuery: sessionQuery ? {
      listSessions: async (...args) => {
        const list = await sessionQuery.listSessions?.(...args);
        return list ? deepFreeze(structuredClone(list)) : list;
      },
      observeSession: undefined,
    } : undefined,

    workspaces: workspaces ? {
      isPathAuthorized: workspaces.isPathAuthorized?.bind(workspaces),
    } : undefined,

    // Guarded storageDomain: traps root mutations, returns guarded table handles
    storageDomain: storageDomain ? {
      table: (tableName) => {
        const rawTable = storageDomain.table?.(tableName);
        return createGuardedTableHandle(rawTable, tableName);
      },
      open: async (...args) => {
        const rawDomain = await storageDomain.open?.(...args);
        return {
          table: (tName) => createGuardedTableHandle(rawDomain?.table?.(tName), tName),
          close: () => rawDomain?.close?.(),
        };
      },
      put: () => { throw new ReadOnlyViolationError('storageDomain.put'); },
      delete: () => { throw new ReadOnlyViolationError('storageDomain.delete'); },
      update: () => { throw new ReadOnlyViolationError('storageDomain.update'); },
      drop: () => { throw new ReadOnlyViolationError('storageDomain.drop'); },
    } : undefined,

    // Trapped fs facade
    fs: new Proxy({}, {
      get(_target, prop) {
        if (typeof prop === 'string' && FORBIDDEN_FS_MUTATIONS.has(prop)) {
          throw new ReadOnlyViolationError(`fs.${prop}`);
        }
        return () => { throw new ReadOnlyViolationError(`fs.${String(prop)}`); };
      }
    })
  };
}
