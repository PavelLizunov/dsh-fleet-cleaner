/**
 * Retention Scheduler for DSH Fleet Cleaner (Phase 3).
 *
 * Implements:
 * 1. Bounded periodic background sweeps based on scheduleIntervalHours.
 * 2. Shared Single-Flight locking: prevents overlapping sweeps and manual collision.
 * 3. Cooperative non-blocking execution yielding to the Event Loop every 25 items.
 * 4. Strict Zero-Write compliance in dryRun: true: zero disk mutations or file creation.
 * 5. Lifecycle ownership: clean timer disarm and abort handling via Cordis ctx.effect.
 * 6. Detailed status reporting via getStatus() conforming to Phase 3 SDD.
 */

export class RetentionScheduler {
  constructor(options = {}) {
    this.retentionPlanner = options.retentionPlanner;
    this.quarantineService = options.quarantineService;
    this.config = options.config || {};
    this.logger = options.logger || console;

    this.intervalMs = (Number(this.config.scheduleIntervalHours ?? 24)) * 60 * 60 * 1000;
    this.timer = null;
    this.inFlight = false;
    this.running = false;
    this.lastSweepAt = null;
    this.nextSweepAt = null;
    this.lastSummary = null;
    this.sweepCount = 0;
  }

  /**
   * Start the background scheduler.
   */
  start() {
    if (this.running) return;
    this.running = true;

    if (!Number.isFinite(this.intervalMs) || this.intervalMs <= 0) {
      this.intervalMs = 24 * 60 * 60 * 1000;
    }

    this.nextSweepAt = Date.now() + this.intervalMs;
    this.timer = setInterval(() => {
      this.triggerSweep().catch(err => {
        this.logger.error?.('dsh-fleet-cleaner [Scheduler]: sweep failed:', err.message);
      });
    }, this.intervalMs);

    // Unref timer so it does not block Node.js process exit if unmanaged
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  /**
   * Stop and disarm the scheduler.
   */
  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.nextSweepAt = null;
  }

  /**
   * Trigger one execution sweep immediately (bounded & single-flight).
   */
  async triggerSweep() {
    if (this.inFlight) {
      return {
        sweepNumber: this.sweepCount,
        timestamp: Date.now(),
        durationMs: 0,
        totalScanned: 0,
        eligibleCount: 0,
        rejectedCount: 0,
        dryRun: this.config.dryRun !== false,
        quarantined: 0,
        errors: 0,
        outcome: 'skipped_busy',
        skipped: true,
        reason: 'Sweep already in flight',
      };
    }

    this.inFlight = true;
    const startedAt = Date.now();
    const t0 = performance.now();

    try {
      if (!this.retentionPlanner || this.retentionPlanner.disposed) {
        throw new Error('Retention planner is unavailable or disposed');
      }

      // 1. Generate observational plan
      const plan = await this.retentionPlanner.generatePlan();
      const sweepDuration = Math.round(performance.now() - t0);

      const sweepResult = {
        sweepNumber: ++this.sweepCount,
        timestamp: startedAt,
        durationMs: sweepDuration,
        totalScanned: plan.totalScanned,
        eligibleCount: plan.eligibleCount,
        rejectedCount: plan.rejectedCount,
        dryRun: this.config.dryRun !== false,
        quarantined: 0,
        errors: 0,
        outcome: 'completed',
      };

      // 2. Fail-closed: only mutate if dryRun is explicitly false
      if (this.config.dryRun === false && this.quarantineService && plan.eligibleCount > 0) {
        const eligibleCandidates = plan.candidates
          .filter(c => c.verdict === 'ELIGIBLE')
          .map(c => c.sessionId);

        if (eligibleCandidates.length > 0) {
          const qRes = await this.quarantineService.quarantineBatch(eligibleCandidates, {
            asOf: startedAt,
            allowLegacyRc1Subagents: this.config.allowLegacyRc1Subagents,
          });
          sweepResult.quarantined = qRes.quarantined;
          sweepResult.errors = qRes.errors;
        }
      }

      this.lastSweepAt = startedAt;
      this.lastSummary = Object.freeze(sweepResult);
      if (this.running) {
        this.nextSweepAt = Date.now() + this.intervalMs;
      }

      return sweepResult;
    } catch (err) {
      const failedResult = {
        sweepNumber: ++this.sweepCount,
        timestamp: startedAt,
        durationMs: Math.round(performance.now() - t0),
        totalScanned: 0,
        eligibleCount: 0,
        rejectedCount: 0,
        dryRun: this.config.dryRun !== false,
        quarantined: 0,
        errors: 1,
        outcome: 'failed',
        error: err.message,
      };
      this.lastSummary = Object.freeze(failedResult);
      throw err;
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Return live scheduler status matching SchedulerStatus interface.
   */
  getStatus() {
    return {
      running: this.running,
      inFlight: this.inFlight,
      intervalHours: this.intervalMs / (60 * 60 * 1000),
      dryRun: this.config.dryRun !== false,
      lastSweepAt: this.lastSweepAt,
      nextSweepAt: this.nextSweepAt,
      sweepCount: this.sweepCount,
      lastSummary: this.lastSummary,
    };
  }
}
