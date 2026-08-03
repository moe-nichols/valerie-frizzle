# SB Emulator Manager

A personal desktop GUI for managing a locally-running **Azure Service Bus emulator**
(Microsoft's official Docker-based emulator). This targets the emulator only — not real
Azure, and not other brokers (Kafka, RabbitMQ, etc).

This is a personal tool: no installer, code signing, or auto-update by design.

## Features

- **Multiple simultaneous connections** — save any number of connection profiles and
  have several connected at once; switch between them from the sidebar without losing
  the others' state.
- **Sidebar-nested queue/topic/subscription browsing** — queues and topics live as
  expandable children of their connection; selecting one opens a detail panel with that
  entity's status and actions, including subscriptions (and their SQL/correlation
  filter rules) for topics.
- **Auto-refreshing entity list and message counts** — the sidebar and detail panels
  poll the emulator on a configurable interval, so queues/topics deleted outside the
  app disappear from the UI automatically, and each queue/subscription shows how many
  messages are currently sitting in it.
- **Configurable poll rate** — set from a Settings dialog (gear icon in the sidebar
  footer) and persisted across restarts.
- **Sending messages** — text/JSON/XML bodies with custom broker properties
  (content type, label, correlation ID, TTL, application properties) via a Monaco-based
  editor.
- **Peeking and receiving** active messages, either non-destructively (PeekLock) or
  destructively (ReceiveAndDelete), with per-message Complete/Abandon/Dead-letter
  actions.
- **Purging** queues and their dead-letter sub-queues, with a peek-based confirmation
  count.
- **Inspecting, purging, and replaying dead-lettered messages** back to their
  originating queue or topic.
- **SQL and correlation filter rule management** for subscriptions.

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
derived from the connection string; see
[ARCHITECTURE.md](./ARCHITECTURE.md#admin-api-vs-messaging-api-and-the-https-proxy-workaround)
for why the two are independent.

## Development

```sh
npm run dev
npm run typecheck  # tsc against the node + web tsconfigs
npm run lint       # Biome (lint + format check)
npm run format     # Biome formatter, writes in place
```

Linting is Biome rather than ESLint: the project runs TypeScript 7, which
`typescript-eslint` does not yet support, whereas Biome's parser is independent of the
installed TypeScript version. Biome also formats the codebase (2-space indent, single
quotes, no semicolons); `npm run lint` fails on unformatted code, `npm run format` fixes
it. See `biome.json` for the (lightly tuned) rule set.

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

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the process model, the IPC contract, what
each main-process service and renderer component is responsible for, the emulator quirks
this app works around, and the key dependencies and why they're here.
