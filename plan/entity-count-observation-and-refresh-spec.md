# Spec: Count observation and selection-scoped refresh

Status: **Draft for review**. This document specifies both architecture-review
candidates; it does not authorize implementation or fix concrete TypeScript
interfaces. Baseline: `f805a36`.

## Outcome

Concentrate message-count meaning in one deep module and refresh lifetime in
another, so the entity tree and detail panels no longer coordinate those rules
themselves. Improve locality for changes and leverage for callers and tests.

Deliver count observation first, then selection-scoped refresh ownership. Each
phase must leave a working application and can be reviewed independently.

Domain language is defined in [GLOSSARY.md](../GLOSSARY.md).

## Existing friction

| Area | Evidence | Consequence |
| --- | --- | --- |
| Count meaning | `src/renderer/src/lib/messageCount.ts` owns cap/cursor interpretation but returns `null` on failure. | Callers cannot distinguish a failed observation from a deliberately unavailable one. |
| Forwarding eligibility | `useEntityTreeData.ts` and `TopicPanel.tsx` independently filter active/DLQ observations. `QueuePanel.tsx` does not apply the same policy. | Adding or changing eligibility requires multiple edits. |
| Purge estimate | `QueuePurgeControl.tsx` calls `messages.peek` and reads the returned array length. | Message bodies cross IPC solely to obtain a count; cap handling is repeated. |
| Refresh lifetime | `useEntityPanel.ts`, `useIsCurrent.ts`, `useEntityCounts.ts`, and their callers share responsibility for reset and stale-result rejection. | Correctness depends on callers placing checks around every asynchronous phase. |
| Partial results | `TopicPanel.tsx` and `useEntityTreeData.ts` combine branch failures themselves. | One branch's success must not erase another branch's failure. |

Paths without a prefix above are under
`src/renderer/src/features/entities/`, except `useIsCurrent.ts` and
`useEntityCounts.ts`, which are under `src/renderer/src/lib/`.

These are observed architectural inconsistencies, not reproduced runtime defects.
The existing polling module already owns useful behavior and should remain part
of the implementation rather than be replaced for symmetry.

## Scope and constraints

Preserve renderer-local entity state and renderer-driven polling. Preserve typed,
validated IPC, main-owned receivers, connection-lifetime PeekLock handles, message
serialization, replay ordering, purge safety caps, and purge progress delivery.

No global entity cache, Redux migration, push refresh, new dependencies,
configurable observation cap, uncapped counting, new retry policy, concurrency
throttling, or generic entity-loading framework. Do not redesign message browsing,
settlement, connection lifecycle, entity forms, or mutation workflows.

Use the existing scalar count channels; no new IPC channel or SDK exposure is
expected. Real-emulator verification remains necessary: mock adapters cannot
establish broker cursor or forwarding behavior.

## 1. Count-observation module

### Responsibility and seam

Deepen the existing renderer count module rather than add another pass-through
module. Its interface owns count eligibility, target addressing, observation
policy, and interpretation. Its implementation uses descriptions the caller
already retrieved and the existing IPC seam.

Callers supply the selected profile, the queue or subscription description, and
whether active messages or the DLQ is being observed. Callers must not construct
DLQ addresses, choose count caps/cursors, or duplicate forwarding predicates.
The final parameter shapes and exported names remain an implementation-design
decision.

The production IPC adapter and deterministic mock adapter justify the existing
test seam. No additional generic transport interface is needed.

### Required behavior

1. Queue and subscription observations are non-destructive. Queue DLQs use the
   existing shared DLQ-path helper internally; subscription DLQs use the existing
   subscription count channel's dead-letter option.
2. Always observe from sequence number zero with a cap of 250. Return scalar
   counts over IPC; never request full message descriptions solely for counting.
3. Distinguish three outcomes: observed count, unavailable due to forwarding,
   and failed observation carrying the original structured IPC error. Never
   represent any of these failures as a successful zero.
4. An observed value below 250 is displayed without a suffix; 250 is a lower
   bound and displays as `250+`. Do not claim a durable or transactional total.
