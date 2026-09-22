/**
 * Strict Eligibility Evaluator for Subagent Retention (Phase 1: Read-Only).
 *
 * Implements exact fail-closed evaluation across all 6 criteria groups.
 * Rejects missing, ambiguous, unproven, non-integer, negative, or unlinked records.
 */

import { ELIGIBILITY_VERDICTS } from './types.mjs';

// Supported format version set in DSH (v1, v2, v3); 0 or future unverified versions are rejected
const SUPPORTED_FORMAT_VERSIONS = new Set([1, 2, 3]);

/**
 * Evaluate one candidate session record.
 *
 * @param {object} candidateEvidence - full candidate evidence bundle
 * @param {number} asOf - timestamp of evaluation observation
 * @param {number} retentionDays - retention TTL threshold in days
 * @returns {{ verdict: string, eligibleAfter?: number, reason: string }}
 */
export function evaluateCandidate(candidateEvidence, asOf, retentionDays, options = {}) {
  // Validate observation timestamp
  if (typeof asOf !== 'number' || !Number.isSafeInteger(asOf) || asOf <= 0) {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_SOURCE_ERROR,
      reason: 'Observation timestamp asOf must be a positive safe integer.'
    };
  }

  if (!candidateEvidence || typeof candidateEvidence !== 'object') {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_SOURCE_ERROR,
      reason: 'Candidate evidence record is missing or not an object.'
    };
  }

  const {
    header,
    settlement,
    receipt,
    references,
    openInUI,
  } = candidateEvidence;

  // --- Group 1: Session Header & Version ---
  if (!header || typeof header !== 'object') {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE,
      reason: 'Session header evidence is missing.'
    };
  }

  // Non-empty ID is strictly required
  if (typeof header.id !== 'string' || header.id.trim() === '') {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE,
      reason: 'Session header id is missing or empty.'
    };
  }

  // Version MUST be in SUPPORTED_FORMAT_VERSIONS (rejects 0, '0', -1, 1.5, null, undefined, unknown future versions)
  const isSupported = typeof header.version === "number" && (SUPPORTED_FORMAT_VERSIONS.has(header.version) || (options.allowLegacyRc1Subagents === true && header.version === 0 && header.origin === "subagent"));
  if (!isSupported) {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_UNSUPPORTED_VERSION,
      reason: `Session format version ${JSON.stringify(header.version)} is unsupported by retention policy.`
    };
  }

  // --- Group 2: Origin & Parent Link ---
  if (header.origin !== 'subagent') {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_NON_SUBAGENT,
      reason: `Session origin is "${header.origin || 'unknown'}", non-subagents are strictly protected.`
    };
  }

  if (typeof header.parentSession !== 'string' || header.parentSession.trim() === '') {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE,
      reason: 'Subagent parentSession ID is missing or malformed.'
    };
  }

  // --- Group 3: Execution Mode (strictly confirmed 'one-shot', never guessed) ---
  const headerMode = header.subagentMode;
  const confirmedMode = candidateEvidence.confirmedMode;

  if (headerMode !== undefined && confirmedMode !== undefined && headerMode !== confirmedMode) {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_NON_ONESHOT,
      reason: `Conflicting mode evidence: header mode "${headerMode}" != confirmed mode "${confirmedMode}".`
    };
  }

  const resolvedMode = confirmedMode || headerMode;
  if (resolvedMode !== 'one-shot') {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_NON_ONESHOT,
      reason: `Subagent mode is "${resolvedMode || 'unproven'}", only confirmed one-shot runs are eligible.`
    };
  }

  // --- Group 4: Settlement & Terminal Run State ---
  if (!settlement || typeof settlement !== 'object') {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_NOT_TERMINAL,
      reason: 'Run settlement evidence is missing.'
    };
  }

  if (settlement.status !== 'settled') {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_NOT_TERMINAL,
      reason: `Run settlement state is "${settlement.status || 'non-terminal'}".`
    };
  }

  const completedAt = settlement.completedAt;
  const lastActivityAt = candidateEvidence.lastDurableActivityAt;

  if (
    typeof completedAt !== 'number' || !Number.isSafeInteger(completedAt) || completedAt <= 0 ||
    typeof lastActivityAt !== 'number' || !Number.isSafeInteger(lastActivityAt) || lastActivityAt <= 0
  ) {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE,
      reason: 'Mandatory completion or activity timestamps are missing, non-integer, or <= 0.'
    };
  }

  // --- Group 5: Verifiable Result Receipt Bound to Run Attempt ---
  if (!receipt || typeof receipt !== 'object') {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_MISSING_RECEIPT,
      reason: 'Parent result receipt record is missing.'
    };
  }

  if (typeof receipt.receiptId !== 'string' || receipt.receiptId.trim() === '') {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_MISSING_RECEIPT,
      reason: 'Parent result receiptId is missing or empty.'
    };
  }

  if (receipt.childSessionId !== header.id) {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_MISSING_RECEIPT,
      reason: `Receipt childSessionId "${receipt.childSessionId}" does not match session id "${header.id}".`
    };
  }

  // Mandatory runAttempt link: both settlement and receipt must prove matching non-empty runAttempt
  if (typeof settlement.runAttempt !== 'string' || settlement.runAttempt.trim() === '') {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE,
      reason: 'Settlement runAttempt identifier is missing or not a non-empty string.'
    };
  }

  if (typeof receipt.runAttempt !== 'string' || receipt.runAttempt.trim() === '') {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_MISSING_RECEIPT,
      reason: 'Receipt runAttempt identifier is missing or not a non-empty string.'
    };
  }

  if (receipt.runAttempt !== settlement.runAttempt) {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_MISSING_RECEIPT,
      reason: `Receipt runAttempt "${receipt.runAttempt}" does not match settlement runAttempt "${settlement.runAttempt}".`
    };
  }

  // --- Group 6: Mandatory References & Open UI Safety ---
  if (typeof openInUI !== 'boolean') {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE,
      reason: 'openInUI observation evidence is missing or non-boolean.'
    };
  }

  if (openInUI === true) {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_OPEN_IN_UI,
      reason: 'Session is currently open or viewed in an active UI context.'
    };
  }

  if (!references || typeof references !== 'object') {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE,
      reason: 'Subagent references and dependency evidence is missing.'
    };
  }

  const isValidCount = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

  if (
    !isValidCount(references.runningDescendantsCount) ||
    !isValidCount(references.activeReadersCount) ||
    !isValidCount(references.activeWritersCount) ||
    typeof references.hasActiveContinuation !== 'boolean' ||
    typeof references.hasPendingRetry !== 'boolean'
  ) {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_INCOMPLETE_EVIDENCE,
      reason: 'References fields must be valid safe non-negative integers and booleans.'
    };
  }

  if (references.runningDescendantsCount > 0) {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_RETAINED_REFERENCE,
      reason: `Subagent has ${references.runningDescendantsCount} running descendants.`
    };
  }

  if (references.hasActiveContinuation === true || references.hasPendingRetry === true) {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_RETAINED_REFERENCE,
      reason: 'Subagent has active continuation or pending retry.'
    };
  }

  if (references.activeReadersCount > 0 || references.activeWritersCount > 0) {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_RETAINED_REFERENCE,
      reason: 'Subagent has active readers or writers leases.'
    };
  }

  // --- Group 7: TTL Expiry Check ---
  const retentionDurationMs = retentionDays * 24 * 60 * 60 * 1000;
  const eligibleAfter = Math.max(completedAt, lastActivityAt) + retentionDurationMs;

  if (asOf < eligibleAfter) {
    return {
      verdict: ELIGIBILITY_VERDICTS.REJECTED_TTL_NOT_EXPIRED,
      eligibleAfter,
      reason: `TTL not expired. Eligible after ${new Date(eligibleAfter).toISOString()} (asOf: ${new Date(asOf).toISOString()}).`
    };
  }

  return {
    verdict: ELIGIBILITY_VERDICTS.ELIGIBLE,
    eligibleAfter,
    reason: 'All necessary conditions confirmed on this observation slice. Observational only.'
  };
}
