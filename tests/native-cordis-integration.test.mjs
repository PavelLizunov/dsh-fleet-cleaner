process.env.NODE_ENV = 'development';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as FleetCleanerPlugin from '../src/index.mjs';
import { importRuntime } from './helpers/runtime-resolver.mjs';
import { createFleetCleanerHudView } from '../src/FleetCleanerHud.js';

// Preflight prerequisites at TOP LEVEL:
// If runtime prerequisites fail to resolve, top-level await fails fast with exit code 1
const { Context } = await importRuntime('@deepseek-ai/cordis');
const WebServerModule = await importRuntime('@deepseek-ai/dsh-host-webserver');
const WebServer = WebServerModule.default || WebServerModule.WebServer;
const ReactModule = await importRuntime('react');
const React = ReactModule.default || ReactModule;
const { act } = ReactModule;
const ReactDOMServerModule = await importRuntime('react-dom/server');
const ReactDOMServer = ReactDOMServerModule.default || ReactDOMServerModule;
const { createRoot } = await importRuntime('react-dom/client');
const { JSDOM } = await importRuntime('jsdom');

function loadClientModuleRegistration() {
  let registration = null;
  const fakeWindow = {
    __ModuleLoader__: {
      load: (reg) => { registration = reg; }
    }
  };
  const code = fs.readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
  new Function('window', code)(fakeWindow);
  return registration;
}

