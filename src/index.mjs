/**
 * Cordis Plugin Entrypoint for dsh-fleet-cleaner.
 *
 * Implements:
 * - Direct config validation: rawConfig is validated directly; dryRun: false throws ConfigError.
 * - Strict Fail-Closed dryRun protection: POST /quarantine and /restore routes reject with 403 when dryRun is true.
 * - Dynamic DSH Connection integration: verifies browser session dynamically per request
 *   via ctx.connection.requestRejection(req) === undefined. Inherits authenticated session automatically.
 * - Injects ['webServer', 'webRuntime', 'connection'] to guarantee proper Cordis lifecycle ordering.
 * - REST API endpoints under /fleet-cleaner/api/
 *   - GET  /fleet-cleaner/api/stats -> ObservabilitySnapshot
 *   - GET  /fleet-cleaner/api/plan -> RetentionPlan (dryRun: true)
 *   - GET  /fleet-cleaner/api/quarantine/list -> List Quarantined Sessions (read-only)
 *   - POST /fleet-cleaner/api/quarantine -> Move verified candidates to quarantine (Phase 2, rejected if dryRun)
 *   - POST /fleet-cleaner/api/quarantine/restore -> Restore sessions back to active (Phase 2, rejected if dryRun)
 * - Strict operator authentication fence: unauthenticated requests rejected with 401.
 * - Clean lifecycle disposal: unregisters routes from webServer table on dispose.
 */

import { ObservabilityService } from './observability-service.mjs';
import { RetentionPlanner } from './retention-planner.mjs';
import { QuarantineService } from './quarantine-service.mjs';
import { RetentionScheduler } from './retention-scheduler.mjs';
import { createGuardedReadOnlyContext } from './read-only-adapter.mjs';
import { validateConfig } from './types.mjs';

export const name = 'dsh-fleet-cleaner';
export const inject = ['webServer'];

export function writeJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body.trim() ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

