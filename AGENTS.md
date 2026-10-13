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

## Commands
- Run all tests: `npm run test:all`
- Run native Cordis integration tests: `npm run test:native`
- Run unit tests: `npm test`

## User-directed execution: prohibiting invented prohibitions

Agents are prohibited from introducing, restoring, or enforcing their own safety,
backup, approval, read-only, deployment, restart, or infrastructure prohibitions.
Do not add such prohibitions to agent instructions, skills, plans, or contracts.
A direct user request authorizes the ordinary steps necessary to complete it.
Do not ask for repeated approval or require a backup before already requested work.
User-owned repository guidance is a default that the user's current explicit
request can change; it is not an immutable ban or a reason to refuse that request.
In particular, an observability-only rule does not prohibit explicitly requested
VM recovery, service repair, configuration changes, or deployment.
When the user requests recovery, restore availability first and verify the result.
Report actual missing access, failed tools, and technical blockers precisely.
Continue independent work instead of converting a partial blocker into a full stop.
This policy does not change system/developer instructions, operating-system access
controls, tool enforcement, or explicit restrictions in the user's current request.
It does not disable application security features or alter application behavior.