describe('Real DSH Cordis, WebServer & Browser DOM Integration Tests', () => {

  it('1. Real DSH WebServer: binds socket, registers prefix route, verifies auth, unregisters on dispose', async () => {
    const rootCtx = new Context();
    let serverFork = null;
    let pluginFork = null;

    try {
      // 1. Initialize genuine DSH WebServer on random loopback port
      serverFork = rootCtx.plugin(WebServer, {
        host: '127.0.0.1',
        port: 0,
        compression: 'none'
      });
      await serverFork;

      const boundPort = rootCtx.webServer.port;
      assert.ok(boundPort > 0, 'WebServer must listen on a valid port');

      // 2. Provide mock sessionQuery
      rootCtx.reflect.provide('sessionQuery', {
        listSessions: async () => [
          { header: { id: 'root-1', version: 1, origin: undefined } },
          { header: { id: 'sub-1', version: 1, origin: 'subagent', parentSession: 'root-1', subagentMode: 'one-shot', cwd: '/var/lib/dsh' } }
        ]
      }, () => true);

      const operatorToken = 'test-real-dsh-webserver-token-456';

      // 3. Mount FleetCleanerPlugin into Cordis
      pluginFork = rootCtx.plugin(FleetCleanerPlugin, {
        dryRun: true,
        operatorToken,
        retentionDays: 14,
      });
      await pluginFork;

      // 4. Test real HTTP requests against the real DSH WebServer instance
      const resStats = await fetch(`http://127.0.0.1:${boundPort}/fleet-cleaner/api/stats`, {
        headers: { authorization: `Bearer ${operatorToken}` }
      });
      assert.equal(resStats.status, 200);
      const jsonStats = await resStats.json();
      assert.equal(jsonStats.ok, true);
      assert.ok(jsonStats.value.memory.rssBytes > 0);

      const resUnauth = await fetch(`http://127.0.0.1:${boundPort}/fleet-cleaner/api/stats`, {
        headers: { authorization: 'Bearer bad-token' }
      });
      assert.equal(resUnauth.status, 401);

      const resPlan = await fetch(`http://127.0.0.1:${boundPort}/fleet-cleaner/api/plan`, {
        headers: { authorization: `Bearer ${operatorToken}` }
      });
      assert.equal(resPlan.status, 200);
      const jsonPlan = await resPlan.json();
      assert.equal(jsonPlan.ok, true);
      assert.equal(jsonPlan.value.readOnly, true);
      assert.equal(jsonPlan.value.applicable, false);

      // Phase 3: Scheduler Status & Manual Sweep endpoints
      const resSched = await fetch(`http://127.0.0.1:${boundPort}/fleet-cleaner/api/scheduler`, {
        headers: { authorization: `Bearer ${operatorToken}` }
      });
      assert.equal(resSched.status, 200);
      const jsonSched = await resSched.json();
      assert.equal(jsonSched.ok, true);
      assert.equal(typeof jsonSched.value.running, 'boolean');
      assert.equal(jsonSched.value.dryRun, true);

      const resSweep = await fetch(`http://127.0.0.1:${boundPort}/fleet-cleaner/api/scheduler/sweep`, {
        method: 'POST',
        headers: { authorization: `Bearer ${operatorToken}` }
      });
      assert.equal(resSweep.status, 200);
      const jsonSweep = await resSweep.json();
      assert.equal(jsonSweep.ok, true);
      assert.equal(jsonSweep.value.outcome, 'completed');
      assert.equal(jsonSweep.value.dryRun, true);
      assert.equal(jsonSweep.value.quarantined, 0, 'Zero mutations in dryRun sweep');

      // 5. Dispose plugin fork: verify route unregistration from WebServer
      await pluginFork.dispose();
      pluginFork = null;

      const resAfterDispose = await fetch(`http://127.0.0.1:${boundPort}/fleet-cleaner/api/stats`, {
        headers: { authorization: `Bearer ${operatorToken}` }
      });
      assert.equal(resAfterDispose.status, 404, 'Real WebServer returns 404 when route is unregistered upon dispose');

    } finally {
      if (pluginFork) await pluginFork.dispose();
      if (serverFork) await serverFork.dispose();
    }
  });

  it('2. Pure SSR Benchmark: measures server renderToString duration on pre-computed snapshot (< 50ms)', () => {
    const FleetCleanerHud = createFleetCleanerHudView(React);

    const syntheticSnapshot = {
      sampledAt: Date.now(),
      stale: false,
      fromCache: true,
      memory: {
        rssBytes: 512 * 1024 * 1024,
        memAvailableBytes: 4096 * 1024 * 1024,
      },
      sessions: {
        userChatSessions: 289,
        runningSubagents: 3,
        dormantSubagents: 5135,
        unknownRecords: 39,
      },
      browsers: {
        playwrightProcesses: 0,
        nekoProcesses: 14,
        unconfirmed: false,
      }
    };

    const t0 = performance.now();
    const html = ReactDOMServer.renderToString(
      React.createElement(FleetCleanerHud, {
        initialSnapshot: syntheticSnapshot,
        statsSource: { getSnapshot: () => syntheticSnapshot },
        planSource: {}
      })
    );
    const renderDurationMs = performance.now() - t0;

    assert.ok(html.includes('Fleet &amp; Retention HUD'), 'Must render title');
    assert.ok(html.includes('Chats') && html.includes('289'), 'Must render user chats count');
    assert.ok(html.includes('Active Sub') && html.includes('3'), 'Must render active count');
    assert.ok(html.includes('Node RSS') && html.includes('512 MB'), 'Must render formatted RSS');

    assert.ok(renderDurationMs < 50, `Render duration must be < 50ms, took ${renderDurationMs.toFixed(3)}ms`);
  });

  it('3. Component DOM Test (JSDOM): interactive modal opening & rendering 500 candidate DOM elements', async () => {
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
      url: 'http://127.0.0.1:3080/',
      pretendToBeVisual: true,
    });

    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;

    const FleetCleanerHud = createFleetCleanerHudView(React);
    const container = dom.window.document.getElementById('root');
    const root = createRoot(container);

    const largeCandidates = [];
    for (let i = 0; i < 500; i++) {
      largeCandidates.push({
        sessionId: `sub-heavy-${i}`,
        parentSessionId: 'root-heavy',
        verdict: i % 2 === 0 ? 'ELIGIBLE' : 'REJECTED_TTL_NOT_EXPIRED',
        reason: i % 2 === 0 ? 'All criteria confirmed' : 'TTL not expired',
      });
    }

    const largePlan = {
      policyVersion: '1.0.0',
      asOf: Date.now(),
      status: 'complete',
      truncated: false,
      totalScanned: 500,
      eligibleCount: 250,
      rejectedCount: 250,
      verdictBreakdown: { ELIGIBLE: 250, REJECTED_TTL_NOT_EXPIRED: 250 },
      candidates: largeCandidates,
    };

    const syntheticSnapshot = {
      sampledAt: Date.now(),
      stale: false,
      fromCache: true,
      memory: { rssBytes: 512 * 1024 * 1024, memAvailableBytes: 4096 * 1024 * 1024 },
      sessions: { userChatSessions: 289, runningSubagents: 3, dormantSubagents: 5135, unknownRecords: 39 },
      browsers: { playwrightProcesses: 0, nekoProcesses: 14, unconfirmed: false }
    };

    let planGeneratedCalls = 0;
    const planSource = {
      generatePlan: async () => {
        planGeneratedCalls++;
        return largePlan;
      }
    };

    try {
      // 1. Initial render into DOM
      await act(async () => {
        root.render(React.createElement(FleetCleanerHud, {
          initialSnapshot: syntheticSnapshot,
          statsSource: { getSnapshot: () => syntheticSnapshot },
          planSource
        }));
      });

      assert.ok(container.textContent.includes('Chats: 289'), 'Container must render initial metrics');
      assert.equal(container.textContent.includes('Retention Candidate Audit Plan'), false, 'Modal must NOT be in DOM initially');
      assert.equal(planGeneratedCalls, 0, 'generatePlan must not be called before click');

      // 2. Interactive user click on Plan button in real DOM
      const buttons = container.querySelectorAll('button');
      const planButton = Array.from(buttons).find(b => b.textContent.includes('View Retention Plan'));
      assert.ok(planButton, 'View Retention Plan button must exist in real DOM');

      await act(async () => {
        planButton.click();
      });

      assert.equal(planGeneratedCalls, 1, 'generatePlan must be called exactly once after click');
      assert.ok(container.textContent.includes('Retention Candidate Audit Plan (Read-Only)'), 'Modal overlay must be in DOM after click');

      // 3. Verify all 500 candidate items rendered in real DOM
      const candidateSpans = Array.from(container.querySelectorAll('span')).filter(s => s.textContent.startsWith('sub-heavy-'));
      assert.equal(candidateSpans.length, 500, 'Real DOM must contain all 500 candidate DOM element spans');
      assert.equal(candidateSpans[0].textContent, 'sub-heavy-0', 'First candidate in DOM matches');
      assert.equal(candidateSpans[499].textContent, 'sub-heavy-499', 'Last candidate in DOM matches');

      // 4. Click close button in modal
      const closeButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent.trim() === '✕');
      assert.ok(closeButton, 'Close button must exist in modal DOM');
      await act(async () => {
        closeButton.click();
      });

      assert.equal(container.textContent.includes('Retention Candidate Audit Plan (Read-Only)'), false, 'Modal must be unmounted from DOM after close click');

    } finally {
      await act(async () => {
        root.unmount();
      });
      assert.equal(container.innerHTML, '', 'Container DOM must be empty after unmount');
    }
  });

  it('4. Full End-to-End Composite Chain: DSH WebServer -> Connection auth -> Client ModuleLoader -> HUD HTTP -> DOM -> Dispose', async () => {
    let hostCtx = null;
    let serverFork = null;
    let pluginFork = null;
    let root = null;
    const networkTrace = [];

    try {
      // 1. Host side: Real DSH WebServer + Connection service + sessionQuery
      hostCtx = new Context();
      serverFork = hostCtx.plugin(WebServer, { host: '127.0.0.1', port: 0, compression: 'none' });
      await serverFork;
      const port = hostCtx.webServer.port;

      // Native DSH connection service verifying authenticated operator browser session
      hostCtx.reflect.provide('connection', {
        requestRejection: (req) => {
          const isOperatorCookie = req.headers['cookie']?.includes('dsh_session=operator_session_ticket_valid_123');
          return isOperatorCookie ? undefined : 401;
        }
      }, () => true);

      hostCtx.reflect.provide('sessionQuery', {
        listSessions: async () => [
          { header: { id: 'user-root-chat', version: 1, origin: undefined } },
          { header: { id: 'subagent-e2e-1', version: 1, origin: 'subagent', parentSession: 'user-root-chat', subagentMode: 'one-shot', cwd: '/var/lib/dsh' } }
        ]
      }, () => true);

      // Mount plugin into Host Context (auto-integrates with connection service)
      pluginFork = hostCtx.plugin(FleetCleanerPlugin, { dryRun: true });
      await pluginFork;

      // 2. Client side: JSDOM browser environment with session cookie (no bundled secrets!)
      const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
        url: `http://127.0.0.1:${port}/`,
        pretendToBeVisual: true,
      });

      globalThis.window = dom.window;
      globalThis.document = dom.window.document;
      globalThis.HTMLElement = dom.window.HTMLElement;
      globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;

      // Browser operator session cookie attached to document
      dom.window.document.cookie = 'dsh_session=operator_session_ticket_valid_123; Path=/';

      // Standard browser fetch simulation: attaches same-origin document cookie
      const originalFetch = globalThis.fetch;
      dom.window.fetch = async (url, opts = {}) => {
        const fullUrl = url.startsWith('http') ? url : `http://127.0.0.1:${port}${url}`;
        const headers = { ...(opts.headers || {}) };
        if (opts.credentials === 'same-origin' && dom.window.document.cookie) {
          headers['cookie'] = dom.window.document.cookie;
        }
        const res = await originalFetch(fullUrl, { ...opts, headers });

        const clone = res.clone();
        let bodyJson = null;
        try { bodyJson = await clone.json(); } catch {}

        networkTrace.push({
          timestamp: new Date().toISOString(),
          component: url.includes('plan') ? 'FleetCleanerHud.Modal' : 'FleetCleanerHud',
          method: opts.method || 'GET',
          url,
          status: res.status,
          authType: headers['cookie'] ? 'native-session-cookie' : 'none',
          responseOk: bodyJson ? bodyJson.ok : null,
          payloadSummary: bodyJson ? (bodyJson.ok ? (bodyJson.value?.totalScanned !== undefined ? `totalScanned:${bodyJson.value.totalScanned}` : `rssBytes:${bodyJson.value?.memory?.rssBytes}`) : bodyJson.error) : 'non-json',
        });
        return res;
      };
      globalThis.fetch = dom.window.fetch;

      // 3. Client Module Loader simulation -> registers into BetterSidebar Tab
      let registeredComponent = null;
      let tabUnregistered = false;
      const registeredTabs = new Map();
      const clientCtx = {
        betterSidebar: {
          registerTab: (tab) => {
            registeredTabs.set(tab.id, tab.component);
            registeredComponent = tab.component;
            return () => {
              registeredTabs.delete(tab.id);
              registeredComponent = null;
              tabUnregistered = true;
            };
          }
        },
        effect: (cb) => cb()
      };

      const registration = loadClientModuleRegistration();
      assert.equal(registration.id, 'dsh-fleet-cleaner');
      const clientInstance = registration.factory(() => React);
      assert.deepEqual(clientInstance.inject, ['betterSidebar']);
      const tabDisposer = clientInstance.apply(clientCtx);

      assert.ok(registeredTabs.has('fleet-cleaner'), 'HUD must be registered as BetterSidebar tab');
      assert.equal(typeof registeredComponent, 'function');

      // 4. Mount HUD into DOM without initialSnapshot or local doubles -> triggers live HTTP /stats
      const container = dom.window.document.getElementById('root');
      root = createRoot(container);

      await act(async () => {
        root.render(React.createElement(registeredComponent, { visible: true }));
      });

      // Await live HTTP fetch and React state update
      await act(async () => {
        await new Promise(r => setTimeout(r, 120));
      });

      assert.ok(container.textContent.includes('Chats: 1'), 'DOM must reflect live user chat count from WebServer');
      assert.ok(container.textContent.includes('Dormant: 1'), 'DOM must reflect dormant subagent count from WebServer');
      assert.ok(container.textContent.includes('Node RSS:'), 'DOM must render live Node RSS from WebServer');

      // 5. Negative check: unauthenticated request without cookie receives 401
      const resUnauth = await originalFetch(`http://127.0.0.1:${port}/fleet-cleaner/api/stats`, {
        headers: {}
      });
      assert.equal(resUnauth.status, 401, 'Unauthenticated browser request without credentials must receive 401');
      networkTrace.push({
        timestamp: new Date().toISOString(),
        component: 'UnauthenticatedNegativeProbe',
        method: 'GET',
        url: '/fleet-cleaner/api/stats',
        status: 401,
        authType: 'none',
        responseOk: false,
        payloadSummary: 'Unauthorized. Valid operator credentials required.',
      });

      // 6. Interactive click on plan button -> triggers live HTTP /plan from WebServer
      const planBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('View Retention Plan'));
      assert.ok(planBtn, 'Plan button must be present in live DOM');

      await act(async () => {
        planBtn.click();
      });

      // Await live HTTP plan fetch and React state update
      await act(async () => {
        await new Promise(r => setTimeout(r, 120));
      });

      assert.ok(container.textContent.includes('Retention Candidate Audit Plan (Read-Only)'), 'Modal overlay must be in DOM after live plan fetch');
      assert.ok(container.textContent.includes('Total Scanned: 2'), 'Modal must render Total Scanned: 2 from live WebServer');
      assert.ok(container.textContent.includes('subagent-e2e-1'), 'Candidate subagent-e2e-1 must be rendered in DOM');

      // 7. Verify Unmount & Cleanup: no timer requests after unmount
      const traceCountBeforeUnmount = networkTrace.length;
      await act(async () => {
        root.unmount();
      });
      root = null;

      // Wait 100ms to ensure interval timer was cleared on unmount
      await new Promise(r => setTimeout(r, 100));
      assert.equal(networkTrace.length, traceCountBeforeUnmount, 'No further timer requests should be made after unmount');

      // Unregister client tab
      tabDisposer();
      assert.equal(tabUnregistered, true, 'Tab must be cleanly unregistered');
      assert.equal(registeredTabs.size, 0);

      // Dispose plugin
      await pluginFork.dispose();
      pluginFork = null;

      // Route must return 404 after plugin dispose
      const res404 = await originalFetch(`http://127.0.0.1:${port}/fleet-cleaner/api/stats`, {
        headers: { cookie: 'dsh_session=operator_session_ticket_valid_123' }
      });
      assert.equal(res404.status, 404, 'WebServer returns 404 once plugin is disposed');

    } finally {
      if (root) {
        await act(async () => { root.unmount(); });
      }
      if (pluginFork) await pluginFork.dispose();
      if (serverFork) await serverFork.dispose();
    }
  });

  it('5. Authorization Fail-Closed Guarantee: missing connection service strictly fails closed with 401', async () => {
    const rootCtx = new Context();
    let serverFork = null;
    let pluginFork = null;

    try {
      serverFork = rootCtx.plugin(WebServer, { host: '127.0.0.1', port: 0, compression: 'none' });
      await serverFork;
      const port = rootCtx.webServer.port;

      pluginFork = rootCtx.plugin(FleetCleanerPlugin, { dryRun: true });
      await pluginFork;

      const res = await fetch(`http://127.0.0.1:${port}/fleet-cleaner/api/stats`, {
        headers: { cookie: 'dsh_session=some_unverified_cookie' }
      });
      assert.equal(res.status, 401, 'Missing connection service must fail closed with 401');

    } finally {
      if (pluginFork) await pluginFork.dispose();
      if (serverFork) await serverFork.dispose();
    }
  });

  it('6. Hook/Element Double Validation: validates modal opening & candidate count in headless non-DOM environment', async () => {
    function createHookElementDouble() {
      const stateMap = new Map();
      let stateIndex = 0;

      const doubleReact = {
        createElement: (type, props, ...children) => {
          const flat = children.flat();
          return { type, props, key: props?.key, children: flat };
        },
        useState: (initial) => {
          const idx = stateIndex++;
          if (!stateMap.has(idx)) {
            stateMap.set(idx, initial);
          }
          const val = stateMap.get(idx);
          const setter = (nextVal) => {
            const resolved = typeof nextVal === 'function' ? nextVal(stateMap.get(idx)) : nextVal;
            stateMap.set(idx, resolved);
          };
          return [val, setter];
        },
        useEffect: () => {},
      };

      const render = (Component, props) => {
        stateIndex = 0;
        return Component(props);
      };

      return { doubleReact, render };
    }

    const { doubleReact, render } = createHookElementDouble();
    const FleetCleanerHud = createFleetCleanerHudView(doubleReact);

    let generatePlanCalls = 0;
    const largeCandidates = [];
    for (let i = 0; i < 500; i++) {
      largeCandidates.push({
        sessionId: `sub-heavy-${i}`,
        parentSessionId: 'root-heavy',
        verdict: i % 2 === 0 ? 'ELIGIBLE' : 'REJECTED_TTL_NOT_EXPIRED',
        reason: i % 2 === 0 ? 'All criteria confirmed' : 'TTL not expired',
      });
    }

    const planSource = {
      generatePlan: async () => {
        generatePlanCalls++;
        return {
          policyVersion: '1.0.0',
          asOf: 1788000000000,
          status: 'complete',
          truncated: false,
          totalScanned: 500,
          eligibleCount: 250,
          rejectedCount: 250,
          verdictBreakdown: { ELIGIBLE: 250, REJECTED_TTL_NOT_EXPIRED: 250 },
          candidates: largeCandidates,
        };
      }
    };

    const initialSnapshot = {
      memory: { rssBytes: 100 * 1024 * 1024 },
      sessions: { userChatSessions: 289 },
      browsers: {},
    };

    const initialVNode = render(FleetCleanerHud, { initialSnapshot, statsSource: {}, planSource });
    assert.equal(generatePlanCalls, 0);

    const planBtn = initialVNode.children.find(c => c?.key === 'plan-btn');
    await planBtn.props.onClick();
    assert.equal(generatePlanCalls, 1);

    const openVNode = render(FleetCleanerHud, { initialSnapshot, statsSource: {}, planSource });
    const modalOpen = openVNode.children.find(c => c?.key === 'modal-overlay');
    assert.ok(modalOpen);

    const modalContent = modalOpen.children.find(c => c?.key === 'modal-content');
    const planDetails = modalContent.children.find(c => c?.key === 'plan-details');
    const candidateList = planDetails.children.find(c => c?.key === 'candidate-list');

    const candidateRows = candidateList.children.filter(c => c?.key && c.key.startsWith('sub-heavy-'));
    assert.equal(candidateRows.length, 500);
    assert.equal(candidateRows[0].key, 'sub-heavy-0');
    assert.equal(candidateRows[499].key, 'sub-heavy-499');
  });

  it('7. Client Module Lifecycle: strict fail-fast on missing React, registers BetterSidebar tab, unregisters on disposer', () => {
    const registration = loadClientModuleRegistration();
    assert.equal(registration.id, 'dsh-fleet-cleaner');

    // 1. Strict Fail-Fast: missing React throws TypeError
    assert.throws(
      () => registration.factory(() => null),
      TypeError
    );

    let registeredTabId = null;
    let registeredComponent = null;
    let unregisterCalls = 0;

    const mockClientCtx = {
      betterSidebar: {
        registerTab: (tab) => {
          registeredTabId = tab.id;
          registeredComponent = tab.component;
          return () => {
            unregisterCalls++;
            registeredTabId = null;
            registeredComponent = null;
          };
        }
      }
    };

    // 2. Client factory execution with valid React
    const clientInstance = registration.factory(() => React);
    assert.equal(typeof clientInstance.apply, 'function');
    assert.deepEqual(clientInstance.inject, ['betterSidebar']);

    // Apply registers BetterSidebar Tab
    const disposer = clientInstance.apply(mockClientCtx);
    assert.equal(registeredTabId, 'fleet-cleaner');
    assert.equal(typeof registeredComponent, 'function');
    assert.equal(typeof disposer, 'function');

    // Calling disposer unregisters tab
    disposer();
    assert.equal(registeredTabId, null);
    assert.equal(unregisterCalls, 1);
  });
});
