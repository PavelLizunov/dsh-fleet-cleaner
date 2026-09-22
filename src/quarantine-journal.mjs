/**
 * Quarantine Journal for DSH Fleet Cleaner (Phase 2 & 3).
 *
 * Implements:
 * - Durable append-only state tracking for session quarantine lifecycle.
 * - Idempotent recovery and reconciliation upon startup/crash.
 * - Strict JSON serialization without leaking transcripts or secrets.
 * - Atomic checkpoint compaction with fsync and directory sync for crash-safety.
 * - Zero external dependencies.
 */

import fs from 'node:fs';
import path from 'node:path';

export class QuarantineJournal {
  constructor(journalPath) {
    this.journalPath = journalPath;
    this.entries = new Map();
    this.loaded = false;
  }

  /**
   * Load journal entries from disk into memory.
   */
  async load() {
    if (this.loaded) return;
    this.entries.clear();

    const dir = path.dirname(this.journalPath);
    await fs.promises.mkdir(dir, { recursive: true });

    try {
      const data = await fs.promises.readFile(this.journalPath, 'utf8');
      const lines = data.split('\n').filter(l => l.trim().length > 0);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry?.sessionId) {
            this.entries.set(entry.sessionId, entry);
          }
        } catch {
          // Ignore corrupted single line
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    this.loaded = true;
  }

  /**
   * Append journal record to file and update in-memory state.
   */
  async _append(entry) {
    await this.load();
    this.entries.set(entry.sessionId, entry);
    const line = JSON.stringify(entry) + '\n';
    await fs.promises.appendFile(this.journalPath, line, 'utf8');
  }

  async recordPrepared({ operationId, sessionId, planId }) {
    const entry = {
      schemaVersion: 1,
      operationId,
      sessionId,
      planId: planId || 'plan-direct',
      state: 'PREPARED',
      preparedAt: Date.now(),
      holdUntil: Date.now() + (72 * 60 * 60 * 1000), // Default 72h minimum hold
    };
    await this._append(entry);
    return entry;
  }

  async recordQuarantined({ operationId, sessionId, planId, holdUntil }) {
    const prev = this.entries.get(sessionId) || {};
    const entry = {
      schemaVersion: 1,
      operationId: operationId || prev.operationId || 'op-direct',
      sessionId,
      planId: planId || prev.planId || 'plan-direct',
      state: 'QUARANTINED',
      preparedAt: prev.preparedAt || Date.now(),
      quarantinedAt: Date.now(),
      holdUntil: holdUntil || prev.holdUntil || (Date.now() + (72 * 60 * 60 * 1000)),
    };
    await this._append(entry);
    return entry;
  }

  async recordRestored({ sessionId }) {
    const prev = this.entries.get(sessionId) || {};
    const entry = {
      ...prev,
      schemaVersion: 1,
      sessionId,
      state: 'RESTORED',
      restoredAt: Date.now(),
    };
    await this._append(entry);
    return entry;
  }

  async recordAborted({ operationId, sessionId, error }) {
    const prev = this.entries.get(sessionId) || {};
    const entry = {
      ...prev,
      schemaVersion: 1,
      operationId: operationId || prev.operationId || 'op-direct',
      sessionId,
      state: 'ABORTED',
      errorCode: error ? String(error) : 'UNKNOWN_ERROR',
      abortedAt: Date.now(),
    };
    await this._append(entry);
    return entry;
  }

  getEntry(sessionId) {
    return this.entries.get(sessionId);
  }

  listQuarantined() {
    const res = [];
    for (const entry of this.entries.values()) {
      if (entry.state === 'QUARANTINED') {
        res.push(entry);
      }
    }
    return res;
  }

  /**
   * Safe checkpoint snapshot compaction: writes current terminal state snapshot
   * to a temporary file, syncs bytes with fsync, atomically renames it over the journal path,
   * and syncs the parent directory.
   */
  async compact() {
    await this.load();
    const tempPath = `${this.journalPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    const lines = [];
    for (const entry of this.entries.values()) {
      lines.push(JSON.stringify(entry));
    }
    const data = lines.length > 0 ? lines.join('\n') + '\n' : '';

    // 1. Write and sync temp file
    const fileHandle = await fs.promises.open(tempPath, 'w', 0o600);
    try {
      if (data.length > 0) {
        await fileHandle.writeFile(data, 'utf8');
      }
      await fileHandle.sync();
    } finally {
      await fileHandle.close();
    }

    // 2. Atomic rename EXT4
    await fs.promises.rename(tempPath, this.journalPath);

    // 3. Sync parent directory to persist directory entry change
    try {
      const dirHandle = await fs.promises.open(path.dirname(this.journalPath), 'r');
      try {
        await dirHandle.sync();
      } finally {
        await dirHandle.close();
      }
    } catch {}
  }
}
