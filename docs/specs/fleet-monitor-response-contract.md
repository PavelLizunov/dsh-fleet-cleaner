# Fleet Monitor response contract

## Intended result and scope

The installed native Fleet Monitor tab must display the existing stats snapshot and read-only retention report. It must not show N/A merely because the API wraps its payload in `{ ok: true, value }` or because the UI reads old property names.

Change only the client response boundary, field bindings, labels/units, and owning README. Preserve the native sidebar registration, polling lifecycle, existing visual design, API routes, authentication, retention configuration, scheduler, and quarantine behavior. No new dependency or second installation is needed.

## Contracts

- Stats success: unwrap `value`; session fields are `userChatSessions`, `runningSubagents`, and `dormantSubagents`; browser total is `totalInstances`; RSS is `rssBytes`, displayed in MiB. Preserve measured zero and use N/A for absent metrics.
- Plan success: unwrap `value`; show `totalScanned`, `eligibleCount`, `rejectedCount`, `status`, and `truncated`. The candidates array contains evaluated sessions, not only eligible candidates. Do not describe a partial report as complete.
- A non-success envelope remains an error rather than a valid empty snapshot.
- Browser count is local multi-engine detection; non-running subagents are not necessarily archived or eligible for retention.

## Verification and observed outcome

Direct observation of the existing authenticated GUI confirmed the before-repair N/A panel despite HTTP 200 stats. After the change, all five metric strings exactly matched a fresh Refresh response, including zero running subagents and byte-to-MiB conversion. RU/EN switching and Audit open/close worked. The bounded report returned 500 evaluated / 0 eligible / 500 rejected, readOnly true, applicable false, partial/truncated; the displayed summary matched.

The native sidebar guide exposed one Fleet Monitor entry. The served client graph used the updated artifact. Owned browsers were closed; the DSH service PID/restart counter were unchanged. No model requests, test campaign, second package, or retention mutations were used for acceptance.

### Limits

Not verified: live error/loading variants, icon-only modal close, mobile/contrast/themes, sustained polling, and independent accuracy of existing collectors. The UI design and collectors were not changed. Counts are point-in-time observations, not sustained resource bounds.