5. Apply forwarding eligibility independently:

   | `forwardTo` | `forwardDeadLetteredMessagesTo` | Active observation | DLQ observation |
   | --- | --- | --- | --- |
   | Unset | Unset | Fetch | Fetch |
   | Set | Unset | Unavailable; no count request | Fetch |
   | Unset | Set | Fetch | Unavailable; no count request |
   | Set | Set | Unavailable; no count request | Unavailable; no count request |

6. Observe only requested targets. Do not fetch a DLQ merely because a caller
   requested an active count, or fetch metadata again for each observation.
7. Preserve per-target independence: a failure or forwarding setting for one
   target must not suppress a valid observation of another.
8. Expected IPC failures remain explicit outcomes. Unexpected promise rejection
   must reach the owning error path, not become zero, forwarding, or an unhandled
   background rejection.

### Caller integration

Migrate the entity tree, queue panel, topic subscription counts, and queue/DLQ
purge estimates to the same module. Remove forwarding predicates and cap/cursor
knowledge from those callers. Collapse the DLQ alias if it remains a pass-through.
Presentation may read the observation's forwarding state; it must not independently
decide whether a count request is permitted.

The queue panel must use its queue description before deciding count eligibility;
its current parallel metadata/count request cannot remain unconditional. Show
successful metadata without waiting for the subsequent count.

Presentation rules:

- Keep numeric badge formatting and the existing active `forwarding` badge.
  Use the same forwarding treatment in the queue panel, which currently lacks it.
- Keep DLQ numeric badges hidden at zero. A forwarding DLQ has no numeric badge;
  adding a new DLQ-forwarding badge is outside this change.
- On observation failure, keep the previous count for the same target in the
  same selection lifetime, or omit it if no previous count exists.
- On forwarding becoming enabled, remove the previous numeric observation even
  if one exists. Unavailable is not a transient failure eligible for retention.
- After successful listing refresh, remove observations for deleted entities.
  After listing failure, retain the previous list and observations.
- Do not add a toast per failed badge. Preserve main-process IPC error logging;
  badge omission/retention is deliberate degraded presentation, not success.

### Purge confirmation

Use a fresh count observation when Purge is clicked, not a cached badge count.
Pass available queue metadata and the active/DLQ choice through the control's
interface instead of reverse-parsing display labels or DLQ path strings.

Wait for initial metadata before allowing an estimate; do not make a speculative
count request while eligibility is unknown. A failed metadata load must leave
the panel's existing error visible rather than an unexplained disabled control.

An observed count opens the existing confirmation with its exact/lower-bound
label. A failed or forwarding-unavailable observation shows an actionable inline
explanation and does not open confirmation or start a purge. This preserves the
current requirement that a successful estimate precede confirmation; it does not
assert that the broker's purge operation itself is unsupported for forwarding.

If the profile or target changes, or the control unmounts while the estimate is
pending, discard that result. A confirmation for one target must never appear
against another target. Do not otherwise change purge start/progress behavior.

## 2. Selection-scoped refresh module

### Responsibility and seam

Deepen refresh ownership around the existing scheduler. The module's interface
exposes selection-local refresh data/status and manual refresh, not a protocol of
caller-owned reset callbacks, currency predicates, and asynchronous state setters.

Specialized queue, topic, and tree fetching remain implementation details.
Asynchronous fetch work produces outcomes; the owner decides whether and when
they may affect state. Internal phases may publish partial results through an
internal seam; do not require one all-or-nothing snapshot.

Keep count meaning in the count-observation module. This module owns when an
observation may affect local state, including retention and pruning.

### Selection lifetime

1. Identity includes profile and target: profile for the entity tree; profile and
   queue/topic for detail panels; active/DLQ distinction where relevant.
2. Every selection change creates a new lifetime, even A -> B -> A. Comparing
   only the current target name with the original name is insufficient.
3. Clear old-selection listings, descriptions, observations, refresh errors, and
   refresh timestamps. Start an initial refresh for the new selection.
