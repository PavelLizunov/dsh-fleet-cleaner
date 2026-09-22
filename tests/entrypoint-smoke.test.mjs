import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { apply, name, inject } from '../src/index.mjs';
import { ConfigError } from '../src/types.mjs';

describe('Cordis Entrypoint & HTTP Smoke Tests (public apply -> router)', () => {

  it('1. Directly rejects config with dryRun: false via apply()', () => {
    assert.throws(
      () => apply({}, { dryRun: false }),
      ConfigError
    );
  });

  it('2. Passes operatorToken from apply config to router and verifies Bearer auth', async () => {
    const validToken = 'secret-operator-token-32b';
    let routerHandler = null;
    const mockCtx = {
      webServer: { register: (r) => { routerHandler = r.handler; } },
      sessionQuery: { listSessions: async () => [] },
      effect: (cb) => cb(),
    };

    apply(mockCtx, { dryRun: true, operatorToken: validToken });

    // Request with fictitious token -> MUST RETURN 401!
    let statusFictitious = null;
    await routerHandler(
      { method: 'GET', url: '/fleet-cleaner/api/stats', headers: { authorization: 'Bearer fictitious-random-string' } },
      { writeHead: (s) => { statusFictitious = s; }, end: () => {} }
    );
    assert.equal(statusFictitious, 401, 'Fictitious token must be rejected with 401');

    // Request with valid configured token -> MUST RETURN 200!
    let statusValid = null;
    let bodyValid = null;
    await routerHandler(
      { method: 'GET', url: '/fleet-cleaner/api/stats', headers: { authorization: `Bearer ${validToken}` } },
      { writeHead: (s) => { statusValid = s; }, end: (d) => { bodyValid = JSON.parse(d); } }
    );
    assert.equal(statusValid, 200, 'Configured operator token must return 200');
    assert.equal(bodyValid.ok, true);
  });

  it('3. Async validateSession returning false is rejected with 401 (not truthy Promise)', async () => {
    let routerHandler = null;
    const mockCtx = {
      webServer: { register: (r) => { routerHandler = r.handler; } },
      effect: (cb) => cb(),
    };

    // Async validator that explicitly resolves false
    apply(mockCtx, {
      dryRun: true,
      validateSession: async () => false
    });

    let status = null;
    await routerHandler(
      { method: 'GET', url: '/fleet-cleaner/api/stats', headers: { cookie: 'dsh_session=fake' } },
      { writeHead: (s) => { status = s; }, end: () => {} }
    );
    assert.equal(status, 401, 'async () => false must be rejected with 401, not evaluated as truthy Promise');
  });

  it('4. Host 127.0.0.1 alone without same-origin credentials does not grant access', async () => {
    let routerHandler = null;
    const mockCtx = {
      webServer: { register: (r) => { routerHandler = r.handler; } },
      effect: (cb) => cb(),
    };

    apply(mockCtx, { dryRun: true });

    let status = null;
    await routerHandler(
      { method: 'GET', url: '/fleet-cleaner/api/stats', headers: { host: '127.0.0.1:3080' } }, // No sec-fetch-site, no origin, no credentials
      { writeHead: (s) => { status = s; }, end: () => {} }
    );
    assert.equal(status, 401, 'Host alone without verified same-origin or credentials must fail closed');
  });
});
