# Spec: DSH Fleet Cleaner (Phase 1, 2 & 3)

## 1. Intent & Invariants
- **What**: Autonomous subagent observability, transactional reversible quarantine, background scheduling, multi-engine browser monitoring, and journal compaction for DeepSeek Harness (DSH v0.1.5-rc.2).
- **Invariants**:
  1. **Strict Zero-Write in dryRun**: In `dryRun: true`, background and manual operations strictly forbid all disk mutations (`fs.writeFile`, `fs.rename`, `fs.appendFile`). All audit data exists in-memory only.
  2. **Shared Single-Flight Lock**: Background sweeps and manual triggers share mutual exclusion; concurrent execution of two scans or sweeps is strictly forbidden.
  3. **6-Group Fail-Closed Proof**: Candidates must simultaneously prove all 6 criteria groups:
     - Confirmed `origin === 'subagent'`.
     - Confirmed `mode === 'one-shot'`.
     - Confirmed terminal state (`settlement.status === 'settled'`).
     - Retention TTL expired (`asOf >= max(completedAt, lastDurableActivityAt) + retentionDuration`).
     - Verifiable parent receipt matching child ID and run attempt.
     - Retaining dependencies absent (zero running descendants, zero active continuations/retries, zero active readers/writers, `openInUI === false`).
     Root user chats have 100% immunity (`REJECTED_NON_SUBAGENT`).
  4. **Pre-Mutation Re-Validation Under Lock**: Candidates must re-satisfy all 6 groups under lock immediately before atomic rename.
  5. **Atomic Journal Compaction**: Compaction writes a checkpoint snapshot to a temporary file, calls `fsync` on file and parent directory, and atomically renames it over `quarantine-journal.jsonl`.
  6. **Clean Lifecycle Ownership**: Plugin disposal (`ctx.effect`) disarms timers (`clearInterval`/`unref`) and unregisters all routes.
  7. **Passive Browser Inspection**: Browser monitoring passively inspects `/proc`, distinguishing master instances from Chromium child processes (`--type=`) without sending OS signals.

---

## 2. Interface / Data Contract

```typescript
export interface SchedulerStatus {
  readonly running: boolean;              // Background timer armed
  readonly inFlight: boolean;             // Sweep actively executing
  readonly intervalHours: number;         // Cadence (default 24h)
  readonly dryRun: boolean;               // Protection mode flag
  readonly lastSweepAt: number | null;    // Start timestamp of last run (Unix ms)
  readonly nextSweepAt: number | null;    // Projected next run timestamp (Unix ms)
  readonly sweepCount: number;            // Total completed sweeps
  readonly lastSummary: SweepSummary | null;
}

export interface SweepSummary {
  readonly sweepNumber: number;
  readonly timestamp: number;             // Start timestamp (Unix ms)
  readonly durationMs: number;            // Monotonic duration
  readonly totalScanned: number;          // Total sessions inspected
  readonly eligibleCount: number;         // Candidates admitted
  readonly rejectedCount: number;         // Candidates protected by filters
  readonly dryRun: boolean;               // Execution mode
  readonly quarantined: number;           // Sessions moved (0 in dryRun)
  readonly errors: number;                // Errors encountered
  readonly outcome: 'completed' | 'skipped_busy' | 'failed';
}

export interface BrowserMetrics {
  readonly totalInstances: number;        // Unique master browser processes
  readonly instances: {
    readonly neko: number;                // Neko container browser instances
    readonly playwright: number;          // Playwright automation browser instances
    readonly chromium: number;            // Standalone Chrome / Chromium instances
    readonly firefox: number;             // Standalone Firefox instances
  };
  readonly summary: string;               // e.g. "1 Neko" or "1 Neko, 2 Playwright"
  readonly rawProcesses: Record<string, number>; // Total OS processes for memory tracking
  readonly unconfirmed: boolean;          // True if /proc was partially inaccessible
}

export interface FleetCleanerRoutes {
  // GET  /fleet-cleaner/api/stats -> ObservabilitySnapshot (with BrowserMetrics)
  // GET  /fleet-cleaner/api/plan -> RetentionPlan (dryRun: true)
  // GET  /fleet-cleaner/api/scheduler -> SchedulerStatus
  // POST /fleet-cleaner/api/scheduler/sweep -> SweepSummary (trigger manual sweep)
  // GET  /fleet-cleaner/api/quarantine/list -> QuarantinedEntry[]
  // POST /fleet-cleaner/api/quarantine -> 403 Forbidden in dryRun
  // POST /fleet-cleaner/api/quarantine/restore -> 403 Forbidden in dryRun
}
```

---

## 3. Verification Checklist (Definition of Done)
- [x] Happy path: Background scheduler triggers periodic sweeps at `scheduleIntervalHours`, computes `nextSweepAt`, and updates status.
- [x] Happy path: Multi-engine browser detection distinguishes master processes from Chromium child workers and formats dynamic summaries.
- [x] Happy path: `journal.compact()` creates atomic checkpoint with `fsync` and directory sync.
- [x] Edge/Failure: Overlapping sweep requests are cleanly rejected by single-flight guard (`skipped_busy`).
- [x] Edge/Failure: Plugin disposal cleanly disarms timers and halts execution.
- [x] Edge/Failure: Strict Zero-Write in `dryRun: true`: zero disk mutations occur.
- [x] Tests: 100% tests pass in DSH runtime (105 tests across 12 suites).
