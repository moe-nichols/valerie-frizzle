# SB Emulator Manager — Progress

Last updated: 2026-08-02 (end of Milestone 10 — shadcn/ui restyle)

This file is the persistent, repo-local source of truth for project status between
sessions. If you're picking this up cold, read this whole file before touching code —
it captures not just *what's* done but *why*, including several conflicts that were
found and resolved deliberately (don't undo them without re-reading the rationale).

## What this project is

A personal Electron + React + TypeScript desktop GUI for managing a locally-running
**Azure Service Bus emulator** (Microsoft's official Docker-based emulator — not real
Azure, not other brokers). Full feature scope: CRUD for queues/topics/subscriptions,
SQL/correlation filter rule management, sending messages (text/JSON/XML, custom broker
properties), peek/receive active messages, purge queues, inspect/purge/replay DLQ
messages back to their origin. Personal tool — no installer, code signing, or
auto-update by design.

## Milestone status

| # | Milestone | Status |
|---|---|---|
| 0 | Spike: emulator connectivity | **DONE** |
| 1 | Integration test harness | **DONE** |
| 2 | Electron app shell | **DONE** |
| 3 | Persistence + connections | **DONE** |
| 4 | Entity CRUD (queues/topics/subscriptions) | **DONE** |
| 5 | Rules/filters (SQL + correlation) | **DONE** |
| 6 | Messaging (send/peek/receive) | **DONE** |
| 7 | Purge | **DONE** |
| 8 | DLQ inspect + replay | **DONE** |
| 9 | Polish (optional) | **DONE** |
| 10 | shadcn/ui restyle (optional) | **DONE** |

**All originally planned milestones (0-9) are complete**, plus an optional Milestone 10
that restyled the entire renderer with shadcn/ui (Radix primitives + Tailwind CSS v4),
closing out the "reconsider Tailwind/Radix" follow-up noted since Milestone 6. **There is
no mandated next milestone** — any further work is genuinely optional and should be
driven by what the user actually wants next, not by an unfinished plan item. One
long-standing, non-blocking follow-up remains open if ever worth revisiting: trimming
Monaco's bundle to only the languages actually used (~7.7MB currently, noted since
Milestone 6).

## Architecture at a glance

- **Electron main process** (`src/main/`) — Node runtime (Electron's bundled Node, not
  Bun). Owns all Azure SDK calls, SQLite persistence, and the local TLS proxy.
- **Preload** (`src/preload/`) — `contextBridge.exposeInMainWorld('sbAdmin', api)`.
  `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` — all three
  preserved throughout (see "ESM vs CJS" finding below for why this took care).
- **Renderer** (`src/renderer/`) — React + TypeScript, Vite-bundled via `electron-vite`.
- **Shared** (`src/shared/`) — pure types only (`domain.ts` DTOs, `ipc-contract.ts`
  typed channel map, `errors.ts` `Result<T>` union). No `electron`/`better-sqlite3`
  imports — this is what lets it be imported by Node-executed scripts/tests too.
- **Build tooling**: `electron-vite` (Vite-based), npm (not Bun — see below), Vitest for
  both unit and integration tests.

### IPC pattern (established, reuse for every new feature)

`shared/ipc-contract.ts` defines `'domain:action'` channel names with typed
`{ request, response }` shapes, where `response` is always `Result<T>` (`{ ok: true,
data } | { ok: false, error }` — never a thrown Error crossing the IPC boundary, since
Electron serializes those lossily). Main-process handlers live in
`src/main/ipc/<domain>.ipc.ts`, wrapped with `toResult()` from
`src/main/ipc/wrapHandler.ts`. Preload exposes a matching namespaced method under
`window.sbAdmin.<domain>.<action>`. All registration funnels through
`src/main/ipc/register.ts`, called once from `src/main/index.ts`.

## Key decisions and findings (read before changing related code)

### 1. Runtime: Node + npm, not Bun

The user originally asked for Bun, then clarified mid-build they only meant it for
"toolkit stuff" (package manager/launcher). A `/grilling` session walked the actual
boundary and the user chose to drop Bun **entirely** — `npm` for package management,
Vitest for both test tiers (not `node:test`, despite Node 24's native TS support fully
answering the "hand-rolling TS execution" concern — Vitest was chosen for richer DX
since Vite is a required dependency anyway).

This pivot caught two real bugs immediately: Node's ESM resolver requires explicit
`.ts` extensions on relative imports (Bun's didn't) — every relative import needed
fixing — and `tsc --noEmit` caught a genuine mistake in `adminHttpsProxy.ts` (a `days`
option that doesn't exist on `selfsigned`'s type).

