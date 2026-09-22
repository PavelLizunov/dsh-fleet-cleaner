# dsh-fleet-cleaner (Phase 1: Read-Only Observability & Retention Planner)

Universal, fail-closed subagent observability and candidate retention planner plugin for the DeepSeek Harness (DSH).

## Overview
- **Phase 1 Scope**: Strictly Read-Only. No filesystem or storage mutations (`dryRun: true` strictly enforced at runtime).
- **Observability**: Real-time snapshot of process memory (V8 Heap, RSS), Linux CGroup v2 metrics, browser process fleet (Playwright/Neko), and session counts in exact bytes.
- **Retention Planner**: Audits and evaluates subagent session candidates for future quarantine eligibility across 6 strict proof groups (all 11 verdicts tested).
- **HUD & Modal Plan View**: Pure React component integrating with DSH BetterSidebar. Fails fast with `TypeError` if React is missing.
- **Strict Operator Authentication**: Endpoints require verified operator tokens, matching cookies, or authenticated session validation via native DSH `connection.requestRejection`; arbitrary/fictitious bearer tokens are rejected with 401.

## Execution Requirements
- Node.js >= 22.0.0
- Linux x64 (supports CGroup v2, /proc/meminfo)

## Exact Test Execution Commands

### 1. Autonomous Suites (82 tests, zero runtime dependencies)
Runs standalone in any standard Node.js environment without external DSH or browser packages:
```bash
npm test
# Or directly:
node --test tests/eligibility-matrix.test.mjs tests/eligibility.test.mjs tests/entrypoint-smoke.test.mjs tests/hud-error-boundary.test.mjs tests/integration-lifecycle.test.mjs tests/observability-service.test.mjs tests/planner-lifecycle.test.mjs tests/read-only-guard.test.mjs tests/retention-planner.test.mjs
```

### 2. Native DSH WebServer, Browser DOM & E2E Integration Suite (6 tests)
Requires pinned DSH runtime and JSDOM environment:
```bash
DSH_RUNTIME_DIR="/var/lib/dsh/.dsh-releases/v015-rc2-t4x7mz4n/runtime:/var/lib/dsh/Project/dsh-workspace-groups" npm run test:native
```

### 3. All Suites Combined (88 tests)
```bash
DSH_RUNTIME_DIR="/var/lib/dsh/.dsh-releases/v015-rc2-t4x7mz4n/runtime:/var/lib/dsh/Project/dsh-workspace-groups" npm run test:all
```

## REST API Endpoints (Phase 1)
All endpoints require operator authorization (verified Bearer token or authenticated session):
- `GET /fleet-cleaner/api/stats` - Returns `ObservabilitySnapshot` (cached 15s, pass `?force=true` to refresh).
- `GET /fleet-cleaner/api/plan` - Generates and returns `RetentionPlan` (`readOnly: true`, `applicable: false`).
