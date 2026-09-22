import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCandidate } from '../src/eligibility.mjs';
import { ELIGIBILITY_VERDICTS } from '../src/types.mjs';

describe('Systematic Eligibility Mutation Matrix (Every Field Removal Tested)', () => {
  const asOf = 1788000000000;
  const retentionDays = 14;
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  const validCompletedAt = asOf - retentionMs - 5000; // Passed TTL

  function createValidBase() {
    return {
      header: {
        id: 'sub-baseline',
        version: 1,
        origin: 'subagent',
        parentSession: 'root-main',
        subagentMode: 'one-shot',
        cwd: '/var/lib/dsh/Project/app',
      },
      settlement: {
        status: 'settled',
        completedAt: validCompletedAt,
        runAttempt: 'attempt-1',
      },
      lastDurableActivityAt: validCompletedAt,
      receipt: {
        receiptId: 'rcpt-baseline-001',
        childSessionId: 'sub-baseline',
        runAttempt: 'attempt-1',
      },
      references: {
        runningDescendantsCount: 0,
        hasActiveContinuation: false,
        hasPendingRetry: false,
        activeReadersCount: 0,
        activeWritersCount: 0,
      },
      openInUI: false,
    };
  }

  it('Baseline is 100% ELIGIBLE', () => {
    const base = createValidBase();
    const res = evaluateCandidate(base, asOf, retentionDays);
    assert.equal(res.verdict, ELIGIBILITY_VERDICTS.ELIGIBLE);
  });

  const matrix = [
    {
      name: 'Missing header',
      mutate: (e) => { delete e.header; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE
    },
    {
      name: 'Empty header ID',
      mutate: (e) => { e.header.id = ''; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE
    },
    {
      name: 'Header version is 0',
      mutate: (e) => { e.header.version = 0; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_UNSUPPORTED_VERSION
    },
    {
      name: 'Header version is string "0"',
      mutate: (e) => { e.header.version = "0"; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_UNSUPPORTED_VERSION
    },
    {
      name: 'Header version is negative -1',
      mutate: (e) => { e.header.version = -1; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_UNSUPPORTED_VERSION
    },
    {
      name: 'Header version is float 1.5',
      mutate: (e) => { e.header.version = 1.5; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_UNSUPPORTED_VERSION
    },
    {
      name: 'Origin is undefined',
      mutate: (e) => { delete e.header.origin; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_NON_SUBAGENT
    },
    {
      name: 'Origin is user (root session)',
      mutate: (e) => { e.header.origin = 'user'; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_NON_SUBAGENT
    },
    {
      name: 'parentSession missing',
      mutate: (e) => { delete e.header.parentSession; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE
    },
    {
      name: 'parentSession empty string',
      mutate: (e) => { e.header.parentSession = '   '; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE
    },
    {
      name: 'subagentMode is continuable',
      mutate: (e) => { e.header.subagentMode = 'continuable'; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_NON_ONESHOT
    },
    {
      name: 'subagentMode is missing and unproven',
      mutate: (e) => { delete e.header.subagentMode; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_NON_ONESHOT
    },
    {
      name: 'Settlement status is running',
      mutate: (e) => { e.settlement.status = 'running'; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_NOT_TERMINAL
    },
    {
      name: 'Settlement is missing',
      mutate: (e) => { delete e.settlement; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_NOT_TERMINAL
    },
    {
      name: 'completedAt is missing',
      mutate: (e) => { delete e.settlement.completedAt; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE
    },
    {
      name: 'lastDurableActivityAt is missing',
      mutate: (e) => { delete e.lastDurableActivityAt; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE
    },
    {
      name: 'Activity was recent (TTL not expired)',
      mutate: (e) => { e.lastDurableActivityAt = asOf - 1000; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_TTL_NOT_EXPIRED
    },
    {
      name: 'Receipt missing',
      mutate: (e) => { delete e.receipt; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_MISSING_RECEIPT
    },
    {
      name: 'Receipt childId mismatch',
      mutate: (e) => { e.receipt.childSessionId = 'other-subagent'; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_MISSING_RECEIPT
    },
    {
      name: 'Receipt runAttempt missing while settlement has runAttempt',
      mutate: (e) => { delete e.receipt.runAttempt; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_MISSING_RECEIPT
    },
    {
      name: 'Settlement runAttempt missing while receipt has runAttempt',
      mutate: (e) => { delete e.settlement.runAttempt; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE
    },
    {
      name: 'Both runAttempt identifiers missing (unproven attempt linkage)',
      mutate: (e) => { delete e.settlement.runAttempt; delete e.receipt.runAttempt; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE
    },
    {
      name: 'Receipt and settlement runAttempt mismatch',
      mutate: (e) => { e.receipt.runAttempt = 'attempt-different'; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_MISSING_RECEIPT
    },
    {
      name: 'Running descendants > 0',
      mutate: (e) => { e.references.runningDescendantsCount = 1; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_RETAINED_REFERENCE
    },
    {
      name: 'activeReadersCount is negative -1',
      mutate: (e) => { e.references.activeReadersCount = -1; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE
    },
    {
      name: 'activeReadersCount is NaN',
      mutate: (e) => { e.references.activeReadersCount = NaN; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE
    },
    {
      name: 'activeWritersCount is float 2.5',
      mutate: (e) => { e.references.activeWritersCount = 2.5; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE
    },
    {
      name: 'Active continuation present',
      mutate: (e) => { e.references.hasActiveContinuation = true; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_RETAINED_REFERENCE
    },
    {
      name: 'Pending retry present',
      mutate: (e) => { e.references.hasPendingRetry = true; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_RETAINED_REFERENCE
    },
    {
      name: 'Open in UI is true',
      mutate: (e) => { e.openInUI = true; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_OPEN_IN_UI
    },
    {
      name: 'Open in UI is missing (not boolean)',
      mutate: (e) => { delete e.openInUI; },
      expected: ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE
    }
  ];

  for (const { name, mutate, expected } of matrix) {
    it(`Mutate: ${name} -> ${expected}`, () => {
      const candidate = createValidBase();
      mutate(candidate);
      const res = evaluateCandidate(candidate, asOf, retentionDays);
      assert.equal(res.verdict, expected, `Expected ${expected} for ${name}, got ${res.verdict}`);
      assert.notEqual(res.verdict, ELIGIBILITY_VERDICTS.ELIGIBLE, `${name} must NEVER be ELIGIBLE`);
    });
  }
});
