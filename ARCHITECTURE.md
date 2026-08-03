# Architecture

## Process model

This is a standard three-process Electron app, bundled with `electron-vite`:

```
┌─────────────────────────┐        ┌───────────────────────────┐
│   Renderer (Chromium)   │        │   Main (Node.js)          │
│   React + TypeScript    │  IPC   │   Owns all Azure SDK      │
│   src/renderer/         │◄──────►│   calls, SQLite, the TLS  │
│                         │        │   proxy, window lifecycle │
└───────────┬─────────────┘        └─────────────┬─────────────┘
            │                                    │
            │         ┌─────────────────────┐    │
            └────────►│  Preload (bridge)   │◄───┘
                      │  contextBridge only │
                      │  src/preload/       │
                      └─────────────────────┘

                  ┌────────────────────────┐
                  │  Shared (pure types)   │
                  │  src/shared/           │
                  │  imported by all three │
                  └────────────────────────┘
```

- **Main process** (`src/main/`) — runs on Electron's bundled Node. Owns every
  `@azure/service-bus` SDK call, the SQLite database, the local TLS proxy, and the
  `BrowserWindow` lifecycle. Nothing in the renderer ever imports the SDK or touches the
  filesystem directly.
- **Preload** (`src/preload/index.ts`) — the *only* bridge between renderer and main.
  Exposes a single global, `window.sbAdmin`, via `contextBridge.exposeInMainWorld`. The
  app runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` at
  all times — the renderer has zero direct access to Node or Electron APIs. The exposed
  API's type (`SbAdminApi`) is explicitly exported from `index.ts` for `index.d.ts`'s
  global augmentation to pick up — without that export, `window.sbAdmin.*` silently
  type-checks as `any` everywhere in the renderer (a real gap this codebase hit once;
  keep the export if you ever restructure this file).
- **Renderer** (`src/renderer/src/`) — React 19 + TypeScript, Vite-bundled. State is
  split deliberately: genuinely cross-cutting state lives in two small Redux Toolkit
  slices (`store/connectionsSlice.ts` — which profile/queue/topic is selected, which
  profiles are connected/connecting; `store/settingsSlice.ts` — the poll interval),
  because that state is read and mutated from multiple, otherwise-unrelated components
  (the sidebar tree, the detail panels, the settings dialog). Everything else — entity
  lists, form fields, dialog open/close flags, in-flight/loading state — stays local
  `useState` in the component that owns it; Redux's own style guide argues against
  centralizing state nothing else needs, and most of this app's state fits that
  description. See [Renderer structure](#renderer-structure) below for how the
  components themselves are organized.
- **Shared** (`src/shared/`) — pure TypeScript types only: DTOs (`domain.ts`), the typed
  IPC channel map (`ipc-contract.ts`), and the `Result<T>` error-handling convention
  (`errors.ts`). Deliberately has **zero** imports of `electron`, `better-sqlite3`, or
  the Azure SDK, which is what lets it be imported by all three processes *and* by plain
  Vitest unit tests with no Electron runtime involved.

## The IPC contract

Every main ↔ renderer interaction goes through one typed contract,
`src/shared/ipc-contract.ts`:

```ts
export interface IpcChannels {
  'entities:queues:create': {
    request: { profileId: string; input: CreateQueueInput }
    response: Result<QueueDescription>
  }
  // ...one entry per channel, request and response both typed
}
```

- **Main-process handlers** live in `src/main/ipc/<domain>.ipc.ts` (`app`,
  `preferences`, `connections`, `entities`, `messages`), one `registerXIpcHandlers()`
  function per file, all wired up from `src/main/ipc/register.ts`.
- **Preload** (`src/preload/index.ts`) exposes a matching method under
  `window.sbAdmin.<domain>.<action>` for every channel, so the request/response shape on
  both sides is compile-time locked to the same `IpcChannels` entry — a typo or a
  mismatched signature is a build failure, not a runtime surprise.
- **Every handler is registered through `registerHandler()`** (`src/main/ipc/wrapHandler.ts`),
  which bakes in three guarantees so individual handlers stay trivial. First, the incoming
  payload is validated against the channel's zod schema (`src/shared/ipc-schemas.ts`) before
  the handler runs — the `IpcChannels` request types are compile-time only and erased at
  runtime, so nothing else stops a buggy or compromised renderer from sending `maxCount: -1`
  or a non-string entity path straight into the Azure SDK; a bad payload becomes a
  `VALIDATION_ERROR` `Result`, never an SDK call. The schema map is typed
  `{ [K in keyof IpcChannels]: ZodType<request> }`, so the compiler enforces that every
  channel has a schema and that no schema drifts from the contract. Second, the handler's
  return value is wrapped in a `Result<T>` (`{ ok: true, data } | { ok: false, error }`) —
  handlers return plain data; nothing is ever allowed to throw across the IPC boundary,
  since Electron serializes thrown errors lossily (you lose the stack, sometimes the
  message). Errors carry a typed code (`IpcErrorCode` in `shared/errors.ts`): services
  throw `AppError` with `NOT_CONNECTED`/`NOT_FOUND`/`PARTIAL_SUCCESS` where the failure is
  meaningful to the UI (e.g. resubmit's partial success renders as "do NOT resubmit
  again", not a generic failure), SDK not-found shapes are mapped to `NOT_FOUND`, and
  anything else becomes `UNEXPECTED_ERROR`. Third, because this is the one place *every*
  real failure passes through, it's where every error gets logged (`log.error()` via
  `electron-log`, with `SharedAccessKey` values redacted before they can reach the
  on-disk log file).
- **Long-running operations use a start/subscribe pattern instead of blocking a single
  `invoke`.** Purging a large queue can take a while, so `messages:purge:start` returns
  immediately with a `jobId`; the main process pushes progress via
  `webContents.send(PURGE_PROGRESS_CHANNEL, { jobId, deletedCount, done })` as the drain
  loop runs, and preload exposes it as `window.sbAdmin.messages.onPurgeProgress(jobId,
  callback)`, returning an unsubscribe function. Because the drain starts before the
  renderer can possibly subscribe (it needs the `jobId` from the invoke result first), the
  preload buffers each job's events until its subscriber attaches
  (`src/preload/purgeProgressHub.ts`) — without that, a fast purge's first events, or even
  its terminal `done`, would be silently dropped. This is the only push-event channel in
  the app; if a second one is ever needed, it's worth generalizing the pattern rather
  than adding another one-off channel constant. (Queue/topic/message-count refreshing —
  see [Polling, not push](#polling-not-push) below — deliberately does *not* use this
  pattern; it's driven from the renderer instead.)

## Main-process services

Everything under `src/main/services/` is a thin, single-purpose wrapper — none of them
know about IPC or Electron's `ipcMain`, so they're testable (and were tested, in
integration tests) as plain TypeScript classes/functions against a real running emulator.

| File                                 | Responsibility                                                                                                                                                                                                                                                                                                                                  |
|--------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `adminHttpsProxy.ts`                 | Local `node:https` reverse proxy that makes the JS SDK's admin client work against the emulator at all. See [below](#admin-api-vs-messaging-api-and-the-https-proxy-workaround).                                                                                                                                                                |
| `connectionManager.ts`               | `Map<profileId, ActiveConnection>` — the lifecycle hub. `connect()` starts a proxy, constructs `ServiceBusAdministrationClient` + `ServiceBusClient` + a `MessagingService`, and does a cheap liveness check before returning success. `disconnect()`/`disconnectAll()` tear everything back down, including any still-open PeekLock receivers. |
| `adminService.ts`                    | Stateless CRUD for queues/topics/subscriptions/rules. Constructed fresh per IPC request (safe, since it holds no state) — see [Emulator quirks](#emulator-quirks-and-workarounds) for the update-response and message-count issues it works around.                                                                                             |
| `messagingService.ts`                | Send/peek/receive + PeekLock settlement (complete/abandon/dead-letter), plus peeking a *subscription* specifically (`peekSubscriptionMessages` — a distinct SDK overload from a queue peek, see [below](#peeking-a-subscription-is-not-peeking-a-queue)). **Stateful**, unlike `adminService.ts` — see [below](#why-messagingservice-is-stateful). |
| `purgeService.ts`                    | `purgeEntity()` — a receive-and-delete drain loop, plus the pure `isPurgeComplete()` helper that decides when to stop. Works identically against a regular queue or a DLQ; see [DLQ handling](#dlq-handling-is-just-a-different-entity-path).                                                                                                   |
| `replayService.ts`                   | `resubmitMessage()` — moves a dead-lettered message back to its origin. Builds the resend envelope from the DTO the renderer already has (`buildResubmitEnvelope()`, pure), sends it, and only completes the DLQ original *after* the send succeeds.                                                                                            |
| `windowState.ts`                     | Persists/restores the main window's size and position across launches. `parseWindowState()`/`clampToVisibleDisplay()` are pure (defensive against corrupted preference data and monitors that are no longer connected); load/save go through `PreferencesRepo`.                                                                                 |
| `pollPreference.ts`                  | Persists/restores the user-configurable poll interval (queue/topic sync + message counts — see [Polling, not push](#polling-not-push)). `parsePollIntervalMs()`/`clampPollIntervalMs()` are pure, mirroring `windowState.ts`'s shape exactly; load/save go through `PreferencesRepo`.                                                          |
| `themePreference.ts`                 | Persists/restores the light/dark theme choice (`preferences:theme:get`/`set`). Same pure-`parseTheme` + impure-load/save shape as `pollPreference.ts`; the `Theme` type and default live in `shared/theme.ts` so the renderer's `settingsSlice` shares one definition.                                                                          |
| `db/database.ts`, `db/migrations.ts` | `better-sqlite3` connection + a small numbered-migration runner.                                                                                                                                                                                                                                                                                |
| `db/profilesRepo.ts`                 | CRUD for saved connection profiles.                                                                                                                                                                                                                                                                                                             |
| `db/preferencesRepo.ts`              | Generic key-value store — backs `windowState.ts`, `pollPreference.ts`, and `themePreference.ts`, and is the natural home for any future small piece of persisted app state.                                                                                                                                                                     |

### Admin API vs. messaging API, and the HTTPS proxy workaround

The single most important thing to understand about this codebase: **the JS/TS Azure
Service Bus SDK's `ServiceBusAdministrationClient` does not work against the emulator
out of the box.** It hardcodes `https://` for every management request, but the
emulator's management API (port `5300`, separate from the AMQP messaging port `5672`)
only ever serves plain HTTP. (Microsoft's own docs describe admin-client support as
"natively supported in .NET" — JS/TS isn't there yet; see the still-open
[Azure/azure-service-bus-emulator-installer#17](https://github.com/Azure/azure-service-bus-emulator-installer/issues/17).)

`adminHttpsProxy.ts` works around this with a small local TLS-terminating reverse proxy:
it generates a self-signed cert (via the pure-JS `selfsigned` package, no `openssl`
dependency), listens on `https://localhost:<random port>`, and forwards everything to
the emulator's real plain-HTTP management port. `ServiceBusAdministrationClient` is
pointed at the proxy instead of the emulator directly, trusting the cert via the SDK's
own supported `tlsOptions.ca` option — no global `NODE_TLS_REJECT_UNAUTHORIZED` hack, no
SDK patching. `connectionManager.ts` starts one proxy per connected profile and tears it
down on disconnect. **Messaging** (`ServiceBusClient`, AMQP) needs none of this and talks
to the emulator directly — the proxy exists solely for the admin/management surface.

### Why `MessagingService` is stateful

`AdminService` is constructed fresh per IPC request because it's genuinely stateless.
`MessagingService` can't be: PeekLock's settlement methods (`completeMessage`/
`abandonMessage`/`deadLetterMessage`) need the *same* SDK message object and the *same*
receiver that the original receive call produced, and neither can cross the IPC
boundary. A generated `handleId` stands in for that pair across IPC, held in a `Map`
inside `MessagingService` — which means one `MessagingService` instance has to live for
a connected profile's *entire* lifetime, not be recreated per request.
`connectionManager.ts` owns this instance per connection and closes it (releasing any
still-open receivers) on disconnect.

### Peeking a subscription is not peeking a queue

Unlike a DLQ (just a suffix on the same path, see below), peeking a **subscription**
uses a genuinely different SDK surface than a queue: `client.createReceiver(entityPath)`
(one arg) for a queue vs. `client.createReceiver(topicName, subscriptionName)` (two
args) for a subscription — confirmed by reading the SDK's type declarations. This is why
`MessagingService.peekSubscriptionMessages()` exists as its own method, and
`messages:peekSubscription` as its own IPC channel, rather than a subscription just being
another string passed to the existing `peekMessages`/`messages:peek`.

### DLQ handling is just a different entity path

The SDK has no native "move a DLQ message back to its queue" operation, and no dedicated
DLQ-purge API either — but there's also no need for one. A dead-letter sub-queue's
address is nothing more than the entity's own name with `/$DeadLetterQueue` appended
(confirmed by reading the SDK source: that's literally all `createReceiver(name, {
subQueueType: 'deadLetter' })` does internally). `buildDeadLetterQueuePath()` in
`shared/domain.ts` is the one place that suffix is spelled out — every other DLQ-facing
piece of code (peek, receive, purge) just calls existing entity-path-taking methods with
that path. `purgeService.ts`'s drain loop, in particular, needed **zero** DLQ-specific
code to also purge a DLQ.

Resubmit (`replayService.ts`) works from the `ReceivedMessageDescription` DTO the
renderer already received over IPC, not by reaching into `MessagingService`'s internal
PeekLock handle map for the raw SDK message — keeping "no SDK type ever crosses IPC"
intact rather than opening a new hole in `MessagingService`'s encapsulation for one
feature. It sends the resubmit envelope to the destination **first**, and only completes
the DLQ original after that succeeds; reordering this would silently lose a message on a
failed send.

## Renderer structure

```
src/renderer/src/
  App.tsx                          # sidebar shell + which detail panel is showing
  components/
    ConfirmDialog.tsx              # the one confirmation dialog for destructive actions
    FormDialog.tsx                 # the one dialog shell for IPC-backed forms (error alert, submit guard, success toast)
    EmptyState.tsx                 # the muted "nothing here" one-liner
  lib/
    monaco.ts                      # Monaco worker setup, local-bundle loader config
    messageCount.ts                # shared peek-based count fetching (queues + subscriptions)
    usePolling.ts                  # interval + guarded manual refresh (one in-flight guard for both)
    useIsCurrent.ts                # stale-async-result predicate for the un-keyed panels
    useEntityCounts.ts             # per-entity count map with keep-previous-on-failure merging
    useAsyncSubmit.ts              # form submission lifecycle: double-submit guard + error state
    parseEnum.ts                   # narrows Select/RadioGroup string values without `as`-casts
  store/
    store.ts, hooks.ts             # configureStore + typed useAppDispatch/useAppSelector
    connectionsSlice.ts            # selected profile/queue/topic, connected/connecting ids
    settingsSlice.ts               # poll interval + theme
  features/
    connections/
      ConnectionSidebar.tsx        # sidebar list: connect/disconnect/delete profiles
      AddConnectionDialog.tsx
    entities/
      EntityTree.tsx               # sidebar-nested queues/topics under the selected connection
      EntityTreeSection.tsx        # one generic Queues/Topics section (header, rows, actions menu)
      useEntityTreeData.ts         # the tree's data layer: listings + counts + polling, staleness-guarded
      CreateEntityDialog.tsx       # one parameterized add-queue/add-topic dialog
      EditEntityDialogs.tsx        # edit queue/topic/subscription — configuration over one generic dialog
      entityFields.tsx             # Text/Number/Checkbox field primitives for entity forms
      entityForms.tsx              # FieldsState objects + field groups + DTO converters per entity kind
      useEntityPanel.ts            # shared panel scaffolding: poll wiring + reset-on-selection-change
      PanelRefreshControls.tsx     # refresh button + "Updated {time}" pair for panel titles
      EntityCountBadges.tsx        # active/DLQ count badge pair
      QueuePanel.tsx               # queue detail: status, purge, send/browse/DLQ
      TopicPanel.tsx               # topic detail: status, send, subscriptions (+ their rules/messages)
      SubscriptionRules.tsx        # per-subscription SQL/correlation rule CRUD
      SubscriptionMessages.tsx     # collapsible per-subscription message browser (+ its DLQ)
      QueuePurgeControl.tsx        # purge confirm → progress → dismiss; works for a queue or a DLQ
    messages/
      MessageComposer.tsx          # Monaco body editor (text/JSON/XML) + broker properties + app properties
      MessageBrowser.tsx           # peek/receive state + toolbar; optionally resubmit-enabled (see below)
      MessageTable.tsx             # the sortable results table + per-row settle actions
      MessageDetailDialog.tsx      # read-only single-message inspection
    settings/
      SettingsButton.tsx, SettingsDialog.tsx   # poll-interval + theme preferences
```

Queues and topics are sidebar tree children of their connection (`EntityTree.tsx`,
rendered only for whichever connection is currently selected) rather than a flat list in
the main content area; selecting one opens a dedicated detail panel (`QueuePanel`/
`TopicPanel`) in place of the old always-visible entity list + a separate "Messages"
card. Deleting a queue/topic lives in the sidebar tree item's own dropdown, mirroring how
deleting a *connection* already works — this keeps `QueuePanel`/`TopicPanel` focused on
*using* an entity, and avoids a cross-component "tell the tree to refresh its list"
problem, since the component that owns the list is the same one that triggers the delete.

Two components are deliberately generalized rather than duplicated for DLQ use:

- `MessageBrowser` takes an optional `resubmitDestination` prop. When set, it shows a
  dead-letter-reason column, a "regenerate MessageId" checkbox (defaulted on — reusing
  the original id would look like a duplicate if duplicate detection is enabled on the
  destination), and a per-row Resubmit button.
- `QueuePurgeControl` takes `entityPath` + an optional `displayName`, so the exact same
  component purges either a regular queue or its DLQ.

`QueuePanel` wires the DLQ UI in by simply rendering a second `MessageBrowser` +
`QueuePurgeControl` pair pointed at `buildDeadLetterQueuePath(queueName)` — no
DLQ-specific component exists anywhere in the renderer.

## Polling, not push

Queue/topic existence and message counts are kept in sync with the emulator by polling,
not a push channel — `usePolling(callback, intervalMs)` wraps a plain `setInterval`,
used independently by `EntityTree` (queue/topic list), `QueuePanel` (one queue's detail +
count), and `TopicPanel` (one topic's detail + its subscriptions' counts). The interval
comes from `settingsSlice`'s `pollIntervalMs` (`null` until the persisted preference
loads, so nothing polls at a guessed default before the real value arrives), editable via
the Settings dialog (`features/settings/`) and persisted through the same
`preferences:pollInterval:get`/`set` IPC pair described above.

Two reasons this is simpler than a push channel:

- **Scope is already small.** `EntityTree` only polls for the *selected* connection, and
  only that connection's queue/topic *names* — not every connected profile's full entity
  tree at once. `QueuePanel`/`TopicPanel` only exist (and thus only poll) while their
  entity is the one being viewed. There's no unbounded fan-out to push updates for.
- **"Remove what's gone" falls out of the existing refresh for free.** `EntityTree`'s
  refresh replaces its `queues`/`topics` state wholesale from the list response and
  dispatches `entitiesRefreshed` with the fresh name lists; the slice clears any active
  selection the listing no longer contains (scoped to the reporting profile), which also
  closes an open panel for that entity automatically. Keeping the rule in the slice means
  the component never has to diff old state against new.

Message counts are peek-based (see [Emulator quirks](#emulator-quirks-and-workarounds)
below — there's no real count API), which means polling for counts **shares the same
per-entity peek cursor** as manual browsing in `MessageBrowser`. Every count-fetch
(`lib/messageCount.ts`) explicitly passes `fromSequenceNumber: 0` to get a trustworthy
count each time, but that also means background polling keeps resetting the shared
cursor — a user paging through `MessageBrowser`'s peek while polling is active will
always see "from the start" rather than advancing. `MessageBrowser` doesn't do
cursor-based pagination today regardless (each "Peek" click just shows the latest batch
from wherever the cursor is), so this isn't a regression so much as an existing quirk
that polling now also participates in. Not solved here — worth knowing if it's ever
surprising during a driven-UI check.

One known cost: because there is no real count API, each poll tick issues one capped
peek (up to 250 messages, main-process-side only) **per visible entity** — an N+1 burst
that grows with the number of queues/subscriptions on screen. Fine at emulator scale;
if it ever matters, batching or caching counts main-side is the place to fix it.

## Emulator quirks and workarounds

These were all found empirically, against the real running emulator — not assumed —
and each one is the reason for a specific, narrowly-scoped piece of code. If you're
touching related code, read the relevant one first.

| Quirk                                                                                                                                                                                                                                                                  | Where it's handled                                                                                                                                                                                                                                   |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Admin client hardcodes HTTPS; emulator's management API is plain HTTP only                                                                                                                                                                                             | `adminHttpsProxy.ts` — see [above](#admin-api-vs-messaging-api-and-the-https-proxy-workaround)                                                                                                                                                       |
| `updateQueue`/`updateTopic`/`updateSubscription` throw a client-side `PARSE_ERROR` even when the update **succeeds server-side** — the PUT response is missing several fields (`SizeInBytes`, `CreatedAt`, `AuthorizationRules`, etc.) the SDK's deserializer requires | `adminService.ts`'s `runUpdateWithEmulatorParseWorkaround()` — catches specifically `err.code === 'PARSE_ERROR'`, treats it as success, and re-fetches. Any other error still propagates normally.                                                   |
| `maxSizeInMegabytes` is silently ignored by the emulator at both create and update time (always comes back as the default 100)                                                                                                                                         | Not worked around — just don't rely on it. `maxDeliveryCount`/`defaultMessageTimeToLive` both apply correctly and are used instead where a "does this actually change" test is needed.                                                               |
| The emulator's GET-queue response has **no** `CountDetails`/`SizeInBytes`/`AccessedAt` at all (confirmed even with real messages present) — there is no working queue-stats API, for queues *or* subscriptions                                                        | `adminService.ts` has no `getActiveMessageCount` method at all (removed after confirming this — see the comment at the top of the class). All message counts in the app — the purge confirmation dialog, the sidebar tree, both detail panels — come from a capped `MessagingService.peekMessages()`/`peekSubscriptionMessages()` call instead (`lib/messageCount.ts`), shown as "N+" once the cap is hit. |
| `peekMessages()` without an explicit `fromSequenceNumber` continues from wherever the entity's peek cursor **last was** — a cursor shared across every caller of that entity, not scoped to the current component or connection                                        | Anywhere peek is used to get a fresh count (not just to browse), pass `fromSequenceNumber: 0` explicitly (`lib/messageCount.ts`'s `PEEK_FROM_START`). This now includes poll-driven count-fetching — see [Polling, not push](#polling-not-push) above for the resulting interaction with manual browsing. |
| Peeking a **subscription** requires a distinct two-arg SDK call (`createReceiver(topicName, subscriptionName)`), not the single-path `createReceiver(entityPath)` a queue or DLQ uses                                                                                 | `MessagingService.peekSubscriptionMessages()` / `messages:peekSubscription` — see [above](#peeking-a-subscription-is-not-peeking-a-queue).                                                                                                          |
| Every new subscription gets an auto-created `$Default` rule (`SqlRuleFilter`, `sqlExpression: "1=1"`)                                                                                                                                                                  | Not a bug — just don't write code or tests that assume a fresh subscription has zero rules.                                                                                                                                                          |
| A dead-letter sub-queue has no dedicated SDK surface, but its entity path is just `"<name>/$DeadLetterQueue"`                                                                                                                                                          | `buildDeadLetterQueuePath()` in `shared/domain.ts` — see [above](#dlq-handling-is-just-a-different-entity-path).                                                                                                                                     |

## Persistence

`better-sqlite3` at `app.getPath('userData')/app.db`, with a small hand-rolled
numbered-migration runner (`db/migrations.ts`) rather than a full migration framework —
there are two tables (`connection_profiles`, `preferences`), so a heavier tool wasn't
justified. `preferences` is a generic key-value store, currently holding the main
window's size/position (`windowState.ts`), the poll interval (`pollPreference.ts`), and
the theme (`themePreference.ts`); all follow the same shape — a pure `parseX`/`clampX` function the impure load/save
wraps, defensive against missing, corrupted, or out-of-range saved data, unit-tested
without a real database or Electron. Connection strings are stored in plaintext; the
emulator's SAS key is a fixed, documented dev-only value, not a real secret, so this is
fine for what this app talks to (never point a saved profile at a real Azure namespace).

**A note on `userData` paths, since it's easy to get confused while debugging:** Electron
resolves `app.getPath('userData')` differently depending on *how* the app was launched,
which matters if you're ever inspecting or clearing out app state by hand:

- `npm run dev` or a genuinely packaged launch → resolves from `package.json`'s `name`
  field → `~/Library/Application Support/sb-emulator-manager/` (macOS).
- Launching `out/main/index.js` directly (e.g. via Playwright's `_electron.launch()`
  without an `executablePath`) → bypasses normal app-name resolution entirely → the
  generic `~/Library/Application Support/Electron/`.

If you're hunting for "where did this connection profile / window size come from" and
one location comes up empty, check the other.

## Logging

`electron-log` is initialized in `src/main/index.ts` with `{ preload: false }` —
deliberately main-process-only. Every real failure in the app already flows through
`toResult()` (see [The IPC contract](#the-ipc-contract) above), so that's the primary
place `log.error()` is called (shutdown/disconnect cleanup warnings are the one other
spot); `SharedAccessKey` values are redacted before anything is written, since SDK
connection errors can embed the full connection string.
Renderer-side logging was left out of scope on purpose — wiring electron-log's renderer
transport means an *additional* preload script gets injected into every session
alongside this app's own explicit `contextBridge` preload, which wasn't judged worth the
added surface for a personal tool where renderer errors already show up in devtools.
Log file location is the OS default (`~/Library/Logs/<app>/main.log` on macOS) — the one
place that matters for a packaged build run with no attached terminal.

## Testing strategy

Two tiers, deliberately kept separate:

- **`npm run test:unit`** (`vitest.config.ts`, `tests/unit/**`) — everything that runs
  without Docker or Electron: pure helpers (filter/envelope/path-building,
  `isPurgeComplete()`, `buildResubmitEnvelope()`, parse/clamp functions), `ProfilesRepo`
  against a real temp SQLite file, the IPC choke point (`wrapHandler`/`toResult` with
  `electron` mocked), the preload's purge-progress buffering hub, the Redux slices, and
  the renderer's polling/staleness hooks (via `@testing-library/react` under jsdom).
  Runs in about a second.
- **`npm run test:integration`** (`vitest.integration.config.ts`, `tests/integration/**`)
  — the emulator-facing services (`adminService`, `messagingService`, `purgeService`,
  `replayService`, `connectionManager`) run their real operations against a real emulator
  container and assert on real results, never mocks. (Pure-infrastructure modules —
  `windowState`, `pollPreference`, the db layer — are covered at the unit tier instead.)
  A Vitest `globalSetup` (`tests/integration/globalSetup.ts` + `harness.ts`) starts a
  two-container compose stack (`docker/servicebus-emulator/docker-compose.test.yml` — the
  emulator needs a SQL Server metadata store, `sqledge`, alongside it) before the suite
  and tears it down unconditionally afterward, including on failure. Files run serially
  (`fileParallelism: false`) because they share that one emulator and its global
  per-entity peek cursors; per-suite client wiring is shared via
  `tests/integration/testClient.ts`.

This is the primary way correctness gets verified in this project — several real
emulator bugs (see [Emulator quirks](#emulator-quirks-and-workarounds) above) were found
*because* tests ran against the real thing instead of a mock that would have quietly
encoded the wrong assumptions.

For anything UI-facing, tests alone haven't been sufficient — several real bugs (a React
state-batching issue that silently hid a completed-purge message, a peek-cursor
interaction that undercounted messages, ambiguous test-locator text matches that deleted
the wrong sidebar item) only showed up when the actual built app was driven end-to-end
with Playwright's `_electron` launcher and the screen was actually looked at. There's no
formal UI test suite for this; it's been done ad hoc per change using a throwaway driver
script, cleaned up afterward.

## Key dependencies

Beyond the Electron/Vite/React/TypeScript baseline, worth knowing *why* these are here:

- **`@azure/service-bus`** — the official JS SDK; see [Admin API vs. messaging
  API](#admin-api-vs-messaging-api-and-the-https-proxy-workaround) above for the one
  thing about it that doesn't work out of the box against the emulator.
- **`@reduxjs/toolkit` + `react-redux`** — the two small cross-cutting state slices
  described [above](#process-model). Chosen over hand-rolled context/prop-drilling once
  the same selection state needed to be read and mutated from multiple, otherwise
  unrelated components (the sidebar tree, detail panels, settings dialog); deliberately
  *not* used for entity data-fetching (no RTK Query) — that stays local `useState` per
  component, since nothing outside a single component needs it.
- **shadcn/ui + Radix UI primitives + Tailwind CSS v4** — the component library. shadcn
  isn't a runtime dependency (its CLI copies component source into the repo, which is
  then hand-owned like any other code); Radix supplies the actual unstyled, accessible
  primitives (dialog, dropdown, select, etc.) underneath.
- **`class-variance-authority` + `clsx` + `tailwind-merge`** — the small utility trio
  every shadcn component leans on for composing/overriding Tailwind class lists safely.
- **`monaco-editor` + `@monaco-editor/react`** — the message body editor
  (`MessageComposer`), for syntax highlighting across text/JSON/XML bodies.
- **`better-sqlite3`** — synchronous, embedded SQLite for `connection_profiles` and
  `preferences`. Its Electron-ABI concern turned out to be a non-issue: it's N-API-based,
  which is ABI-stable across Node/Electron versions, so no `electron-rebuild` step is
  needed (the `npm run rebuild` script exists only in case a future native dependency
  isn't N-API-based).
- **`zod`** — runtime validation for every IPC request payload at the main-process
  boundary; see [The IPC contract](#the-ipc-contract) above. Requests only, by design:
  responses are produced by our own main process, so re-validating them would add cost
  without a trust boundary to defend. Revisit if a contract-drift bug ever appears.
- **`selfsigned`** — pure-JS self-signed certificate generation for
  `adminHttpsProxy.ts`'s local TLS termination; avoids shelling out to `openssl`.
- **`electron-log`** — main-process-only file logging; see [Logging](#logging) above.
- **Biome** — linting, formatting, and import ordering (`npm run lint` runs
  `biome check`; `npm run format` writes fixes). Chosen over ESLint because this project
  runs TypeScript 7, which `typescript-eslint` doesn't yet support; Biome's parser is
  independent of the installed TypeScript version. The a11y preset is `recommended`;
  the one deliberate relaxation is `noNonNullAssertion: off`.
- **Vitest** — both test tiers (see [Testing strategy](#testing-strategy) above).
- **`playwright-core`** — not a test runner here; used for the throwaway
  `_electron.launch()` driver scripts that actually click through the built app during
  manual verification (see [Testing strategy](#testing-strategy) above). Not wired into
  any `npm test` script — there's no formal UI test suite, by design.
