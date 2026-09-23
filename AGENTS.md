# dsh-fleet-cleaner Agent Guidelines

## Repository Overview
`dsh-fleet-cleaner` is a native Cordis plugin for DeepSeek Harness (DSH v0.1.5-rc.2+) providing:
- **Phase 1**: Passive Observability & Retention Planner (RAM, CGroup v2, multi-engine browser detection).
- **Phase 2**: Transactional Reversible Quarantine (.dsh/quarantine/, EXT4 atomic rename, 6-group fail-closed proof, 72-hour hold, JSONL journaling, instant undo).
- **Phase 3**: Background Scheduler (`RetentionScheduler`), single-flight concurrency lock, `dryRun: true` zero-write compliance, and atomic journal checkpoint compaction (`journal.compact()`).

## Architecture & Code Structure
- `src/index.mjs`: Cordis plugin entrypoint, REST API endpoints under `/fleet-cleaner/api/`. Dynamic authentication via `connection.requestRejection(req)`.
- `src/observability-service.mjs`: System metrics collector (Node RSS, heap, CGroup v2, session inventory, passive multi-engine browser detection).
- `src/retention-planner.mjs`: Observational audit planner. Evaluates candidates against 6-group criteria with cooperative event loop yielding.
- `src/quarantine-service.mjs`: Atomic EXT4 rename service, pre-mutation re-validation, projcache migration, and instant restoration.
- `src/retention-scheduler.mjs`: Background timer, single-flight mutual exclusion, zero-write dryRun enforcement.
- `src/quarantine-journal.mjs`: Append-only JSONL journal with atomic fsync checkpoint compaction.
- `src/eligibility.mjs`: Strict 6-group evaluator enforcing 100% root user chat immunity (`REJECTED_NON_SUBAGENT`).
- `src/FleetCleanerHud.js`: BetterSidebar React component (RU/EN bilingual switcher, left-aligned vector SVG icons, tooltips, ErrorBoundary).
- `src/client.js`: IIFE client bundle conforming to `window.__ModuleLoader__.load({ id, factory })`.

## Safety & Invariants
- `dryRun: true` strictly enforces zero disk writes. POST mutation routes reject with HTTP 403 Forbidden when dryRun is true.
- Root user chats and non-subagent sessions are 100% immune from quarantine or purge.
- Subagents with missing, unproven, or continuable mode are rejected (`REJECTED_NON_ONESHOT`).
- No physical purge (`rm`/`unlink`) exists in Phase 2 or Phase 3.

## Commands
- Run all tests: `npm run test:all`
- Run native Cordis integration tests: `npm run test:native`
- Run unit tests: `npm test`