**Test orchestration**: `tests/integration/globalSetup.ts` (Vitest's `globalSetup` hook)
replaced a hand-rolled `bun test` subprocess orchestrator — Vitest has first-class
setup/teardown, `bun test` didn't.

### 2. The emulator's admin client doesn't work from JS/TS — only .NET

`ServiceBusAdministrationClient` (the JS SDK) hardcodes `https://` for every management
request (`@azure/service-bus/dist/index.js`, `ServiceBusAdministrationClient`'s
`baseUri` construction), but the emulator's management API (port 5300, separate from
the AMQP port 5672) only ever serves plain HTTP. Confirmed via Microsoft's own blog
("natively supported in .NET") and a still-open GitHub issue
([Azure/azure-service-bus-emulator-installer#17](https://github.com/Azure/azure-service-bus-emulator-installer/issues/17)).

**Fix**: `src/main/services/adminHttpsProxy.ts` — a local `node:https` reverse proxy
(self-signed cert via the pure-JS `selfsigned` package, no `openssl` dependency)
terminating TLS and forwarding to the emulator's plain-HTTP management port. The SDK
trusts the cert via its own supported `tlsOptions.ca` client option — no
`NODE_TLS_REJECT_UNAUTHORIZED` hack, no SDK patching. `connectionManager.ts` starts one
proxy per connected profile and points `ServiceBusAdministrationClient` at it; messaging
(`ServiceBusClient`) talks to the emulator directly since it doesn't need the proxy.

Verified this works under both Bun and (later) plain Node/Electron explicitly, since it
runs inside Electron's main process.

### 3. Module format: root `package.json` has no `"type": "module"`

Root package.json needed `"type": "module"` for Node-executed scripts/tests, but
electron-vite ties main/preload's build output format to that same field — with
`"type": "module"` set, main+preload build as genuine ESM, and Electron's own platform
rules require ESM preload scripts to be **unsandboxed**, conflicting with
`sandbox: true`. (Sandboxing itself is unrelated to CJS/ESM otherwise — electron-vite
fully bundles a sandboxed preload's dependencies.)

**Fix**: root `package.json` has no `"type"` field (defaults to CommonJS, matching
electron-vite's official `react-ts` template — main/preload build as CJS,
`sandbox: true` fully preserved). Scoped `{"type": "module"}` package.json files exist
in `scripts/`, `tests/`, and `src/` instead — each subtree picks its own module format
independently. **Don't add `"type": "module"` back to the root** without re-reading this.

### 4. `better-sqlite3`'s Electron ABI: turned out to be a non-issue

Electron 43.2.0 bundles Node 24.18.0 (`NODE_MODULE_VERSION` 148); this machine's system
Node is 24.11.0 (ABI 137) — genuinely different, normally a real native-module problem.
Built a full `predev`/`prebuild`/`test:unit`-scoped rebuild-guard for it, then verified
empirically that it doesn't apply: `better-sqlite3` v13 is N-API-based
(`NAPI_VERSION=10` in its `binding.gyp`), and N-API is ABI-stable by design. Confirmed
directly — the same compiled binary loads under both plain Node and Electron either way.
**Removed the rebuild-guard machinery** as unneeded. `npm run rebuild`
(`electron-rebuild -f -w better-sqlite3`) still exists as a plain manual script, not
wired into any lifecycle hook — keep as an escape hatch only if a *future* native
dependency isn't N-API-based.

### 5. Scaffolded from the real official electron-vite template, not from memory

`npm create @quick-start/electron` wouldn't complete non-interactively in this
environment, so the actual `react-ts` template source was pulled directly from
`github.com/alex8088/quick-start` (`packages/create-electron/template/{base,react-ts}`)
and adapted, rather than hand-writing Electron main-process boilerplate from
recollection. Decorative bits (example assets, `Versions.tsx` demo, cross-platform
installer config) were deliberately dropped. TypeScript 7 (installed here) removed
`tsconfig`'s `baseUrl` option, breaking the reference template's pattern — fixed by
using a relative `paths` entry instead, per TS's own error guidance.

### 6. `@shared` path alias

`src/shared/*` imports were getting unwieldy (`../../../../shared/domain` from a nested
renderer feature). Added a `@shared` alias in **four** places that all need to agree:
`electron.vite.config.ts` (all three targets), `tsconfig.node.json`/`tsconfig.web.json`,
and `vitest.config.ts`/`vitest.integration.config.ts` (Vitest has its own config,
independent of `electron.vite.config.ts`). Use `@shared/...` for all shared imports.

### 7. `ConnectionProfile.managementPort`

The emulator's admin/management port isn't derivable from the AMQP connection string —
they're independent, and the project's own dev vs. test compose files already use
different ones (5300 vs. 5301). `ConnectionProfile` has an explicit, user-editable
`managementPort` field for this.

### 8. Two genuine emulator bugs in update responses — found only by testing against the real emulator

`adminService.ts`'s first integration test run against the real emulator failed for real
reasons (not flakiness). Investigated with a direct repro script + a logging
man-in-the-middle proxy layered in front of `adminHttpsProxy` to capture raw
request/response XML:

- **`maxSizeInMegabytes` is silently ignored** by the emulator at both create and update
  time, for any value tried (16, 32, 1024, 2048 — always comes back as the default 100).
  Not a code bug — the emulator just doesn't implement it yet. `maxDeliveryCount` and
  `defaultMessageTimeToLive` were both confirmed to apply correctly; tests use those
  instead. **Don't write tests asserting `maxSizeInMegabytes` actually changes.**
- **Every successful `updateQueue`/`updateTopic` call throws a client-side `PARSE_ERROR`.**
  Diffing a GET response against a PUT response for the same queue showed the PUT
  response is missing several fields the SDK's Atom/XML deserializer requires
  (`SizeInBytes`, `MessageCount`, `AuthorizationRules`, `CreatedAt`, `SupportOrdering`,
  `EnablePartitioning`, `IsAnonymousAccessible` — present on GET, absent on PUT).
  Confirmed via re-fetching afterward that **the mutation itself succeeds server-side**
  despite the parse failure — purely a malformed-response bug. Real validation failures
  (e.g. a TTL outside the emulator's ~1-hour max) come back as a distinct, correctly-
  parsed `RestError` — so the two cases are reliably distinguishable by `err.code ===
  'PARSE_ERROR'`.
- **Fix**: `runUpdateWithEmulatorParseWorkaround()` in `adminService.ts` — attempts the
  real update call; if it throws specifically `PARSE_ERROR`, treats the mutation as
  successful and re-fetches instead of surfacing the error. Any other error still
  propagates. Applied to all three `updateQueue`/`updateTopic`/`updateSubscription`
  methods. **If any future admin-client mutation hits a similar "succeeds server-side but
  throws PARSE_ERROR client-side" pattern, reuse this same helper rather than
  re-diagnosing from scratch.**

### 9. Rules (Milestone 5) turned out clean — and every new subscription auto-creates a `$Default` rule

Before trusting it, checked whether rule create/update hits the same
`runUpdateWithEmulatorParseWorkaround`-requiring bug as queues/topics (finding #8) via
the same direct-repro-script approach. It doesn't — `createRule`/`deleteRule` for both
`SqlRuleFilter` and `CorrelationRuleFilter` work cleanly against the emulator, no parse
errors, no silently-ignored fields. No `updateRule` was implemented — deliberately, the
plan's Milestone 5 scope never asked for it ("creating both rule types and asserting
`listRules` reflects them and delete works").

**Every new subscription gets an auto-created `$Default` rule** (`SqlRuleFilter` with
`sqlExpression: "1=1"`, matches all messages) — confirmed via direct repro before writing
tests. `listRules` assertions use `.toContain`, never an exact-length/exact-list check
(except where the full accounting deliberately includes `$Default` alongside custom
rules).

`SqlRuleFilter` vs `CorrelationRuleFilter` have no explicit discriminant field in the
SDK's type union — `adminService.ts` distinguishes them structurally by checking for
`sqlExpression` (only `SqlRuleFilter` has it).

**Driver-script locator scoping matters more with every level of tree nesting.** The
entity tree is now 3 levels deep (topics → subscriptions → rules). A Milestone 5 driver
script using the same flat `getByRole('listitem').filter({ hasText })` pattern that
worked in Milestone 4 broke immediately — ancestor `<li>`s match on descendant text too,
so with 3 nesting levels a naive selector can match 3+ elements at once. Fixed by scoping
locators down through each level explicitly: find `topicRow` first, derive `subRow` via
`topicRow.locator('ul li').filter({ hasText: subName })`, then scope rule-level lookups
to `subRow`. For the topic's own Delete button specifically (ambiguous against nested
subscription/rule Delete buttons even after scoping to `topicRow`), used a direct-child
selector: `topicRow.locator(':scope > button:has-text("Delete")')`. **Reuse this
scope-down pattern verbatim for any future driver script touching this tree — don't
restart from flat matching.**

### 10. Messaging (Milestone 6): the first stateful service, a Node/TS gotcha, and a false alarm

**`messagingService.ts` cannot be constructed fresh per IPC request, unlike every prior
service.** PeekLock's `completeMessage`/`abandonMessage`/`deadLetterMessage` need the
*same* SDK message + receiver object the receive call produced — lock tokens and
receivers can't cross IPC. A generated `handleId` stands in for that pair, held in a
`Map` inside `MessagingService`, which means one instance must live for a connected
profile's whole lifetime. `connectionManager.ts` now constructs and owns a
`MessagingService` per active connection and closes it (releasing any still-open
PeekLock receivers) on disconnect. If you add another stateful service later, follow
this same pattern — don't default to the stateless-per-request shape `AdminService` uses.

**`sequenceNumber` is a `Long` (from the `long` package), not a plain JS number.**
Added `long` as an explicit dependency (was already resolved transitively via
`@azure/service-bus`, pinned to the same version) since we import it directly for
`Long.fromNumber()`/`.toNumber()`. DTOs expose `sequenceNumber: number` — fine for a
personal tool's realistic volumes, avoids leaking a non-JSON-safe type across IPC.

**Monaco + Vite/Electron was verified with a throwaway smoke test before building the
real composer** — good thing, since it immediately surfaced a moderate `dompurify`
XSS-adjacent advisory in `monaco-editor`'s tree (fixed via `npm audit fix --force`,
downgrading to `monaco-editor@0.53.0`, before writing any Monaco-dependent code — zero
rework). Worker setup uses Vite's native `?worker` import suffix (no extra plugin) for
`editor.worker` + `json.worker` only; XML uses the base editor worker (tokenizer-only
"basic language", no dedicated worker exists). `@monaco-editor/react`'s
`loader.config({ monaco })` points it at the locally bundled package instead of its CDN
default — required for this to work fully offline in Electron. **Known follow-up, not
blocking**: `import * as monaco from 'monaco-editor'` bundles every language Monaco
ships (~7.7MB main bundle, dozens of chunks) since only text/JSON/XML are used — worth
trimming to targeted imports later.

**Hit the same Node/TS parameter-property limitation noted back in the Bun→Node pivot,
for the first time in practice.** An ad hoc debug script run via plain `node script.mjs`
failed to import `AdminService` at all — Node's native type-stripping only erases type
annotations, it can't transform `constructor(private client: X) {}` into an actual field
assignment, which real code transformation (not just erasure) requires. This does **not**
affect the real app (Electron/electron-vite and Vitest both use esbuild-based transforms,
which handle it fine) — it only affects throwaway `node` scripts that import our classes
directly. **For future debugging**: call the raw SDK directly in repro scripts instead of
importing our classes (what was done here), or run the repro through `vitest run` instead
of plain `node`.

**A false alarm during driven-UI verification, worth remembering the shape of.** The
first full run appeared to show `receive` finding nothing right after a successful
`peek`. Investigated via a raw-SDK repro (worked fine) before suspecting the UI, then
added a screenshot *between* the receive and complete steps — which proved receive had
in fact worked (`Complete`/`Abandon`/`Dead-letter` buttons were present); the "empty"
state in the original run was simply the correct result *after* completing the message,
misread because the only capture point was at the very end of the sequence. **Capture
state at the specific point being asserted, not just at the end of a sequence** — general
lesson for every future driver script.

**A real bug the investigation surfaced along the way** (not the false alarm above):
deleting a queue that's currently selected for messaging left the "Messages — X"
composer/browser panel pointing at a now-nonexistent queue, since `activeQueueName` was
never cleared. Fixed with an `onQueueDeleted` callback threaded from `EntityExplorer` up
to `App.tsx`.

### 11. Purge (Milestone 7): the emulator has no queue-stats API, a peek footgun, and a React batching bug

**`getQueueRuntimeProperties()` isn't a parse-error workaround case like finding #8 — the
emulator simply doesn't send message-count data at all.** Investigated via a direct repro
against the real emulator (reached the SDK's own internal `getResource()` to see the raw
parsed response, bypassing the builder that throws): the GET-queue response has no
`CountDetails`/`SizeInBytes`/`AccessedAt`, confirmed even with real messages sitting in
the queue. `getQueueRuntimeProperties()` throws `PARSE_ERROR` because its builder calls
`getDate()` (throws on missing) on `AccessedAt`, which the emulator never sends — but even
a clean parse would report 0 messages, since `CountDetails` isn't there either. **No
retry/refetch fixes this** — unlike finding #8, there's no successful alternate call to
fall back to; the data genuinely isn't obtainable via the admin API against this emulator
version. **`getActiveMessageCount` was removed from `adminService.ts` entirely** —
replaced by a doc comment explaining why, so it doesn't get silently re-added.

**Purge confirmation count comes from `MessagingService.peekMessages()` instead** —
capped at 250 (shows "N+" past the cap). This surfaced a second, unrelated real bug:
**Service Bus peek, without an explicit `fromSequenceNumber`, continues from wherever the
entity's peek cursor last was** — a server-side cursor scoped to the *entity*, not the
caller or connection. A driven-UI run browsing a queue's messages first (via
`MessageBrowser`'s Peek) and then clicking Purge on the same queue showed "0 active
messages" even though 3 were still there, because the browser's earlier peek had already
advanced the cursor past them. **Fix**: `QueuePurgeControl` always passes
`fromSequenceNumber: 0` explicitly. **Any future feature that peeks for a count or
existence-check (not just browsing) needs this same explicit `fromSequenceNumber: 0`** —
this isn't purge-specific.

**A real React state-batching bug, caught only by watching the actual UI — no test could
have caught it.** The first version of `QueuePurgeControl` cleared a separate `purging`
boolean in the same event-handler tick as the final progress update carrying
`done: true`. React batches both into one render, where `purging && progress` was already
false — so the "(done)" message was computed correctly internally but never actually
rendered; the UI just silently reverted straight to the idle "Purge" button. A driven
Playwright run watching for the literal "(done)" text (it never appeared, even though
`deletedCount` reached the right value) is what caught it — unit tests don't exercise
React's render/commit timing, and the integration tests only assert on
`purgeService.ts`'s callback arguments, never on what the renderer does with them.
**Fix**: dropped the separate `purging` boolean — the UI now derives everything from
`progress` alone (non-null = show status, `progress.done` = show the done message), and
`progress` is cleared only by an explicit "Dismiss" button, not automatically. **Lesson:
when a UI's final state depends on two state updates landing in the same batch, don't
gate visibility on a boolean that gets cleared in that same batch — derive visibility from
the data itself.**

### 12. DLQ + replay (Milestone 8): DLQ paths are just entity paths, resubmit uses the DTO not the raw SDK message, and a Playwright userData surprise

**Read the SDK source before building on the plan's "DLQ is just an entity path" premise
— confirmed, not assumed.** `createReceiver()`'s `{ subQueueType: 'deadLetter' }` option
does nothing but string-concatenate `"/$DeadLetterQueue"` onto the entity path before
handing it to the AMQP link; `validateEntityPath()` only checks an irrelevant
connection-string restriction. So a raw `"queueName/$DeadLetterQueue"` path string works
identically through every existing entityPath-taking method. **Zero changes needed** to
`MessagingService` or `purgeService.ts` — DLQ browsing/purge just point existing methods
at a different path, built via one new pure helper, `buildDeadLetterQueuePath()` in
`shared/domain.ts`.

**`replayService.ts` builds the resend envelope from the `ReceivedMessageDescription` DTO
already crossing IPC, not the raw SDK message.** Reaching into `MessagingService`'s
private PeekLock handle map for full-fidelity access was considered and rejected — the
DTO already has every resend-worthy field, and using it keeps "SDK types never cross IPC"
intact instead of poking a new hole in `MessagingService` for one feature. DLQ-only
fields are dropped simply by not existing on `MessageEnvelope`'s shape, nothing to
explicitly strip. `resubmitMessage()` sends to the destination **first**, completes the
DLQ original only after that succeeds — reordering this would silently lose a message on
a failed send.

**No new UI components — two existing Milestone 7 components got one generalization
each.** `QueuePurgeControl` went from a `queueName`-only prop to `entityPath` +
optional `displayName` (so the exact same component purges a queue or its DLQ).
`MessageBrowser` gained one optional prop, `resubmitDestination` (dead-letter-reason
column + regenerate-MessageId checkbox, defaulted on + per-row Resubmit, all gated on
that prop being set). `App.tsx` just renders a second `MessageBrowser` +
`QueuePurgeControl` pair pointed at `buildDeadLetterQueuePath(activeQueueName)`.

**A pre-existing gap, unrelated to this milestone's own code, surfaced by its new test
file.** Root `tsconfig.json` never had the `@shared` alias the other three tsconfig files
all define — invisible since `npm run typecheck` doesn't check it, and nobody had run
`npx tsc --noEmit -p tsconfig.json` since Milestone 3, before any test transitively
imported an `@shared`-importing main-process file. **Fixed**: added the same `paths`
entry, matching the other three configs exactly. If a future session's `npm run
typecheck` doesn't cover something you'd expect it to, check whether it's actually being
run rather than assuming it's clean.

**Two driver-script-only issues, not app bugs**, both worth remembering for future
scripts touching messaging: (1) `MessageBrowser.handleReceive()` hardcodes
`maxWaitTimeMs: 5000` — a real server round-trip — so wait for its own "Loading…"
indicator to clear rather than a short fixed delay; 500ms made a working Receive look
broken. (2) After peeking (not settling) a resubmitted message to confirm it reappeared,
a later Receive on the same queue picked up both that still-unclaimed message and a newly
sent one — an unscoped `getByRole('button', {name:'Dead-letter'})` then matched two rows.
Scope to the specific row by body text — the same lesson as Milestone 5's nested-tree
locators, now shown to apply even to a flat table once more than one row is plausible.

**Found and cleared real orphaned state — not cosmetic, investigated rather than
dismissed.** A screenshot showed leftover `m7-verify-profile-*` entries despite Milestone
7's own driver-script cleanup having run without error every time. Cause: Playwright's
`_electron.launch()` launches `out/main/index.js` directly, bypassing normal
packaged-app name resolution, so `app.getPath('userData')` resolves to the generic
`~/Library/Application Support/Electron/` — not
`~/Library/Application Support/sb-emulator-manager/`. Every prior cleanup step actually
worked correctly, every time, just against that generic path. Manually cleared both the
leftover queues on the real dev emulator and the stale SQLite rows (`sqlite3
"~/Library/Application Support/Electron/app.db"`) since they were real un-freed resources
on a shared long-running emulator, not just stale pixels in a screenshot. **This has been
true since Milestone 2's first driven run** — noted here so a future session seeing
unfamiliar profiles doesn't have to re-derive where they came from.

### 13. Polish (Milestone 9): logging at the one choke point, a proactive multi-monitor fix, and a third userData path found by actually driving the packaged build

**`electron-log` was wired at `toResult()` (`src/main/ipc/wrapHandler.ts`), not scattered
across services.** Every IPC call already funnels through this one helper, which already
catches every thrown error — adding `log.error()` there logs every real user-facing
failure with zero new call sites elsewhere. Deliberately **main-process-only**:
`electron-log`'s `{ preload: true }` default injects an extra preload script into every
session, alongside (not replacing) the app's own explicit `contextBridge` preload —
skipped via `{ preload: false }`, not worth the added surface for a personal tool where
renderer errors already show up in devtools. Log file lands at the OS default
(`~/Library/Logs/<app>/main.log` on macOS) — the one place that matters for a packaged
build run with no attached terminal.

**Window-state persistence handles a real multi-monitor footgun proactively, not
reactively.** `clampToVisibleDisplay()` (`src/main/services/windowState.ts`) checks a
saved `x`/`y` against every currently-connected display (`screen.getAllDisplays()`,
only callable after `app.whenReady()`) and drops the position if it lands on none of
them — otherwise a saved position on a now-disconnected external monitor leaves the
window permanently off-screen and unreachable. `parseWindowState()` is similarly
defensive against corrupted/hand-edited preference JSON (range-checks width/height/x/y,
falls back to defaults on any parse failure). Both are pure, unit-tested with fake
display/JSON data — no real Electron or database needed, same pattern as every other
pure helper in this project (`isPurgeComplete`, `buildResubmitEnvelope`,
`buildDeadLetterQueuePath`). Resize/move events are debounced 500ms before the SQLite
write (they fire continuously while dragging); `close` saves immediately and clears any
pending debounce timer so the last resize before quitting isn't lost.

**The unpacked build was actually launched and driven, not just produced — and that
surfaced a third distinct `userData` resolution path.** `npm run build:unpacked`
succeeding only proves electron-builder didn't error. Verified further: launched the
real `.app` binary directly via Playwright's `executablePath` (not `out/main/index.js`,
which every prior milestone's driven verification used), resized and closed it,
relaunched, and confirmed the second launch restored the exact bounds from the first —
a real cross-process round trip through real SQLite. This launch mode resolves
`app.getName()` from `package.json`'s `name` field (`sb-emulator-manager`), landing in
`~/Library/Application Support/sb-emulator-manager/` and
`~/Library/Logs/sb-emulator-manager/` — a **third** path, distinct from both the bare
`out/main/index.js` Playwright launches (`.../Electron/`, see finding #12) and a normal
`npm run dev` launch. Confirmed by directly reading the resulting `app.db`'s
`preferences` table and `main.log` after the run, not just trusting the driver script's
own in-process assertions.

### 14. shadcn/ui restyle (Milestone 10): the CLI can't handle this repo's layout, Tailwind v4 needs a rebuild to pick up new classes, and the entity tree's DOM shape matters to driver scripts

**The `shadcn` CLI (v4.16.1 and v4.15.0 both tried) cannot initialize or add components in
this repo.** Its framework detector wants a root `vite.config.ts` (this project has
`electron.vite.config.ts` via `electron-vite` instead) — worked around by dropping a
throwaway root `vite.config.ts` + `@tailwindcss/vite` just to pass detection — but `init`
then fails with `Could not load the workspace config in .../src`, because it treats the
scoped `{"type":"module"}` `package.json` files under `src/`/`tests/`/`scripts/` (see
finding #3) as a monorepo workspace it can't resolve. **Fix: abandoned the CLI entirely**
and hand-authored `components.json`, `src/renderer/src/lib/utils.ts` (`cn()` helper), and
every `src/renderer/src/components/ui/*.tsx` primitive directly from the standard
shadcn/ui "new-york" source (Radix primitives + `class-variance-authority` +
`tailwind-merge` + `lucide-react`) — these are simple, static, well-known files with no
real need for the CLI once you know the target shape. **If a future session wants to add
another shadcn component, don't retry `shadcn add` here** — it will hit the same
workspace-detection failure; write the component file by hand following the existing
`components/ui/*.tsx` files as the pattern.

**Tailwind v4 only emits CSS for classes it can see in source at build time — a stale
build silently strips a huge chunk of styling with zero errors.** Building once after
wiring up Tailwind, then adding component JSX across 7 files without rebuilding again,
produced an app that *launched fine* but rendered almost entirely unstyled (dark
background only, no card borders, no button chrome) — caught only by actually looking at
driven-UI screenshots, not by typecheck/lint (both stay green regardless, since this is a
CSS-generation-time issue, not a code error). **Any future styling change needs a fresh
`npm run build` (or a running `npm run dev`, which rebuilds Tailwind's output on every
file save) before a driven-UI screenshot pass is trustworthy** — a stale build looks like
a real regression but isn't one.

**Radix's `Collapsible`, not `Accordion`, was used for the topics→subscriptions and
subscriptions→rules expand/collapse in `EntityExplorer.tsx`/`SubscriptionRules.tsx`** —
each expand state is already an independent per-item boolean (`expandedTopics:
Set<string>`, `SubscriptionRules`'s own local `expanded`), which maps directly onto
`Collapsible`'s single-item shape without forcing everything into one shared
`Accordion` root. No logic changed — only the JSX wrapper.

**The topic row's Delete button had to stay a true direct child of its `<li>`, not nested
inside a wrapper `<div>` or inside `CollapsibleContent`** — finding #5's driver-script
locator (`topicRow.locator(':scope > button:has-text("Delete")')`) depends on exactly that
DOM shape to disambiguate a topic's own Delete from its nested subscription/rule Deletes.
This was gotten wrong on the first pass (Delete ended up inside a flex wrapper `<div>`)
and caught by re-reading the plan before it shipped, not by any test — worth remembering
that shadcn/Radix wrapper elements (`Collapsible` root renders a `<div>`) can silently
change direct-child relationships that driver scripts rely on.

**`QueuePurgeControl`'s state-derivation shape (finding #11) was preserved exactly** —
the confirm step moved into an `AlertDialog`, but the progress/done block stays outside
any dialog, rendered from the same unmodified `{progress && (...)} {progress.done ? (...)
: null}` structure, with no new boolean introduced. Verified via a driven run that
explicitly waited for (not just glanced at) the literal `(done)` text after a real purge
— a fixed 2s wait after clicking "Yes, purge" was *not* enough (the purge job hadn't
finished yet, producing a false-negative "regression"); polling with `waitFor` up to 15s
was needed before the text reliably appeared. This is the same "capture state at the
specific point being asserted" lesson from finding #10, now specifically re-confirmed for
this component after a real structural change to it.

**Verified via a fresh one-off driven-UI script** (Playwright's `_electron` launcher,
same pattern as every prior milestone — see "How things were verified" below), not just
`npm run typecheck`/`lint`/`test:unit`/`test:integration` (all green throughout, but none
of them touch the renderer's DOM/CSS). Covered: profile create/connect, 3-level entity
nesting create/expand/delete (including deleting a topic with a still-expanded nested
subscription — finding #5's exact scenario), message send/peek/receive/view-detail-dialog/
complete, and the purge confirm→progress→done flow. Left no lingering state: the launch
via `args: [REPO]` (rather than `out/main/index.js` or a packaged `.app`) resolved
`userData` to `~/Library/Application Support/sb-emulator-manager/` (matching finding #13's
"third path" outcome, i.e. **not** the generic `.../Electron/` path finding #12
documented for direct `out/main/index.js` launches) — verify-run profiles/queues were
cleaned up from both that SQLite file and the shared dev emulator afterward.

## Environment / local setup notes

- **Container runtime**: Colima (installed this session — machine had no Docker daemon
  originally, only the bare `docker` CLI). `docker compose` plugin wired via
  `~/.docker/config.json`'s `cliPluginsExtraDirs`.
- **Long-running dev emulator**: `docker compose -f docker/servicebus-emulator/docker-compose.yml up -d`
  — ports 5672 (AMQP) / 5300 (management). Was left running across most of this session;
  check `docker ps` before assuming it's up in a new session.
- **Test emulator**: separate compose file (`docker-compose.test.yml`), ports 5673/5301,
  fully managed by `npm run test:integration` (starts + tears down automatically via
  Vitest's `globalSetup`).
- **Emulator connection string** (fixed dev value, not a real secret):
  `Endpoint=sb://localhost;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;`

## Commands reference

```sh
npm install              # no rebuild step needed (see finding #4)
npm run dev               # electron-vite dev, HMR
npm run build              # production bundle to out/
npm run build:unpacked      # electron-builder --dir, unsigned local build
npm run typecheck            # tsc --noEmit against tsconfig.node.json + tsconfig.web.json
npm run test:unit             # Vitest, tests/unit/**, no Docker needed
npm run test:integration       # Vitest, tests/integration/**, spins up + tears down the test emulator
```

Root-level `npx tsc --noEmit -p tsconfig.json` separately typechecks `scripts/`,
`tests/`, and `src/shared/` (the plain-Node-executed portion, distinct from the
Vite-bundled `tsconfig.node.json`/`tsconfig.web.json` pair).

## How things were verified (keep doing this for future milestones)

Every milestone so far was verified with real execution, not just green
typecheck/tests: `npm run build` then drive the actual built app with `playwright-core`'s
`_electron` launcher (`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`
on macOS) — real window, real clicks via `page.getByRole`/`getByLabel`, screenshots
inspected visually. No project-specific run-skill exists yet for this — worth running
`/run-skill-generator` at some point since this pattern has repeated across Milestones 2
through 9. **Milestone 7 is a sharp reminder of why this step is non-negotiable even
after tests pass**: 29/29 integration tests and 11/11 unit tests were all green, and the
app still had two real, user-visible bugs (the peek-cursor undercount, the invisible
"(done)" state) that only a driven UI run — watching real render/event timing, not
calling service methods directly — could catch. See finding #11. **Milestone 9 went one
step further and drove the actual packaged `.app` binary** (`executablePath`, not
`out/main/index.js`), the first milestone to do so — worth doing again for any future
change to `electron-builder.yml`, packaging, or anything `userData`-path-sensitive, since
that's exactly the kind of thing a dev-mode-only driven run can't catch.

**Playwright's `_electron.launch()` uses a different userData directory than a normal
launch — check `~/Library/Application Support/Electron/`, not `.../sb-emulator-manager/`,
if you need to inspect or clean up state a driver script left behind.** True since
Milestone 2, only diagnosed in Milestone 8 (finding #12) when leftover profiles looked
like a cleanup bug but weren't one.

**Use unique, timestamp-suffixed names for every entity/profile a driver script
creates** (e.g. `` `m4-verify-queue-${Date.now()}` ``). A Milestone 4 driver script using
fixed names (`m4-verify-queue`) hit `SubCode=40900 Conflict` errors from leftover
entities on the shared long-running dev emulator after an earlier crashed run — the same
lesson the integration tests already followed via `test-queue-${crypto.randomUUID()}`,
just not yet applied to manual verification scripts.

**Scope Playwright locators down through each nesting level once the tree is 2+ levels
deep** — don't rely on flat `getByRole`/`hasText` matching. `:has-text`/`hasText` matches
on an element's full descendant text content, so once there's real nesting (topics >
subscriptions > rules, as of Milestone 5) a naive selector matches every ancestor whose
subtree happens to contain the target text, not just the intended row. The working
pattern (see Milestone 5): find the outer row first (`topicRow = page.getByRole('listitem').filter({ hasText: topicName })`),
derive the next level relative to it (`subRow = topicRow.locator('ul li').filter({ hasText: subName })`),
and so on. For a row's *own* action button when it still has nested action buttons
underneath (e.g. deleting a topic that still has visible subscriptions/rules nested
inside it), use a direct-child selector — `topicRow.locator(':scope > button:has-text("Delete")')`
— rather than a descendant-scoped `getByRole`, which would still match the nested buttons too.

## File map (as of end of Milestone 9)

```
docker/servicebus-emulator/
  Config.json                    # minimal, empty queues/topics — entities created live via admin client
  docker-compose.yml              # long-running dev emulator (ports 5672/5300)
  docker-compose.test.yml          # integration-test emulator (ports 5673/5301)
scripts/
  verify-emulator-connectivity.ts  # Milestone 0 spike, still a good reference example
src/
  main/
    index.ts                      # app lifecycle, window, DB/repo/connectionManager wiring, will-quit cleanup;
                                   # electron-log init + window-state load/save wiring (finding #13)
    ipc/
      register.ts                  # all IPC handler registration funnels through here
      wrapHandler.ts                 # toResult() — shared try/catch -> Result wrapper; also where every
                                      # IPC error gets log.error()'d (finding #13)
      app.ipc.ts                     # app:ping (diagnostic channel from Milestone 2)
      connections.ipc.ts              # connections:list/create/update/delete/connect/disconnect/status
      entities.ipc.ts                  # entities:{queues,topics,subscriptions,rules}:* (rules: list/create/delete only)
      messages.ipc.ts                   # messages:send/peek/receive/complete/abandon/deadLetter/purge:start/resubmit
    services/
      adminHttpsProxy.ts             # local TLS proxy + buildAdminConnectionString() pure helper
      connectionManager.ts            # profileId -> live {adminClient, sbClient, adminProxy, messagingService}
      adminService.ts                  # entity + rule CRUD, runUpdateWithEmulatorParseWorkaround() (finding #8);
                                        # no getActiveMessageCount — see finding #11 for why
      messagingService.ts               # send/peek/receive/settle; stateful PeekLock handle map (finding #10)
      purgeService.ts                   # purgeEntity() drain loop + pure isPurgeComplete() helper (finding #11);
                                         # reused unchanged for DLQ purge (finding #12)
      replayService.ts                  # buildResubmitEnvelope() (pure) + resubmitMessage() (finding #12)
      windowState.ts                    # parseWindowState()/clampToVisibleDisplay() (pure) + load/save (finding #13)
      db/
        database.ts                   # createDatabase(path) — better-sqlite3 + migration runner
        migrations.ts                  # numbered migrations array (version 1: connection_profiles, preferences)
        profilesRepo.ts                 # ConnectionProfile CRUD
        preferencesRepo.ts               # key-value get/set
  preload/
    index.ts                        # contextBridge exposing window.sbAdmin
    index.d.ts                       # global Window.sbAdmin type declaration
  renderer/src/
    App.tsx                         # owns activeProfileId + activeQueueName, renders all feature panels
    index.css                       # Tailwind v4 entry + shadcn CSS-variable theme (finding #14)
    lib/
      monaco.ts                       # Monaco worker setup + local-bundle loader.config (finding #10)
      utils.ts                        # cn() helper (clsx + tailwind-merge), for components/ui (finding #14)
    components/ui/                    # shadcn/ui primitives, hand-authored not CLI-generated (finding #14) —
                                       # button/input/label/card/table/dialog/alert-dialog/collapsible/badge/
                                       # separator/radio-group/checkbox/select/textarea/alert/sonner
    features/
      connections/
        ConnectionManagerPanel.tsx    # list/create/connect/disconnect/delete profiles UI; reports active profile up
      entities/
        EntityExplorer.tsx            # queues list+create (+ "Messages" select button, <QueuePurgeControl>); topics+subscriptions
        SubscriptionRules.tsx           # per-subscription rule list + SQL/Correlation create form + delete
        QueuePurgeControl.tsx           # purge confirm (peek-based count) -> progress -> Dismiss; generalized to
                                         # entityPath/displayName in Milestone 8 so it also purges a DLQ (finding #12)
      messages/
        MessageComposer.tsx             # Monaco body editor (text/JSON/XML) + broker-property form + app-properties
        MessageBrowser.tsx               # peek/receive with PeekLock-vs-ReceiveAndDelete toggle, table, detail view;
                                          # optional resubmitDestination prop adds DLQ reason column + Resubmit (finding #12)
  shared/
    domain.ts                       # ...+ MessageEnvelope, ReceivedMessageDescription, ReceiveMode,
                                     # buildDeadLetterQueuePath() (finding #12)
    ipc-contract.ts                   # typed channel map (app, connections, entities incl. rules, messages incl.
                                       # purge:start, resubmit) + PURGE_PROGRESS_CHANNEL/PurgeProgressEvent (push-event pattern)
    errors.ts                        # Result<T> / IpcError
tests/
  unit/
    profilesRepo.test.ts             # real temp SQLite file
    buildAdminConnectionString.test.ts # pure function
    isPurgeComplete.test.ts            # pure function (finding #11)
    buildResubmitEnvelope.test.ts       # pure function (finding #12)
    buildDeadLetterQueuePath.test.ts     # pure function (finding #12)
    windowState.test.ts                   # parseWindowState + clampToVisibleDisplay (finding #13)
  integration/
    harness.ts                       # startEmulator/stopEmulator via docker compose + node:child_process
    globalSetup.ts                    # Vitest globalSetup wrapping harness.ts
    smoke.integration.test.ts          # connect via proxy, list queues
    connectionManager.integration.test.ts # connect/disconnect + both failure paths
    adminService.integration.test.ts    # create/get/list/update/delete for queues/topics/subscriptions + rules
    messagingService.integration.test.ts  # send/peek round-trip + PeekLock vs ReceiveAndDelete
    purgeService.integration.test.ts       # drains N messages with progress assertions; from-empty no-op case
    replayService.integration.test.ts       # dead-letter -> resubmit (with/without regenerated id); DLQ purge
```

## Not yet built

Nothing from the original plan (Milestones 0-9) remains, and Milestone 10 closed out the
Tailwind/Radix follow-up (see finding #14) — the renderer now uses shadcn/ui throughout,
Tailwind CSS v4, and a fixed dark theme (no light/dark toggle, a deliberate choice for a
single-user tool). State management is still plain `useState`/`useEffect` — TanStack
Query/Table were considered and not adopted; nothing about the restyle needed them. One
long-standing, non-blocking follow-up remains open:

- Monaco's bundle includes every language it ships (~7.7MB), only text/JSON/XML are used
  — worth trimming to targeted imports if bundle size ever actually matters for this
  personal tool (it hasn't yet).
