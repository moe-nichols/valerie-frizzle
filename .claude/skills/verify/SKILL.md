---
name: verify
description: Build, launch, and drive this Electron app end-to-end against the real dev emulator to verify a change at the UI surface.
---

# Verifying SB Emulator Manager end-to-end

## Build + emulator

```bash
npm run build                        # outputs out/main/index.js
docker compose -f docker/servicebus-emulator/docker-compose.yml up -d
curl -s http://localhost:5300/       # 200 = management API ready (can take ~60s cold)
```

Dev emulator ports: AMQP 5672, management 5300. Connection string:
`Endpoint=sb://localhost:5672;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;`

## Drive it

Write a throwaway `verify-driver.mjs` **at the repo root** (so `playwright-core`
resolves from the repo's node_modules; repo root is CJS but `.mjs` opts in to ESM) and
delete it afterward:

```js
import { _electron } from 'playwright-core'
const app = await _electron.launch({ args: ['out/main/index.js'] })
const window = await app.firstWindow()
```

Launching `out/main/index.js` directly resolves `userData` to
`~/Library/Application Support/Electron/` (generic), NOT the app's real dir — see
ARCHITECTURE.md. Profiles created by drivers accumulate there; clean with
`sqlite3 ~/Library/Application\ Support/Electron/app.db "DELETE FROM connection_profiles WHERE name LIKE 'verify-%'"`.

## Locator gotchas (cost real debugging time)

- Panel titles are shadcn `CardTitle` **divs**, not headings — use
  `window.locator('[data-slot="card-title"]', { hasText: name })`, never `getByRole('heading')`.
- Add-connection: sidebar `+` has sr-only "Add connection"; dialog submit is **"Add profile"**;
  labels are "Name" / "Connection string" / "Management port".
- Add-queue/topic dialog submit button has the same text as the opener ("Add queue") — use `.last()`.
- Message rows: assert on per-row `View` buttons (`getByRole('button', { name: 'View' }).count()`),
  not body text. Peek can lag a beat behind send — retry the Peek click a few times.
- Purge confirm button is `Yes, purge N`; terminal state renders literal text `(done)`.
- The Monaco body editor is reachable via `getByTestId('message-body-editor')`, then
  `click()` + `window.keyboard.type(...)`.

## Flows worth driving

- Connect → create two queues → send to A → peek → switch to B (browser must reset).
- Purge a small queue: the `(done)` state must appear (exercises the preload
  purge-progress buffering).
- `await app.close()` then check `app.process()` exit code is 0 with a live connection
  (exercises the will-quit cleanup path).

## Cleanup

Delete driver-created `verify-*` queues server-side (they outlive the app session). A
root-level throwaway `.ts` run with `node --experimental-transform-types` can import
`./src/main/services/adminHttpsProxy.ts` (extension required) to get an admin client.
Leave the dev emulator containers as you found them.
