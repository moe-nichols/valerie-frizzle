# SB Emulator Manager

A personal desktop GUI for managing a locally-running **Azure Service Bus emulator**
(Microsoft's official Docker-based emulator). This targets the emulator only — not real
Azure, and not other brokers (Kafka, RabbitMQ, etc).

Features: CRUD for queues/topics/subscriptions, SQL/correlation filter rule management,
sending messages (text/JSON/XML bodies with custom broker properties), peeking/receiving
active messages, purging queues, and inspecting/purging/replaying dead-lettered messages
back to their originating queue or topic.

This is a personal tool: no installer, code signing, or auto-update by design.

## Prerequisites

- [Node.js](https://nodejs.org) 24+ and npm (ships with Node)
- A container runtime with Docker Compose support (Docker Desktop, OrbStack, or Colima +
  the `docker-compose` package)

## Setup

```sh
npm install
```

(`npm run rebuild` also exists, wrapping `electron-rebuild` — it's not needed for anything
currently in the dependency tree, since `better-sqlite3` is N-API-based and already works
under both plain Node and Electron's bundled Node without a rebuild. Keep it in mind only
if a future native dependency isn't N-API-based.)

## Running the emulator for actual app use

```sh
docker compose -f docker/servicebus-emulator/docker-compose.yml up -d
```

This starts the emulator plus its required SQL Server metadata store (`sqledge`). Once
up, use this connection string in the app's connection profile screen:

```
Endpoint=sb://localhost;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;
```

The emulator's management/admin API listens on port `5300` by default (the
`docker-compose.yml` here maps it as such) — enter that as the profile's "management
port." This is intentionally a separate, user-editable field rather than something
derived from the connection string; see [Admin API vs. messaging API](#admin-api-vs-messaging-api-and-the-https-proxy-workaround)
below for why the two are independent.

## Development

```sh
npm run dev
npm run typecheck  # tsc against the node + web tsconfigs
npm run lint       # Biome (linter only; formatting is left as-is)
```

Linting is Biome rather than ESLint: the project runs TypeScript 7, which
`typescript-eslint` does not yet support, whereas Biome's parser is independent of the
installed TypeScript version. The formatter is intentionally left off so it doesn't churn
the existing hand-formatting; see `biome.json` for the (lightly tuned) rule set.

## Testing

```sh
npm run test:unit         # pure-logic tests, no Docker needed
npm run test:integration  # spins up the emulator via Docker Compose, runs against it,
                           # tears it down afterward — requires a running container runtime
```

## Building a local unpacked build

```sh
npm run build:unpacked
```

Produces an unsigned, double-clickable `.app` (macOS) under `dist/`. There's no code
signing, installer, or auto-update — this is a personal tool, not something distributed
to other users, so none of that machinery exists.

---

## Architecture

### Process model

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
  all times — the renderer has zero direct access to Node or Electron APIs.
- **Renderer** (`src/renderer/src/`) — React 19 + TypeScript, Vite-bundled. Plain
  `useState`/`useEffect` throughout; no Redux/Zustand/TanStack Query. The UI is built
  from small, mostly self-contained feature components (see
  [Renderer structure](#renderer-structure) below) rather than a shared global store,
  since the amount of genuinely cross-cutting state (which profile is active, which
  queue is selected) is small enough that prop-drilling two IDs down from `App.tsx` has
  stayed simpler than introducing a state library.
- **Shared** (`src/shared/`) — pure TypeScript types only: DTOs (`domain.ts`), the typed
  IPC channel map (`ipc-contract.ts`), and the `Result<T>` error-handling convention
  (`errors.ts`). Deliberately has **zero** imports of `electron`, `better-sqlite3`, or
  the Azure SDK, which is what lets it be imported by all three processes *and* by plain
  Vitest unit tests with no Electron runtime involved.

### The IPC contract

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

- **Main-process handlers** live in `src/main/ipc/<domain>.ipc.ts` (`app`, `connections`,
  `entities`, `messages`), one `registerXIpcHandlers()` function per file, all wired up
  from `src/main/ipc/register.ts`.
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
  message). Third, because this is the one place *every* real failure passes through, it's
  where every error gets logged (`log.error()` via `electron-log`).
- **Long-running operations use a start/subscribe pattern instead of blocking a single
  `invoke`.** Purging a large queue can take a while, so `messages:purge:start` returns
  immediately with a `jobId`; the main process pushes progress via
  `webContents.send(PURGE_PROGRESS_CHANNEL, { jobId, deletedCount, done })` as the drain
  loop runs, and preload exposes it as `window.sbAdmin.messages.onPurgeProgress(jobId,
  callback)`, returning an unsubscribe function. This is the only push-event channel in
  the app; if a second one is ever needed, it's worth generalizing the pattern rather
  than adding another one-off channel constant.

### Main-process services

Everything under `src/main/services/` is a thin, single-purpose wrapper — none of them
know about IPC or Electron's `ipcMain`, so they're testable (and were tested, in
integration tests) as plain TypeScript classes/functions against a real running emulator.

| File                                 | Responsibility                                                                                                                                                                                                                                                                                                                                  |
|--------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `adminHttpsProxy.ts`                 | Local `node:https` reverse proxy that makes the JS SDK's admin client work against the emulator at all. See [below](#admin-api-vs-messaging-api-and-the-https-proxy-workaround).                                                                                                                                                                |
| `connectionManager.ts`               | `Map<profileId, ActiveConnection>` — the lifecycle hub. `connect()` starts a proxy, constructs `ServiceBusAdministrationClient` + `ServiceBusClient` + a `MessagingService`, and does a cheap liveness check before returning success. `disconnect()`/`disconnectAll()` tear everything back down, including any still-open PeekLock receivers. |
| `adminService.ts`                    | Stateless CRUD for queues/topics/subscriptions/rules. Constructed fresh per IPC request (safe, since it holds no state) — see [Emulator quirks](#emulator-quirks-and-workarounds) for the update-response and message-count issues it works around.                                                                                             |
| `messagingService.ts`                | Send/peek/receive + PeekLock settlement (complete/abandon/dead-letter). **Stateful**, unlike `adminService.ts` — see [below](#why-messagingservice-is-stateful).                                                                                                                                                                                |
| `purgeService.ts`                    | `purgeEntity()` — a receive-and-delete drain loop, plus the pure `isPurgeComplete()` helper that decides when to stop. Works identically against a regular queue or a DLQ; see [DLQ handling](#dlq-handling-is-just-a-different-entity-path).                                                                                                   |
| `replayService.ts`                   | `resubmitMessage()` — moves a dead-lettered message back to its origin. Builds the resend envelope from the DTO the renderer already has (`buildResubmitEnvelope()`, pure), sends it, and only completes the DLQ original *after* the send succeeds.                                                                                            |
| `windowState.ts`                     | Persists/restores the main window's size and position across launches. `parseWindowState()`/`clampToVisibleDisplay()` are pure (defensive against corrupted preference data and monitors that are no longer connected); load/save go through `PreferencesRepo`.                                                                                 |
| `db/database.ts`, `db/migrations.ts` | `better-sqlite3` connection + a small numbered-migration runner.                                                                                                                                                                                                                                                                                |
| `db/profilesRepo.ts`                 | CRUD for saved connection profiles.                                                                                                                                                                                                                                                                                                             |
| `db/preferencesRepo.ts`              | Generic key-value store (used today for `windowState`; a natural home for any future small piece of persisted app state).                                                                                                                                                                                                                       |

#### Admin API vs. messaging API, and the HTTPS proxy workaround

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

#### Why `MessagingService` is stateful

`AdminService` is constructed fresh per IPC request because it's genuinely stateless.
`MessagingService` can't be: PeekLock's settlement methods (`completeMessage`/
`abandonMessage`/`deadLetterMessage`) need the *same* SDK message object and the *same*
receiver that the original receive call produced, and neither can cross the IPC
boundary. A generated `handleId` stands in for that pair across IPC, held in a `Map`
inside `MessagingService` — which means one `MessagingService` instance has to live for
a connected profile's *entire* lifetime, not be recreated per request.
`connectionManager.ts` owns this instance per connection and closes it (releasing any
still-open receivers) on disconnect.

#### DLQ handling is just a different entity path

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

### Renderer structure

```
src/renderer/src/
  App.tsx                        # owns activeProfileId + activeQueueName; everything else is a prop
  lib/monaco.ts                  # Monaco worker setup, local-bundle loader config
  features/
    connections/
      ConnectionManagerPanel.tsx # list/create/connect/disconnect/delete profiles
    entities/
      EntityExplorer.tsx         # queues (flat) + topics (expandable → subscriptions)
      SubscriptionRules.tsx      # per-subscription SQL/correlation rule CRUD
      QueuePurgeControl.tsx      # purge confirm → progress → dismiss; works for a queue or a DLQ
    messages/
      MessageComposer.tsx        # Monaco body editor (text/JSON/XML) + broker properties + app properties
      MessageBrowser.tsx         # peek/receive table; optionally shows DLQ reason + Resubmit (see below)
```

Two components are deliberately generalized rather than duplicated for DLQ use:

- `MessageBrowser` takes an optional `resubmitDestination` prop. When set, it shows a
  dead-letter-reason column, a "regenerate MessageId" checkbox (defaulted on — reusing
  the original id would look like a duplicate if duplicate detection is enabled on the
  destination), and a per-row Resubmit button.
- `QueuePurgeControl` takes `entityPath` + an optional `displayName`, so the exact same
  component purges either a regular queue or its DLQ.

`App.tsx` wires the DLQ UI in by simply rendering a second `MessageBrowser` +
`QueuePurgeControl` pair pointed at `buildDeadLetterQueuePath(activeQueueName)` — no
DLQ-specific component exists anywhere in the renderer.

### Emulator quirks and workarounds

These were all found empirically, against the real running emulator — not assumed —
and each one is the reason for a specific, narrowly-scoped piece of code. If you're
touching related code, read the relevant one first.

| Quirk                                                                                                                                                                                                                                                                  | Where it's handled                                                                                                                                                                                                                                   |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Admin client hardcodes HTTPS; emulator's management API is plain HTTP only                                                                                                                                                                                             | `adminHttpsProxy.ts` — see [above](#admin-api-vs-messaging-api-and-the-https-proxy-workaround)                                                                                                                                                       |
| `updateQueue`/`updateTopic`/`updateSubscription` throw a client-side `PARSE_ERROR` even when the update **succeeds server-side** — the PUT response is missing several fields (`SizeInBytes`, `CreatedAt`, `AuthorizationRules`, etc.) the SDK's deserializer requires | `adminService.ts`'s `runUpdateWithEmulatorParseWorkaround()` — catches specifically `err.code === 'PARSE_ERROR'`, treats it as success, and re-fetches. Any other error still propagates normally.                                                   |
| `maxSizeInMegabytes` is silently ignored by the emulator at both create and update time (always comes back as the default 100)                                                                                                                                         | Not worked around — just don't rely on it. `maxDeliveryCount`/`defaultMessageTimeToLive` both apply correctly and are used instead where a "does this actually change" test is needed.                                                               |
| The emulator's GET-queue response has **no** `CountDetails`/`SizeInBytes`/`AccessedAt` at all (confirmed even with real messages present) — there is no working queue-stats API                                                                                        | `adminService.ts` has no `getActiveMessageCount` method at all (removed after confirming this — see the comment at the top of the class). The purge confirmation dialog instead gets its count from a capped `MessagingService.peekMessages()` call. |
| `peekMessages()` without an explicit `fromSequenceNumber` continues from wherever the entity's peek cursor **last was** — a cursor shared across every caller of that entity, not scoped to the current component or connection                                        | Anywhere peek is used to get a fresh count (not just to browse), pass `fromSequenceNumber: 0` explicitly. `QueuePurgeControl` does this; anything new that peeks for a count needs to as well.                                                       |
| Every new subscription gets an auto-created `$Default` rule (`SqlRuleFilter`, `sqlExpression: "1=1"`)                                                                                                                                                                  | Not a bug — just don't write code or tests that assume a fresh subscription has zero rules.                                                                                                                                                          |
| A dead-letter sub-queue has no dedicated SDK surface, but its entity path is just `"<name>/$DeadLetterQueue"`                                                                                                                                                          | `buildDeadLetterQueuePath()` in `shared/domain.ts` — see [above](#dlq-handling-is-just-a-different-entity-path).                                                                                                                                     |

### Persistence

`better-sqlite3` at `app.getPath('userData')/app.db`, with a small hand-rolled
numbered-migration runner (`db/migrations.ts`) rather than a full migration framework —
there are two tables (`connection_profiles`, `preferences`), so a heavier tool wasn't
justified. Connection strings are stored in plaintext; the emulator's SAS key is a fixed,
documented dev-only value, not a real secret, so this is fine for what this app talks to
(never point a saved profile at a real Azure namespace).

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

### Logging

`electron-log` is initialized in `src/main/index.ts` with `{ preload: false }` —
deliberately main-process-only. Every real failure in the app already flows through
`toResult()` (see [The IPC contract](#the-ipc-contract) above), so that's the one place
`log.error()` is called; there's no logging scattered through individual services.
Renderer-side logging was left out of scope on purpose — wiring electron-log's renderer
transport means an *additional* preload script gets injected into every session
alongside this app's own explicit `contextBridge` preload, which wasn't judged worth the
added surface for a personal tool where renderer errors already show up in devtools.
Log file location is the OS default (`~/Library/Logs/<app>/main.log` on macOS) — the one
place that matters for a packaged build run with no attached terminal.

### Testing strategy

Two tiers, deliberately kept separate:

- **`npm run test:unit`** (`vitest.config.ts`, `tests/unit/**`) — pure-logic modules
  only: filter/envelope/path-building helpers, `isPurgeComplete()`,
  `buildResubmitEnvelope()`, `windowState.ts`'s parse/clamp functions,
  `ProfilesRepo` against a real temp SQLite file. No Docker, no live emulator, runs in
  well under a second.
- **`npm run test:integration`** (`vitest.integration.config.ts`, `tests/integration/**`)
  — every service gets a companion `*.integration.test.ts` that runs its real operations
  against a real emulator container and asserts on real results, never mocks. A Vitest
  `globalSetup` (`tests/integration/globalSetup.ts` + `harness.ts`) starts a two-container
  compose stack (`docker/servicebus-emulator/docker-compose.test.yml` — the emulator
  needs a SQL Server metadata store, `sqledge`, alongside it) before the suite and tears
  it down unconditionally afterward, including on failure.

This is the primary way correctness gets verified in this project — several real
emulator bugs (see [Emulator quirks](#emulator-quirks-and-workarounds) above) were found
*because* tests ran against the real thing instead of a mock that would have quietly
encoded the wrong assumptions.

For anything UI-facing, tests alone haven't been sufficient — a couple of real bugs
(a React state-batching issue that silently hid a completed-purge message, a peek-cursor
interaction that undercounted messages) only showed up when the actual built app was
driven end-to-end with Playwright's `_electron` launcher and the screen was actually
looked at. There's no formal UI test suite for this; it's been done ad hoc per change
using a throwaway driver script, cleaned up afterward.