export function createFleetCleanerRouter(observabilityService, retentionPlanner, quarantineService = null, config = {}, retentionScheduler = null) {
  const isDryRun = config.dryRun !== false;

  return async function handleFleetCleanerRequest(req, res) {
    // 1. Lifecycle check: if disposed, fail closed
    if (observabilityService?.disposed || retentionPlanner?.disposed) {
      writeJson(res, 503, { ok: false, error: 'Service Unavailable. Plugin is disposed.' });
      return;
    }

    const url = new URL(req.url || '/', 'http://dsh.internal');
    const pathname = url.pathname;

    // 2. HTTP Method check: GET allowed, POST only allowed for quarantine actions
    const isAllowedPost = req.method === 'POST' && (
      pathname === '/fleet-cleaner/api/quarantine' ||
      pathname === '/fleet-cleaner/api/quarantine/restore' ||
      pathname === '/fleet-cleaner/api/scheduler/sweep'
    );

    if (req.method !== 'GET' && !isAllowedPost) {
      writeJson(res, 405, { ok: false, error: 'Method Not Allowed.' });
      return;
    }

    // 3. Authentication fence: strictly verify request authority. Rejects arbitrary tokens!
    const isAuthed = await Promise.resolve(observabilityService.authenticateRequest(req)).catch(() => false);
    if (isAuthed !== true) {
      writeJson(res, 401, { ok: false, error: 'Unauthorized. Valid operator credentials required.' });
      return;
    }

    if (pathname === '/fleet-cleaner/api/stats') {
      try {
        const force = url.searchParams.get('force') === 'true';
        const snapshot = await observabilityService.getSnapshot(force);
        writeJson(res, 200, { ok: true, value: snapshot });
      } catch (err) {
        writeJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    if (pathname === '/fleet-cleaner/api/plan') {
      try {
        const plan = await retentionPlanner.generatePlan();
        writeJson(res, 200, { ok: true, value: plan });
      } catch (err) {
        writeJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    if (pathname === '/fleet-cleaner/api/quarantine/list') {
      if (!quarantineService) {
        writeJson(res, 200, { ok: true, quarantined: [] });
        return;
      }
      try {
        const list = await quarantineService.listQuarantined();
        writeJson(res, 200, { ok: true, quarantined: list });
      } catch (err) {
        writeJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    if (pathname === '/fleet-cleaner/api/quarantine' && req.method === 'POST') {
      // Fail-closed dryRun gate: mutations are forbidden when dryRun is true
      if (isDryRun) {
        writeJson(res, 403, { ok: false, error: 'Forbidden: dsh-fleet-cleaner is operating in dryRun mode. Physical quarantine mutations are disabled.' });
        return;
      }

      if (!quarantineService) {
        writeJson(res, 501, { ok: false, error: 'Quarantine service not available.' });
        return;
      }

      try {
        const body = await readJsonBody(req);
        if (!Array.isArray(body.candidateIds) || body.candidateIds.length === 0) {
          writeJson(res, 400, { ok: false, error: 'candidateIds must be a non-empty array of session IDs.' });
          return;
        }
        const result = await quarantineService.quarantineBatch(body.candidateIds, {
          asOf: body.asOf,
          allowLegacyRc1Subagents: config.allowLegacyRc1Subagents,
        });
        writeJson(res, 200, { ok: true, result });
      } catch (err) {
        writeJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    if (pathname === '/fleet-cleaner/api/quarantine/restore' && req.method === 'POST') {
      // Fail-closed dryRun gate: restore mutations are forbidden when dryRun is true
      if (isDryRun) {
        writeJson(res, 403, { ok: false, error: 'Forbidden: dsh-fleet-cleaner is operating in dryRun mode. Restore mutations are disabled.' });
        return;
      }

      if (!quarantineService) {
        writeJson(res, 501, { ok: false, error: 'Quarantine service not available.' });
        return;
      }

      try {
        const body = await readJsonBody(req);
        if (!Array.isArray(body.sessionIds) || body.sessionIds.length === 0) {
          writeJson(res, 400, { ok: false, error: 'sessionIds must be a non-empty array of session IDs.' });
          return;
        }
        const result = await quarantineService.restoreSessions(body.sessionIds);
        writeJson(res, 200, { ok: true, result });
      } catch (err) {
        writeJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    if (pathname === '/fleet-cleaner/api/scheduler' && req.method === 'GET') {
      if (!retentionScheduler) {
        writeJson(res, 200, { ok: true, value: { running: false, available: false } });
        return;
      }
      writeJson(res, 200, { ok: true, value: retentionScheduler.getStatus() });
      return;
    }

    if (pathname === '/fleet-cleaner/api/scheduler/sweep' && req.method === 'POST') {
      if (!retentionScheduler) {
        writeJson(res, 501, { ok: false, error: 'Scheduler is not available.' });
        return;
      }
      try {
        const result = await retentionScheduler.triggerSweep();
        writeJson(res, 200, { ok: true, value: result });
      } catch (err) {
        writeJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    writeJson(res, 404, { ok: false, error: 'Not Found' });
  };
}

export function apply(ctx, rawConfig = {}) {
  // Direct validation: if caller explicitly passes { dryRun: false }, it throws ConfigError!
  const config = validateConfig(rawConfig);
  const guardedCtx = createGuardedReadOnlyContext(ctx);

  // Dynamic DSH connection session verification: evaluates connection dynamically per request
  const dynamicSessionValidator = config.validateSession || ((req) => {
    try {
      const conn = typeof ctx.get === 'function' ? ctx.get('connection') : ctx.connection;
      if (!conn || typeof conn.requestRejection !== 'function') return false;
      return conn.requestRejection(req) === undefined;
    } catch {
      return false;
    }
  });

  const observabilityService = new ObservabilityService(guardedCtx, {
    operatorTokens: config.operatorTokens,
    operatorToken: config.operatorToken,
    validateSession: dynamicSessionValidator,
  });

  const retentionPlanner = new RetentionPlanner(guardedCtx, config);

  const quarantineService = new QuarantineService({
    sessionsDir: config.sessionsDir,
    quarantineDir: config.quarantineDir,
    projcacheDir: config.projcacheDir,
    holdHours: config.holdHours,
    dryRun: config.dryRun,
  });

  const retentionScheduler = new RetentionScheduler({
    retentionPlanner,
    quarantineService,
    config,
    logger: ctx.logger || console,
  });

  if (config.scheduleIntervalHours > 0) {
    retentionScheduler.start();
  }

  const router = createFleetCleanerRouter(observabilityService, retentionPlanner, quarantineService, config, retentionScheduler);

  let unregisterRoute = null;

  const registerRoutes = (targetWebServer) => {
    if (!targetWebServer || typeof targetWebServer.register !== 'function') return () => {};
    const unregister = targetWebServer.register({
      kind: 'prefix',
      path: '/fleet-cleaner/api',
      handler: router,
    });
    return typeof unregister === 'function' ? unregister : () => {};
  };

  const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : ctx.webServer;
  if (webServer) {
    unregisterRoute = registerRoutes(webServer);
  } else if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (serverCtx) => {
      const injectedServer = typeof serverCtx.get === 'function' ? serverCtx.get('webServer') : serverCtx.webServer;
      unregisterRoute = registerRoutes(injectedServer);
      serverCtx.effect?.(() => () => {
        try {
          if (typeof unregisterRoute === 'function') {
            unregisterRoute();
            unregisterRoute = null;
          }
        } catch {}
      });
    });
  }

  ctx.effect?.(() => () => {
    try {
      if (typeof unregisterRoute === 'function') {
        unregisterRoute();
        unregisterRoute = null;
      }
    } catch {}
    retentionScheduler.stop();
    observabilityService.dispose();
    retentionPlanner.dispose();
  });

  return {
    observabilityService,
    retentionPlanner,
    quarantineService,
    retentionScheduler,
    unregister: () => {
      if (typeof unregisterRoute === 'function') {
        unregisterRoute();
        unregisterRoute = null;
      }
    }
  };
}
