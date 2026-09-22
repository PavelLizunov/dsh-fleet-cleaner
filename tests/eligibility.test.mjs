import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCandidate } from '../src/eligibility.mjs';
import { ELIGIBILITY_VERDICTS } from '../src/types.mjs';

describe('Retention Eligibility Unit Tests (All 11 Verdicts)', () => {
  const asOf = 1788000000000;
  const retentionDays = 14;
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  const validCompletedAt = asOf - retentionMs - 1000; // Old enough

  function createValidEvidence(overrides = {}) {
    const baseHeader = {
      id: 'sub-valid',
      version: 1,
      origin: 'subagent',
      parentSession: 'root-1',
      subagentMode: 'one-shot',
      cwd: '/var/lib/dsh/repo',
    };

    const baseSettlement = {
      status: 'settled',
      completedAt: validCompletedAt,
      runAttempt: 'attempt-1',
    };

    const baseReceipt = {
      receiptId: 'rcpt-123',
      childSessionId: 'sub-valid',
      runAttempt: 'attempt-1',
    };

    const baseReferences = {
      runningDescendantsCount: 0,
      hasActiveContinuation: false,
      hasPendingRetry: false,
      activeReadersCount: 0,
      activeWritersCount: 0,
    };

    return {
      header: Object.prototype.hasOwnProperty.call(overrides, 'header')
        ? (overrides.header ? { ...baseHeader, ...overrides.header } : overrides.header)
        : baseHeader,
      settlement: Object.prototype.hasOwnProperty.call(overrides, 'settlement')
        ? (overrides.settlement ? { ...baseSettlement, ...overrides.settlement } : overrides.settlement)
        : baseSettlement,
      lastDurableActivityAt: Object.prototype.hasOwnProperty.call(overrides, 'lastDurableActivityAt')
        ? overrides.lastDurableActivityAt
        : validCompletedAt,
      receipt: Object.prototype.hasOwnProperty.call(overrides, 'receipt')
        ? (overrides.receipt ? { ...baseReceipt, ...overrides.receipt } : overrides.receipt)
        : baseReceipt,
      references: Object.prototype.hasOwnProperty.call(overrides, 'references')
        ? (overrides.references ? { ...baseReferences, ...overrides.references } : overrides.references)
        : baseReferences,
      openInUI: Object.prototype.hasOwnProperty.call(overrides, 'openInUI')
        ? overrides.openInUI
        : false,
      confirmedMode: overrides.confirmedMode,
    };
  }

  it('1. ELIGIBLE: all 6 criteria groups confirmed', () => {
    const evidence = createValidEvidence();
    const res = evaluateCandidate(evidence, asOf, retentionDays);
    assert.equal(res.verdict, ELIGIBILITY_VERDICTS.ELIGIBLE);
    assert.ok(res.eligibleAfter <= asOf);
  });

  it('2. REJECTED_UNSUPPORTED_VERSION: version 0, missing, negative, or non-integer', () => {
    const evidence1 = createValidEvidence({ header: { version: 0 } });
    assert.equal(evaluateCandidate(evidence1, asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_UNSUPPORTED_VERSION);

    const evidence2 = createValidEvidence({ header: { version: undefined } });
    assert.equal(evaluateCandidate(evidence2, asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_UNSUPPORTED_VERSION);

    const evidence3 = createValidEvidence({ header: { version: '0' } });
    assert.equal(evaluateCandidate(evidence3, asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_UNSUPPORTED_VERSION);

    const evidence4 = createValidEvidence({ header: { version: -1 } });
    assert.equal(evaluateCandidate(evidence4, asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_UNSUPPORTED_VERSION);

    const evidence5 = createValidEvidence({ header: { version: 1.5 } });
    assert.equal(evaluateCandidate(evidence5, asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_UNSUPPORTED_VERSION);
  });

  it('3. REJECTED_NON_SUBAGENT: root user chat or missing origin', () => {
    const evidence1 = createValidEvidence({ header: { origin: undefined } });
    assert.equal(evaluateCandidate(evidence1, asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_NON_SUBAGENT);

    const evidence2 = createValidEvidence({ header: { origin: 'user' } });
    assert.equal(evaluateCandidate(evidence2, asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_NON_SUBAGENT);
  });

  it('4. REJECTED_NON_ONESHOT: continuable or unproven mode', () => {
    const evidence1 = createValidEvidence({ header: { subagentMode: 'continuable' } });
    assert.equal(evaluateCandidate(evidence1, asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_NON_ONESHOT);

    const evidence2 = createValidEvidence({ header: { subagentMode: undefined }, confirmedMode: undefined });
    assert.equal(evaluateCandidate(evidence2, asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_NON_ONESHOT);
  });

  it('5. REJECTED_NOT_TERMINAL: run is running, queued, or unknown settlement', () => {
    const evidence1 = createValidEvidence({ settlement: { status: 'running' } });
    assert.equal(evaluateCandidate(evidence1, asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_NOT_TERMINAL);

    const evidence2 = createValidEvidence({ settlement: null });
    assert.equal(evaluateCandidate(evidence2, asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_NOT_TERMINAL);
  });

  it('6. REJECTED_TTL_NOT_EXPIRED: completed recently, formula max(completedAt, lastActivityAt)', () => {
    const recentActivity = asOf - 1000;
    const evidence = createValidEvidence({ lastDurableActivityAt: recentActivity });
    const res = evaluateCandidate(evidence, asOf, retentionDays);
    assert.equal(res.verdict, ELIGIBILITY_VERDICTS.REJECTED_TTL_NOT_EXPIRED);
    assert.ok(res.eligibleAfter > asOf);
  });

  it('7. REJECTED_MISSING_RECEIPT: receipt missing, childId mismatch, or attempt mismatch', () => {
    const evidence1 = createValidEvidence({ receipt: null });
    assert.equal(evaluateCandidate(evidence1, asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_MISSING_RECEIPT);

    const evidence2 = createValidEvidence({ receipt: { receiptId: 'rcpt', childSessionId: 'diff', runAttempt: 'attempt-1' } });
    assert.equal(evaluateCandidate(evidence2, asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_MISSING_RECEIPT);

    const evidence3 = createValidEvidence({ receipt: { receiptId: 'rcpt', childSessionId: 'sub-valid', runAttempt: 'attempt-different' } });
    assert.equal(evaluateCandidate(evidence3, asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_MISSING_RECEIPT);
  });

  it('8. REJECTED_RETAINED_REFERENCE: running descendants, active continuations, readers/writers', () => {
    const evidence1 = createValidEvidence({ references: { runningDescendantsCount: 2 } });
    assert.equal(evaluateCandidate(evidence1, asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_RETAINED_REFERENCE);

    const evidence2 = createValidEvidence({ references: { hasActiveContinuation: true } });
    assert.equal(evaluateCandidate(evidence2, asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_RETAINED_REFERENCE);

    const evidence3 = createValidEvidence({ references: { activeReadersCount: 1 } });
    assert.equal(evaluateCandidate(evidence3, asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_RETAINED_REFERENCE);
  });

  it('9. REJECTED_OPEN_IN_UI: open in active viewer or non-boolean', () => {
    const evidence1 = createValidEvidence({ openInUI: true });
    assert.equal(evaluateCandidate(evidence1, asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_OPEN_IN_UI);

    const evidence2 = createValidEvidence({ openInUI: undefined });
    assert.equal(evaluateCandidate(evidence2, asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE);
  });

  it('10. REJECTED_INCOMPLETE_EVIDENCE: missing timestamps, parentSession link, runAttempt or references', () => {
    const evidence1 = createValidEvidence({ lastDurableActivityAt: null });
    assert.equal(evaluateCandidate(evidence1, asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE);

    const evidence2 = createValidEvidence({ header: { parentSession: undefined } });
    assert.equal(evaluateCandidate(evidence2, asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE);

    const evidence3 = createValidEvidence({ references: null });
    assert.equal(evaluateCandidate(evidence3, asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE);

    const evidence4 = createValidEvidence({ settlement: { runAttempt: undefined } });
    assert.equal(evaluateCandidate(evidence4, asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE);
  });

  it('11. REJECTED_SOURCE_ERROR: candidate record is null or malformed', () => {
    assert.equal(evaluateCandidate(null, asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_SOURCE_ERROR);
    assert.equal(evaluateCandidate('invalid-string', asOf, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_SOURCE_ERROR);
    assert.equal(evaluateCandidate(createValidEvidence(), -1, retentionDays).verdict, ELIGIBILITY_VERDICTS.REJECTED_SOURCE_ERROR);
  });
});
