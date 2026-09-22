/**
 * Types & Configuration Validation for dsh-fleet-cleaner.
 *
 * Enforces:
 * - Direct validation of rawConfig (dryRun must be explicitly boolean; dryRun !== true rejects mutations).
 * - Finite positive bounds on retentionDays, maxScanItems, maxScanTimeMs.
 * - Operator token configuration parsing.
 * - Preservation of sessionsDir, quarantineDir, projcacheDir, holdHours, allowLegacyRc1Subagents.
 */

export const ELIGIBILITY_VERDICTS = {
  ELIGIBLE: 'ELIGIBLE',
  REJECTED_NON_SUBAGENT: 'REJECTED_NON_SUBAGENT',
  REJECTED_UNSUPPORTED_VERSION: 'REJECTED_UNSUPPORTED_VERSION',
  REJECTED_NON_ONESHOT: 'REJECTED_NON_ONESHOT',
  REJECTED_NOT_TERMINAL: 'REJECTED_NOT_TERMINAL',
  REJECTED_TTL_NOT_EXPIRED: 'REJECTED_TTL_NOT_EXPIRED',
  REJECTED_MISSING_RECEIPT: 'REJECTED_MISSING_RECEIPT',
  REJECTED_RETAINED_REFERENCE: 'REJECTED_RETAINED_REFERENCE',
  REJECTED_OPEN_IN_UI: 'REJECTED_OPEN_IN_UI',
  REJECTED_INCOMPLETE_EVIDENCE: 'REJECTED_INCOMPLETE_EVIDENCE',
  REJECTED_SOURCE_ERROR: 'REJECTED_SOURCE_ERROR',
};

export class ConfigError extends Error {
  constructor(message) {
    super(`dsh-fleet-cleaner [ConfigError]: ${message}`);
    this.name = 'ConfigError';
  }
}

/**
 * Validate configuration strictly against constraints.
 * Rejects dryRun !== true directly when running in read-only / Phase 1 mode.
 *
 * @param {object} raw - unadulterated caller configuration
 * @returns {object} validated frozen configuration
 */
export function validateConfig(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new ConfigError('Configuration must be an object.');
  }

  // Reject if dryRun is false, missing, null, or not boolean true (fail-closed)
  if (raw.dryRun !== true) {
    throw new ConfigError('Phase 1 strictly enforces dryRun: true. Mutation execution is not permitted.');
  }

  const retentionDays = Number(raw.retentionDays ?? 14);
  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    throw new ConfigError('retentionDays must be a number >= 1.');
  }

  const maxScanItems = Number(raw.maxScanItems ?? 500);
  if (!Number.isSafeInteger(maxScanItems) || maxScanItems < 1) {
    throw new ConfigError('maxScanItems must be a positive integer.');
  }

  const maxScanTimeMs = Number(raw.maxScanTimeMs ?? 5000);
  if (!Number.isFinite(maxScanTimeMs) || maxScanTimeMs < 100) {
    throw new ConfigError('maxScanTimeMs must be a number >= 100.');
  }

  const operatorTokens = new Set();
  if (typeof raw.operatorToken === 'string' && raw.operatorToken.trim() !== '') {
    operatorTokens.add(raw.operatorToken.trim());
  }
  if (Array.isArray(raw.operatorTokens)) {
    for (const t of raw.operatorTokens) {
      if (typeof t === 'string' && t.trim() !== '') {
        operatorTokens.add(t.trim());
      }
    }
  }

  const holdHours = Number(raw.holdHours ?? 72);
  if (!Number.isFinite(holdHours) || holdHours < 1) {
    throw new ConfigError('holdHours must be a number >= 1.');
  }

  return Object.freeze({
    dryRun: true,
    retentionDays,
    scheduleIntervalHours: Number(raw.scheduleIntervalHours ?? 24),
    maxScanItems,
    maxScanTimeMs,
    operatorTokens,
    operatorToken: raw.operatorToken,
    validateSession: typeof raw.validateSession === 'function' ? raw.validateSession : null,
    sessionsDir: typeof raw.sessionsDir === 'string' ? raw.sessionsDir : undefined,
    quarantineDir: typeof raw.quarantineDir === 'string' ? raw.quarantineDir : undefined,
    projcacheDir: typeof raw.projcacheDir === 'string' ? raw.projcacheDir : undefined,
    holdHours,
    allowLegacyRc1Subagents: raw.allowLegacyRc1Subagents === true,
  });
}