4. Results from superseded lifetimes cannot update state, emit refresh toasts,
   advance timestamps, or dispatch `entitiesRefreshed`.
5. On teardown, stop timers and discard pending results and queued follow-ups.
   No IPC cancellation is required; completion of an old request grants no
   permission to apply its result.

### Scheduling

- Keep at most one refresh execution in flight per mounted refresh owner,
  including across selection changes. Separate owners may refresh concurrently.
- Skip timer ticks during an execution. Manual/post-mutation refresh requests
  during an execution coalesce into one follow-up.
- A selection change during an old execution resets visible state immediately
  and schedules a refresh for the latest selection after that execution settles.
  Intermediate selections need not be fetched.
- A manual request wins error-presentation precedence when requests coalesce.
- A null poll interval disables timers, not initial or manual refresh.
  Interval changes replace the timer without resetting selection-local data.
- Exceptions must release the execution guard and follow the error-presentation
  path. A later manual refresh must still be able to run.
- Preserve current refresh-return timing unless a changed completion contract
  is explicitly designed and its awaiting call sites are reviewed.

### Partial results and selection reconciliation

Apply successful metadata/listing branches independently. A failed topic listing
must not prevent a successful queue listing from appearing; failed subscription
listing must not erase successfully refreshed topic metadata.

Successful listing results may render before count work completes. A later count
failure cannot roll back successful metadata or erase prior valid observations.
Treat each active/DLQ observation independently using the retention rules above.

Dispatch selection reconciliation only from current, successful listings.
Represent a failed listing as unknown, not an empty list. A confirmed removal
clears the corresponding selected entity using the existing Redux behavior.

Do not let one branch's success clear another branch's error. Present one
deterministically chosen metadata failure per refresh: queues before topics in
the tree, topic metadata before subscriptions in the topic panel.

### Status and errors

Initial/manual metadata failures appear inline; timer-driven metadata failures
toast and do not replace an existing inline error. A subsequent refresh with
all required metadata branches successful clears the prior refresh error.
Stale failures produce neither inline changes nor toasts.

Required metadata branches are queue description for the queue panel; topic
description and subscription listing for the topic panel; queue and topic
listings for the tree. Count failures are degraded observations, not metadata
failures, and retain the presentation policy specified above. Unexpected refresh
exceptions, including rejected count promises outside the structured IPC result
contract, use the same inline/toast error path as metadata failures.

Mark the tree loaded once its current initial metadata attempt settles, including
failure; do not wait for count completion to end the initial listing state.
For panels, advance `lastRefreshed` when all required metadata branches succeed.
Count-only failure does not suppress that timestamp; it describes metadata
freshness, not proof that every count is fresh.

Mutation state and mutation errors remain owned by existing mutation workflows.
Do not silently conflate a mutation error with refresh status while migrating
callers.

### Intentional behavior changes

The queue panel gains the forwarding treatment already used elsewhere. Purge
estimates wait for metadata and use scalar counts rather than message bodies.
The tree's initial loaded state and panel metadata timestamps no longer wait for
count work to finish. Selection rejection covers superseded lifetimes, not just
different current names. Other existing display and interaction behavior stays
unchanged.

## Acceptance and verification

The interface is the test surface. Add focused behavioral tests in existing
files where possible; use controlled promises and fake timers, not sleeps.

