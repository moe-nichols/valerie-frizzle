# Project Summary — SB Emulator Manager

A personal Electron + React + TypeScript desktop GUI for managing a locally-running
Azure Service Bus emulator. Built end-to-end across eleven milestones (0-10), all now
complete. This document summarizes what was built and how; see `README.md` for the
architecture reference and `plan/PROGRESS.md` for the full session-by-session history
with detailed findings.

## What it does

Full CRUD for queues, topics, and subscriptions; SQL and correlation filter rule
management; sending messages with custom text/JSON/XML bodies and broker properties
(TTL, label, correlation ID, application properties); peeking and receiving active
messages (PeekLock or ReceiveAndDelete); purging queues; and inspecting, purging, and
replaying dead-lettered messages back to their origin. No installer, code signing, or
auto-update — this is a personal tool, not something distributed to other users.

## How it was built

Every milestone followed the same discipline: build against the real emulator (not
mocks), write both unit and integration tests, then actually launch and drive the built
app with Playwright before calling anything done. That last step mattered more than it
might sound — several real bugs only surfaced when the app was watched running, not when
its tests passed:

- A React state-batching bug where a purge's "done" state was computed correctly
  internally but never actually rendered, because two state updates landing in the same
  batch made the condition that gated it false before the browser ever painted.
- A peek-cursor bug where Service Bus's peek API, without an explicit
  `fromSequenceNumber`, continues from a cursor shared across every caller of an entity —
  so browsing a queue and then trying to purge it undercounted, even though the messages
  were still there.
- A window-state persistence check that only proved itself by launching the actual
  packaged `.app` binary twice in separate process launches and confirming the second
  one restored what the first one saved — not just by asserting inside a single running
  process.

Two runtime/tooling decisions were made deliberately early and never revisited: Node +
npm instead of Bun (the user's own call, walked through explicitly rather than assumed),
and a local HTTPS-terminating reverse proxy to work around the JS Azure SDK's admin
client not working against the emulator's plain-HTTP management API at all — see
`README.md`'s Architecture section for why that's necessary and how it works.

## Milestones

| # | Milestone | Highlights |
|---|---|---|
| 0 | Emulator connectivity spike | Found the admin-client HTTPS gap before committing to the architecture around it. |
| 1 | Integration test harness | Real two-container (emulator + SQL Server) Docker Compose stack, Vitest `globalSetup` orchestration. |
| 2 | Electron app shell | Scaffolded from the real official `electron-vite` template rather than hand-written; `contextIsolation`/`sandbox`/no-`nodeIntegration` from day one. |
| 3 | Persistence + connections | SQLite via `better-sqlite3` (its Electron-ABI concern turned out to be a non-issue — N-API is ABI-stable); connection profile CRUD + connect/disconnect. |
| 4 | Entity CRUD | Found and worked around a real emulator bug: update calls throw a client-side parse error even though they succeed server-side. |
| 5 | Rules/filters | SQL and correlation filter rules; confirmed every new subscription gets an auto-created `$Default` rule. |
| 6 | Messaging | Monaco-based message composer; the first genuinely *stateful* service in the app (PeekLock settlement requires the same message/receiver across separate IPC calls). |
| 7 | Purge | The app's first push-event IPC pattern (progress streamed from main to renderer); found the emulator has no working queue-stats API at all. |
| 8 | DLQ inspect + replay | Confirmed a DLQ's address is just the entity path plus a fixed suffix — zero new plumbing needed in the messaging or purge services. |
| 9 | Polish | Logging, window-state persistence (with a proactive fix for windows stranded on disconnected monitors), and a verified unpacked build. |
| 10 | shadcn/ui restyle | Replaced the unstyled renderer with shadcn/ui (Radix primitives + Tailwind CSS v4) and a fixed dark theme; the shadcn CLI couldn't handle this repo's layout, so every component was hand-authored from the standard source instead. |

## Current status

All planned functionality is built, tested, and verified against the real emulator:

- **45 unit tests** — pure logic and service-lifecycle behavior (filter/envelope helpers,
  purge-completion + cap reporting, window-state parsing, connection-string building, IPC
  request schemas, PeekLock receiver lifecycle, and connect-race handling), no Docker
  required.
- **32 integration tests** — every service's real operations against a real running
  emulator container, covering create/update/delete for all entity types, rule CRUD,
  send/peek/receive round-trips and PeekLock-vs-ReceiveAndDelete semantics, purge-to-empty,
  and dead-letter-then-resubmit.
- A verified unpacked build (`npm run build:unpacked`), actually launched and driven —
  not just produced — confirming window-state persistence survives a real relaunch.

## Post-review hardening pass

After the milestones, an adversarial review drove a round of fixes (see
`.claude/agents/adversarial-reviewer.md` for the reviewer definition). All findings were
addressed:

- **Receiver lifecycle** — PeekLock receivers are now released on every path (empty
  receive, error, and concurrent settlement), via per-receiver reference counting rather
  than rescanning the handle map; this closes both a leak and a settle-vs-close race.
- **Connect races** — concurrent `connect()` calls for one profile now share a single
  in-flight attempt, and all per-connection resources are cleaned up if the attempt fails.
- **IPC input validation** — every channel payload is validated against a zod schema at the
  main-process boundary before any service runs (`src/shared/ipc-schemas.ts`).
- **Purge safety-cap reporting**, **destroyed-window send guards**, **at-least-once resubmit
  clarity**, and an **`openExternal` scheme allowlist + `will-navigate` guard**.
- **A real lint gate** — Biome (ESLint's `typescript-eslint` doesn't yet support this
  project's TypeScript 7).

There is no mandated next step. One small, non-blocking follow-up remains genuinely
optional: trimming Monaco's bundle to only the languages actually used.
