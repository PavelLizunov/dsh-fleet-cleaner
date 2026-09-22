import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createFleetCleanerHudView } from '../src/FleetCleanerHud.js';

function extractText(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node) return '';
  if (Array.isArray(node)) return node.map(extractText).join(' ');
  if (node.children) return extractText(node.children);
  return '';
}

describe('FleetCleanerHud Error Handling & Rendering Tests', () => {

  const mockReact = {
    createElement: (type, props, ...children) => {
      const flat = children.flat();
      return { type, props, children: flat };
    },
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: (effect, deps) => {},
    useCallback: (fn) => fn,
  };

  it('1. Exports createFleetCleanerHudView factory cleanly', () => {
    assert.equal(typeof createFleetCleanerHudView, 'function');
    const component = createFleetCleanerHudView(mockReact);
    assert.equal(typeof component, 'function');
  });

  it('2. Gracefully handles HTTP 500 in stats fetch without throwing or crashing', () => {
    const testReact = {
      createElement: (type, props, ...children) => ({ type, props, children: children.flat() }),
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect: (fn) => {},
      useCallback: (fn) => fn,
    };

    const HudComponent = createFleetCleanerHudView(testReact);
    const failingStatsSource = {
      getSnapshot: async () => { throw new Error('HTTP 500: Internal Server Error'); }
    };

    assert.doesNotThrow(() => {
      HudComponent({ statsSource: failingStatsSource, planSource: {} });
    });
  });

  it('3. Renders unknown/null counters as N/A, never false zeroes', () => {
    const snapshotWithNulls = {
      memory: { rssBytes: 100 * 1024 * 1024, memAvailableBytes: null },
      sessions: { userChatSessions: null, runningSubagents: null, dormantSubagents: null, unknownRecords: null },
      browsers: { playwrightProcesses: 0, nekoProcesses: 0, unconfirmed: false },
      fromCache: false,
      stale: false,
    };

    const testReact = {
      createElement: (type, props, ...children) => ({ type, props, children: children.flat() }),
      useState: (initial) => [typeof initial === 'function' ? initial() : (initial === null ? snapshotWithNulls : initial), () => {}],
      useEffect: () => {},
      useCallback: (fn) => fn,
    };

    const HudComponent = createFleetCleanerHudView(testReact);
    const vnode = HudComponent({ statsSource: {}, planSource: {} });

    // Inspect grid children for N/A
    const grid = vnode.children.find(c => c?.props?.key === 'grid');
    assert.ok(grid);
    const chatsDiv = grid.children.find(c => c?.props?.key === 'sessions');
    const unknownDiv = grid.children.find(c => c?.props?.key === 'unknown');
    assert.match(extractText(chatsDiv), /N\/A/);
    assert.match(extractText(unknownDiv), /N\/A/);
  });

  it('4. Handles null or empty plan without crashing on plan.policyVersion', () => {
    const testReact = {
      createElement: (type, props, ...children) => ({ type, props, children: children.flat() }),
      useState: (initial) => {
        if (typeof initial === 'boolean') return [true, () => {}];
        return [typeof initial === 'function' ? initial() : initial, () => {}];
      },
      useEffect: () => {},
      useCallback: (fn) => fn,
    };

    const HudComponent = createFleetCleanerHudView(testReact);
    assert.doesNotThrow(() => {
      HudComponent({ statsSource: {}, planSource: {} });
    });
  });

  it('5. Renders stats error banner when subsequent poll fails after snapshot exists', () => {
    const existingSnapshot = {
      memory: { rssBytes: 50 * 1024 * 1024 },
      sessions: { userChatSessions: 10 },
      browsers: {},
    };

    let stateCalls = 0;
    const testReact = {
      createElement: (type, props, ...children) => ({ type, props, children: children.flat() }),
      useState: (initial) => {
        stateCalls++;
        if (stateCalls === 1) return ['en', () => {}]; // lang
        if (stateCalls === 2) return [existingSnapshot, () => {}]; // snapshot
        if (stateCalls === 3) return ['Connection refused (HTTP 502)', () => {}]; // statsError
        return [initial, () => {}];
      },
      useEffect: () => {},
      useCallback: (fn) => fn,
    };

    const HudComponent = createFleetCleanerHudView(testReact);
    const vnode = HudComponent({ statsSource: {}, planSource: {} });

    // Error banner MUST be present even though snapshot is populated!
    const banner = vnode.children.find(c => c?.props?.key === 'update-error-banner');
    assert.ok(banner, 'Update error banner must be rendered');
    assert.match(extractText(banner), /Update Error.*Connection refused/);
  });
});
