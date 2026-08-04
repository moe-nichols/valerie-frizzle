# Plan: Fix Service Bus RestError/AggregateError + add real mac/win packaging targets

Status: **not started** — written 2026-08-04, to be executed later.

## Context

The user hit two errors in the running app's log (`~/AppData/Roaming/sb-emulator-manager/logs/main.log`,
2026-08-03 13:11–13:30):

1. A `RestError: ... expected the service to return valid xml content` from `AdminService.getQueue`
   (`src/main/services/adminService.ts:184-186`) **and** from `listQueuesAll`/`listTopicsAll` (via
   `collect()`, `adminService.ts:114-120`) — i.e. it hits both the single-entity GET and the sidebar's
   list-refresh path.
2. An opaque `AggregateError` (no inner detail logged) from `MessagingService.withPeekedBatch`
   (`src/main/services/messagingService.ts:139-155`), which every count/peek call funnels through.

The user also wants the app packaged into a real installable executable for Windows and macOS — today
`electron-builder.yml` has no `mac`/`win` targets, icons, or signing, and the README explicitly frames
this as "personal tool, no installer, by design." (User confirmed: extend this to real win+mac targets,
not just document the current ad-hoc flow.)

## What the log actually shows (read directly, not guessed)

Around 13:11–13:15, three occurrences of a **different, fully-detailed** error appear on the exact same
code path (`MessagingService.withPeekedBatch` → SDK's `ManagementClient.peekBySequenceNumber`):

```
ServiceBusError: InvalidOperationError: Cannot create a message browser on an entity with auto-forwarding
enabled. ... SystemTracker:sbemulatorns:topic:ps-product-sbt|ps-pricing-lectra-sbts ...
```

This is a **real, permanent Service Bus limitation** (not an emulator bug): you cannot peek/browse
messages on a queue or subscription that has `forwardTo` (auto-forwarding) configured. The topic
`ps-product-sbt` / subscription `ps-pricing-lectra-sbts` has it configured. Mechanically confirmed from
`node_modules/@azure/core-amqp/dist/commonjs/retry.js:120-166`: `retry()` throws the single error
directly when only one attempt fails (this case — `InvalidOperationError` isn't retried), and only wraps
multiple failed attempts into an `AggregateError`. So the `AggregateError` at 13:30:14 is a **separate,
genuinely-retryable transient failure** on some other peek/count call — its identity is unknown because
`wrapHandler.ts`'s `logRedacted` only logs `err.message`/`err.stack`, and for `AggregateError` those are
empty — the real detail lives in `err.errors[]`, which is silently dropped today.

For the RestError: `@azure/service-bus`'s `executeAtomXmlOperation`
(`node_modules/@azure/service-bus/dist-esm/src/util/atomXmlHelper.js:53-69`) throws exactly this message
when `parseXML(response.bodyAsText)` itself throws — i.e. the **raw response body isn't valid XML at
all** (distinct from the already-documented PUT-path gap in `adminService.ts:122-144`, which is a
different failure — a well-formed Atom entry missing expected fields). Neither `AdminService`'s DTOs
(`toQueueDescription`/`toTopicDescription`/`toSubscriptionDescription`, `adminService.ts:28-65`) nor
`shared/domain.ts`'s `QueueDescription`/`TopicDescription`/`SubscriptionDescription`/`Create*Input` map
or expose `forwardTo`/`forwardDeadLetteredMessagesTo` at all — confirmed via repo-wide grep, zero hits.
Given the timing correlation (both errors cluster in the same ~19-minute window, on entities this app has
no concept of), the leading hypothesis is: **listing or getting an entity that has `forwardTo` set
returns an Atom response this SDK version/emulator pairing can't parse**, but this is not yet proven — it
needs a live repro.

One more relevant finding: `useEntityTreeData.ts`'s `reportRefreshError` *does* call `toast.error` for
poll-driven failures (`useEntityPanel.ts:12-21`), so a toast should have fired for the list-refresh
RestErrors. The user didn't notice one — most likely several near-identical toasts fired in a ~50-second
burst and were easy to miss, not a separate bug. Not pursuing this further unless it recurs.

## Recommended approach

### Step 1 — Ship the logging fix first, independent of root cause (low risk, high value)

`src/main/ipc/wrapHandler.ts`:
- In `logRedacted` (lines 53-60), when `err instanceof AggregateError` (or duck-typed
  `Array.isArray(err.errors)`), also log each inner error's redacted `name`/`code`/`message` — not just
  the outer (empty) message. Keep running every inner message through `redactSecrets` — a nested error
  can still carry a connection string.
- In `toResult` (lines 14-34), build a richer `message` from the unwrapped inner errors for this shape
  even though it still maps to `UNEXPECTED_ERROR` (don't add a new `IpcErrorCode` for this — `IpcErrorCode`
  is a closed union consumed exhaustively by the renderer, per `shared/errors.ts`'s doc comment, and
  nothing here calls for renderer-visible differentiation yet).
- This alone makes any *future* occurrence of either error immediately diagnosable from the log, which
  today's code cannot provide (confirmed: the AggregateError log line has zero usable detail).

### Step 2 — Reproduce for real against the Docker emulator (per standing practice: reproduce before fixing)

Using the existing integration harness (`tests/integration/harness.ts`, `testClient.ts`):
- Create a queue and a topic+subscription with `forwardTo` pointing at another real queue. Since no DTO
  exposes this field, create it via the raw `ServiceBusAdministrationClient` in the test (not through
  `AdminService`), mirroring how `ps-product-sbt`/`ps-pricing-lectra-sbts` must have been created (outside
  this app).
- Call `getQueue`/`listQueues`/`listTopics` (via `AdminService`, real client) against that entity and
  confirm whether the exact RestError reproduces. If it does, capture `response.bodyAsText` (e.g. a
  thin wrapper around `sendRequest`, or a temporary log line in a local checkout of the SDK) to see the
  actual malformed bytes and pin the true cause (bad XML escaping in the emulator's `ForwardTo` value,
  a proxy issue, or something else).
- Call `peekMessages`/`countMessages` (via `MessagingService`) against the forwarding-enabled
  subscription and confirm the `InvalidOperationError` reproduces on this exact SDK version.
- Add a concurrency-burst scenario (mirrors `useEntityCounts.updateCounts`'s `Promise.all` polling
  pattern) peeking many queues at once, to try to reproduce the still-unidentified retryable error behind
  the `AggregateError`.

### Step 3 — Fix `AdminService` (list/get path) once Step 2 confirms the shape

If confirmed to be the missing-`forwardTo`-mapping class of bug: extend `toQueueDescription`/
`toTopicDescription`/`toSubscriptionDescription` to map `forwardTo`/`forwardDeadLetteredMessagesTo`
(matching the SDK's `QueueProperties`/`TopicProperties`/`SubscriptionProperties` fields), and add the
corresponding fields to `QueueDescription`/`TopicDescription`/`SubscriptionDescription` in
`shared/domain.ts`. If the response is genuinely malformed XML regardless of what the app maps (an
emulator-side bug), the fix is a bounded, narrow catch-and-retry (or catch-and-return-partial) analogous
to `runUpdateWithEmulatorParseWorkaround` (`adminService.ts:132-144`) — document the confirmed cause
directly above the fix, matching this file's existing convention (lines 122-131, 162-170).

### Step 4 — Fix `MessagingService`/renderer for forwarding-enabled entities

This is the real fix, not just error-handling: peeking/counting a forwarding-enabled entity is
**fundamentally unsupported by the service**, so the goal is to stop attempting it, not to catch its
failure more gracefully.
- Expose `forwardTo` on `QueueDescription`/`SubscriptionDescription` (step 3).
- In the renderer (`useEntityTreeData.ts`, `useEntityCounts.ts`, `EntityCountBadges.tsx`), skip the
  peek-based count fetch for any entity with `forwardTo` set, and show a distinct badge state (e.g.
  "forwarding enabled" instead of a count) rather than calling `countMessages` at all.
- Regardless, bring `withPeekedBatch` (`messagingService.ts:139-155`) in line with the existing
  `drainReceiver` pattern (lines 280-285): wrap `receiver.peekMessages(...)` in try/catch, and rethrow
  after the `finally`'s close — today it relies solely on `finally`, which is inconsistent with its
  sibling method in the same file. Use the catch to recognize `InvalidOperationError` specifically (by
  `err.code`, no SDK import, matching `isEntityNotFoundError`'s style) and produce a clear message even
  before Step 4's UI-level skip ships, as defense in depth.
- Once Step 2 identifies the retryable error behind the `AggregateError`, decide whether `withPeekedBatch`
  should retry in-app or whether the real fix is throttling `useEntityCounts.updateCounts`'s concurrent
  burst (Promise.all across every visible entity) — flag this trade-off for a quick check-in once the
  identity is known, don't guess now.

### Step 5 — New/updated tests

- `tests/unit/adminService.test.ts`: a case for whatever Step 2/3 confirms (either forwardTo round-trip
  mapping, or the parse-workaround), mirroring the existing `"retries via refetch..."` /
  `"propagates real update failures..."` pair (lines 62-95).
- `tests/unit/messagingService.test.ts`: extend `FakeReceiver` (currently only `receiveMessages` can
  throw, lines 18-21) to let `peekMessages` throw an `InvalidOperationError`-shaped error and an
  `AggregateError`-shaped one; assert `withPeekedBatch`'s catch/rethrow/close behavior.
- `tests/unit/wrapHandler.test.ts`: assert `toResult`'s message includes unwrapped `AggregateError.errors`
  detail, following the existing `MessageEntityNotFoundError` test shape (lines 57-68).
- `tests/integration/adminService.integration.test.ts` /
  `tests/integration/messagingService.integration.test.ts`: the confirmed repro from Step 2, pinned as a
  permanent regression test the same way `adminHttpsProxy.integration.test.ts:31-39` pins the emulator's
  404 shape.

## Packaging: add real Windows + macOS targets

`electron-builder.yml`:
- Add a `mac:` section (`target: dmg`, `category: public.app-category.developer-tools`) and a `win:`
  section (`target: nsis`, with `nsis: { oneClick: false, allowToChangeInstallationDirectory: true }` —
  reasonable defaults for a tool the user will run themselves).
- No icons exist in the repo today (only electron-builder's own placeholder icons under
  `node_modules/`) and none are being added by this plan — electron-builder falls back to its default
  icon on both platforms. Call this out explicitly; adding a real icon is a separate, design-driven task
  the user can request later.
- Leave signing/notarization unset, as today — an unsigned `.exe` will trigger SmartScreen, an unsigned
  `.dmg`/`.app` will trigger Gatekeeper (right-click → Open, or `xattr -cr` on first launch). Expected
  and acceptable for a personal tool per the README's existing framing.

`package.json` scripts: add
```
"build:mac": "electron-vite build && electron-builder --mac",
"build:win": "electron-vite build && electron-builder --win"
```
alongside the existing `build:unpacked` (kept for quick local `--dir` iteration).

**Platform caveat to flag to the user directly**: electron-builder's mac `dmg` target (and any future
signing/notarization) requires running on an actual Mac — it cannot cross-build a real `.dmg` from
Windows. Since there's no CI in this repo, producing the macOS artifact means running
`npm run build:mac` on a Mac. `npm run build:win` can run on the current Windows machine directly.

`README.md`: replace the "Building a local unpacked build" section with the two new commands plus the
above platform caveat.

## Verification

- `npm run test:unit` and `npm run test:integration` (the latter requires Docker) after the service/test
  changes — both must pass, including the new repro-turned-regression tests.
- `npm run typecheck` and `npm run lint`.
- Manually run the app against the real Docker emulator (`docker compose -f
  docker/servicebus-emulator/docker-compose.yml up -d`), connect a profile, and confirm: a
  forwarding-enabled entity (if reproducible in the emulator) no longer throws — its badge shows the new
  "forwarding enabled" state instead of erroring, and the sidebar list refresh no longer errors on it.
- `npm run build:win` locally to confirm an actual NSIS installer is produced under `dist/`; note in the
  handoff that `build:mac` needs to be run on a Mac to verify the `.dmg` output.

## Open questions to resolve before/during execution

- The exact malformed-XML content behind the RestError (Step 2 needs to actually capture
  `response.bodyAsText`) — not yet confirmed, only strongly correlated by timing/entity.
- The identity of the retryable error behind the `AggregateError` — currently unknown; Step 1's logging
  fix plus a recurrence (or Step 2's concurrency-burst repro attempt) is what will surface it.
- Whether to retry in `withPeekedBatch` vs. throttle `useEntityCounts`'s polling burst (Step 4) — depends
  on what Step 2 finds.
