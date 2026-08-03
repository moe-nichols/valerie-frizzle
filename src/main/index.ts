import { app, shell, screen, BrowserWindow } from 'electron'
import { join } from 'node:path'
import log from 'electron-log/main'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc/register'
import { createDatabase } from './services/db/database'
import { ProfilesRepo } from './services/db/profilesRepo'
import { PreferencesRepo } from './services/db/preferencesRepo'
import { ConnectionManager } from './services/connectionManager'
import { loadWindowState, saveWindowState } from './services/windowState'

// Main-process-only: renderer errors already surface in devtools during dev, and wiring
// electron-log's renderer transport would mean an extra preload script injected into
// every session (`{ preload: true }`'s default) on top of our own — not worth it for a
// personal tool. File location is OS-default (e.g. ~/Library/Logs/<app>/main.log on
// macOS), which matters most for a packaged build run with no attached terminal.
log.initialize({ preload: false })

/** Only http(s) URLs are safe to hand to the OS's default browser via shell.openExternal;
 * everything else (file:, mailto:, custom app schemes) can trigger arbitrary local
 * handlers, so it's rejected. */
function isSafeExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function createWindow(preferencesRepo: PreferencesRepo): BrowserWindow {
  const displayBounds = screen.getAllDisplays().map((display) => display.bounds)
  const windowState = loadWindowState(preferencesRepo, displayBounds)

  const mainWindow = new BrowserWindow({
    ...windowState,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // Debounced — resize/move fire continuously while dragging, and only the settled
  // final bounds are worth a synchronous SQLite write.
  let saveTimer: NodeJS.Timeout | undefined
  const scheduleSave = (): void => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveWindowState(preferencesRepo, mainWindow), 500)
  }
  mainWindow.on('resize', scheduleSave)
  mainWindow.on('move', scheduleSave)
  mainWindow.on('close', () => {
    clearTimeout(saveTimer)
    saveWindowState(preferencesRepo, mainWindow)
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Never open a window in-app; hand only http(s) URLs to the OS browser and drop anything
  // else (file:, custom schemes, etc.) — an unbounded openExternal is a launch sink even
  // with trusted, CSP-restricted renderer content.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isSafeExternalUrl(details.url)) {
      shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  // Defense in depth: the renderer should only ever live at its own origin. Block any
  // attempt to navigate the top-level frame elsewhere, opening off-origin http(s) links in
  // the external browser instead.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault()
      if (isSafeExternalUrl(url)) {
        shell.openExternal(url)
      }
    }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })

  let db: ReturnType<typeof createDatabase>
  try {
    db = createDatabase(join(app.getPath('userData'), 'app.db'))
  } catch (err) {
    // The only startup failure realistically worth a dedicated log — every later
    // failure goes through toResult() and is already logged there. A packaged build run
    // with no attached terminal would otherwise fail silently with zero trace.
    log.error('Failed to open the local database — exiting', err)
    app.exit(1)
    throw err
  }
  const profilesRepo = new ProfilesRepo(db)
  const preferencesRepo = new PreferencesRepo(db)
  const connectionManager = new ConnectionManager(profilesRepo)

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.sbemulatormanager.app')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    registerIpcHandlers(profilesRepo, preferencesRepo, connectionManager)
    createWindow(preferencesRepo)
    log.info('app ready')

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(preferencesRepo)
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('will-quit', async (event) => {
    event.preventDefault()
    log.info('app quitting')
    await connectionManager.disconnectAll()
    db.close()
    app.exit()
  })
}