| ID | Scenario | Required observable outcome |
| --- | --- | --- |
| C1 | Queue and subscription, all four forwarding combinations | Only eligible requested targets issue scalar count requests, with independent active/DLQ outcomes. |
| C2 | Zero, below cap, cap reached, and IPC failure | Zero remains valid; capped value is a lower bound; structured failures are retained and never become zero. |
| C3 | Count failure, deletion, forwarding change, and selection change | Retain only eligible same-lifetime prior observations; remove deleted or forwarding observations and all old-selection observations. |
| C4 | Purge estimate succeeds/fails/is unavailable | Correct confirmation label or inline explanation; no message bodies requested and no purge starts before confirmation. |
| C5 | Purge target changes during estimation | Old estimate cannot open confirmation or alter the new target's state. |
| R1 | Selection changes during listing and during count work | No old data, errors, toasts, timestamps, or reconciliation dispatches appear. |
| R2 | A -> B -> A with the original A request still pending | The original A lifetime cannot publish into the later A lifetime. |
| R3 | Several manual requests arrive during polling | No overlap; one follow-up; manual failure presentation wins. |
| R4 | One metadata branch succeeds and another fails | Successful data remains visible; failure remains visible; no all-or-nothing rollback. |
| R5 | Listing fails after prior success | Prior list/counts remain; unknown membership does not clear selection. |
| R6 | Unmount with pending work and queued refresh | No later state application, toast, reconciliation, timer, or follow-up execution. |
| R7 | Null/changed interval and rejected fetch | Initial/manual refresh still works; timer is replaced correctly; failure is surfaced and subsequent refresh can execute. |
| R8 | Metadata succeeds but a count fails | Prior count remains if eligible; metadata timestamp advances; successful metadata is not delayed or rolled back. |

Existing focused coverage to evolve:
`tests/unit/messageCount.test.ts`, `tests/unit/useEntityCounts.test.ts`,
`tests/unit/useEntityPanel.test.tsx`, `tests/unit/useEntityTreeData.test.tsx`,
and `tests/unit/usePolling.test.ts`. Add focused caller tests where the existing
files cannot establish purge or panel integration.

Replace obsolete call-count/currency-predicate tests only after observable
interface tests cover their guarantees. Keep useful internal scheduler tests;
do not duplicate every old test through an additional seam.

Keep and extend real-emulator checks in
`tests/integration/messagingService.integration.test.ts` and
`tests/integration/forwardingEntities.integration.test.ts`. Verify queue and
subscription DLQs, forwarding eligibility, and counts interleaved with explicit
sequence-number browsing. Do not assert that every broker cursor is isolated:
the existing emulator shares peek cursors, and Load more already supplies an
explicit sequence number.

## Delivery plan

1. **Count observation:** implement its outcome model and policy; migrate the
   tree, queue/topic panels, and purge estimates; remove bypasses and redundant
   aliases; cover C1-C5 and preserve existing emulator checks.
2. **Refresh ownership:** implement lifetime-aware result application around the
   scheduler; migrate tree and both panels; absorb count retention/pruning and
   reset/currency coordination into the implementation; cover R1-R8.
3. **Closeout:** remove only superseded exports/tests, update affected
   `ARCHITECTURE.md` sections, and verify both workflows at the UI surface.
   Correct the stale claims that browsing lacks pagination and that ordinary
   count requests transfer full message descriptions.

For each implementation phase, run targeted tests for the changed behavior,
then `npm run typecheck` and `npm run lint`. Run the affected integration suites
against the real emulator using the existing integration configuration. For the
final UI-facing result, follow the repository's `verify` skill to build, launch,
and drive the Electron app against the dev emulator: inspect active/DLQ badges,
forwarding, rapid selection changes, manual refresh during polling, and purge
confirmation/progress. Never purge unrelated or user-owned test data.

Completion requires all acceptance cases covered, no caller-owned count-policy
bypasses or refresh currency checks in the migrated owners, unchanged IPC
isolation and receiver ownership, and passing applicable checks.

## Draft decisions to confirm before implementation

Recommended defaults in this draft are:

- Reuse already-loaded descriptions; do not add metadata requests for counts.
- Keep the successful-estimate requirement for purge confirmation, including
  blocking confirmation when forwarding prevents estimation.
- Keep count failures quiet at the badge level while preserving explicit error
  outcomes and main-process logging.
- Preserve metadata-based timestamp meaning and current numeric badge styling;
  add no new freshness indicators.
- Keep serialization per mounted owner across selection changes rather than
  starting a second execution while the old one is still pending.

These choices bound the draft. Confirm or revise them before choosing concrete
interfaces or beginning implementation.
