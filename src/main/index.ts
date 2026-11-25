import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  desktopCapturer,
  screen,
  session,
  safeStorage
} from 'electron'
import fs from 'node:fs'
import { join } from 'path'
import {
  IPC_CHANNELS,
  ScreenSourceInfo,
  TranscriptPayload,
  ShortcutRegistrationReport
} from '../types/ipc'
import {
  HudBounds,
  HudSettings,
  ShortcutBinding,
  DEFAULT_SHORTCUT_BINDINGS,
  ShortcutActionId
} from '../types/settings'

// Enable native macOS CoreAudio Process Tap & ScreenCaptureKit system audio loopback
// in Electron 45+ before Chromium initializes audio/media subsystems.
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch(
    'enable-features',
    'MacCatapLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride'
  )
}

let mainWindow: BrowserWindow | null = null
let hudWindow: BrowserWindow | null = null

function sendToMain(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

function sendToHud(channel: string, ...args: unknown[]): void {
  if (hudWindow && !hudWindow.isDestroyed()) {
    hudWindow.webContents.send(channel, ...args)
  }
}

function getSessionVaultPath(): string {
  return join(app.getPath('userData'), 'dualai-session.vault')
}

function hardenBrowserWindow(win: BrowserWindow): void {
  // Prevent untrusted navigation out of the Electron app origin
  win.webContents.on('will-navigate', (event, targetUrl) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    const isAllowed =
      targetUrl.startsWith('file://') || (devUrl ? targetUrl.startsWith(devUrl) : false)
    if (!isAllowed) {
      event.preventDefault()
    }
  })

  // Lock down DevTools in packaged production builds
  if (app.isPackaged) {
    win.webContents.on('devtools-opened', () => {
      win.webContents.closeDevTools()
    })
    win.webContents.on('before-input-event', (event, input) => {
      const isDevToolsShortcut =
        input.key === 'F12' ||
        ((input.control || input.meta) &&
          (input.shift || input.alt) &&
          input.key.toLowerCase() === 'i')
      if (isDevToolsShortcut) {
        event.preventDefault()
      }
    })
  }
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 580,
    show: false,
    autoHideMenuBar: true,
    title: 'DualAI - Professional Interpretation Engine',
    backgroundColor: '#09090b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })

  hardenBrowserWindow(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    if (hudWindow && !hudWindow.isDestroyed()) {
      hudWindow.close()
      hudWindow = null
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * Day 10: Module 3 Teleprompter & Floating Overlay HUD Window
 * Frameless, transparent, alwaysOnTop above full-screen Zoom/Teams/Meet windows.
 */
function createHudWindow(initialBounds?: HudBounds): BrowserWindow {
  if (hudWindow && !hudWindow.isDestroyed()) {
    hudWindow.showInactive()
    return hudWindow
  }

  const primaryDisplay = screen.getPrimaryDisplay()
  const workArea = primaryDisplay.workArea

  const width = Math.max(380, Math.min(workArea.width, initialBounds?.width ?? 760))
  const height = Math.max(120, Math.min(workArea.height, initialBounds?.height ?? 220))
  const defaultX = Math.round(workArea.x + (workArea.width - width) / 2)
  const defaultY = Math.round(workArea.y + 60)

  const x =
    typeof initialBounds?.x === 'number'
      ? Math.max(workArea.x - 100, Math.min(workArea.x + workArea.width - 120, initialBounds.x))
      : defaultX
  const y =
    typeof initialBounds?.y === 'number'
      ? Math.max(workArea.y, Math.min(workArea.y + workArea.height - 80, initialBounds.y))
      : defaultY

  hudWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 380,
    minHeight: 110,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    movable: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })

  hardenBrowserWindow(hudWindow)

  // Guarantee HUD floats above full-screen Zoom, Teams, and Meet windows without minimizing
  hudWindow.setAlwaysOnTop(true, 'screen-saver')
  if (typeof hudWindow.setVisibleOnAllWorkspaces === 'function') {
    hudWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  const emitBounds = (): void => {
    if (!hudWindow || hudWindow.isDestroyed()) return
    const bounds = hudWindow.getBounds()
    sendToMain(IPC_CHANNELS.HUD_BOUNDS_CHANGED, bounds)
  }

  hudWindow.on('moved', emitBounds)
  hudWindow.on('resized', emitBounds)

  hudWindow.on('closed', () => {
    hudWindow = null
    sendToMain(IPC_CHANNELS.HUD_STATUS_CHANGED, false)
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    hudWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?view=hud`)
  } else {
    hudWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'hud' })
  }

  sendToMain(IPC_CHANNELS.HUD_STATUS_CHANGED, true)
  return hudWindow
}

function mapActionToChannel(actionId: ShortcutActionId): string {
  switch (actionId) {
    case 'ptt':
      return IPC_CHANNELS.SHORTCUT_PTT_TOGGLE
    case 'mute':
      return IPC_CHANNELS.SHORTCUT_MUTE_TOGGLE
    case 'swap':
      return IPC_CHANNELS.SHORTCUT_SWAP_LANGUAGES
    case 'hudToggle':
      return IPC_CHANNELS.SHORTCUT_TOGGLE_HUD
    case 'clearBuffer':
      return IPC_CHANNELS.SHORTCUT_CLEAR_BUFFER
  }
}

function registerGlobalShortcuts(
  bindings: ShortcutBinding[] = DEFAULT_SHORTCUT_BINDINGS
): ShortcutRegistrationReport {
  globalShortcut.unregisterAll()

  const registered: string[] = []
  const failed: string[] = []

  for (const binding of bindings) {
    if (!binding.isGlobal || !binding.accelerator) continue
    const targetChannel = mapActionToChannel(binding.id)

    try {
      const ok = globalShortcut.register(binding.accelerator, () => {
        sendToMain(targetChannel)
        if (binding.id === 'clearBuffer') {
          sendToHud(targetChannel)
        }
      })

      if (ok) {
        registered.push(binding.id)
      } else {
        failed.push(binding.id)
      }
    } catch {
      failed.push(binding.id)
    }
  }

  // Always preserve Screen Snipping global shortcut (Day 12 preparation)
  try {
    globalShortcut.register('CommandOrControl+Shift+X', () => {
      sendToMain(IPC_CHANNELS.SHORTCUT_TRIGGER_SNIP)
    })
  } catch {
    // Ignore if already claimed by OS
  }

  return { registered, failed }
}

function registerIpcHandlers(): void {
  // Window Controls
  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    mainWindow?.minimize()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, () => {
    mainWindow?.close()
  })

  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, async (): Promise<boolean> => {
    return mainWindow?.isMaximized() ?? false
  })

  // Hardware Audio & Screen Capture Sources
  ipcMain.handle(IPC_CHANNELS.AUDIO_GET_SOURCES, async (): Promise<ScreenSourceInfo[]> => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 1280, height: 720 }
    })
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnailDataUrl: s.thumbnail.toDataURL(),
      displayId: s.display_id
    }))
  })

  // Secondary Floating HUD Window Handlers (Day 10)
  ipcMain.handle(
    IPC_CHANNELS.HUD_OPEN,
    async (_event, initialBounds?: HudBounds): Promise<boolean> => {
      createHudWindow(initialBounds)
      return true
    }
  )

  ipcMain.handle(IPC_CHANNELS.HUD_CLOSE, async (): Promise<void> => {
    if (hudWindow && !hudWindow.isDestroyed()) {
      hudWindow.close()
      hudWindow = null
    }
    sendToMain(IPC_CHANNELS.HUD_STATUS_CHANGED, false)
  })

  ipcMain.handle(IPC_CHANNELS.HUD_IS_OPEN, async (): Promise<boolean> => {
    return Boolean(hudWindow && !hudWindow.isDestroyed())
  })

  ipcMain.handle(IPC_CHANNELS.HUD_SET_OPACITY, async (_event, opacity: number): Promise<void> => {
    // Keep window alive even at 0% zinc background opacity; CSS handles background alpha cleanly
    if (hudWindow && !hudWindow.isDestroyed()) {
      hudWindow.setOpacity(Math.max(0.15, Math.min(1.0, opacity)))
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.HUD_SET_CLICK_THROUGH,
    async (_event, enabled: boolean): Promise<void> => {
      if (hudWindow && !hudWindow.isDestroyed()) {
        hudWindow.setIgnoreMouseEvents(enabled, { forward: true })
      }
    }
  )

  ipcMain.on(IPC_CHANNELS.HUD_UPDATE_TRANSCRIPT, (_event, payload: TranscriptPayload) => {
    sendToHud(IPC_CHANNELS.HUD_UPDATE_TRANSCRIPT, payload)
  })

  ipcMain.on(IPC_CHANNELS.HUD_UPDATE_CONFIG, (event, config: HudSettings) => {
    if (hudWindow && !hudWindow.isDestroyed() && event.sender !== hudWindow.webContents) {
      sendToHud(IPC_CHANNELS.HUD_UPDATE_CONFIG, config)
    }
    if (mainWindow && !mainWindow.isDestroyed() && event.sender !== mainWindow.webContents) {
      sendToMain(IPC_CHANNELS.HUD_UPDATE_CONFIG, config)
    }
  })

  // Dynamic Global Shortcuts Handler (Day 11)
  ipcMain.handle(
    IPC_CHANNELS.SHORTCUT_UPDATE_BINDINGS,
    async (_event, bindings: ShortcutBinding[]): Promise<ShortcutRegistrationReport> => {
      return registerGlobalShortcuts(bindings)
    }
  )

  // Zero-Trust OS Keychain Encrypted Session Vault (Electron safeStorage)
  ipcMain.handle(
    IPC_CHANNELS.AUTH_STORE_SESSION,
    async (_event, serializedSession: string): Promise<boolean> => {
      try {
        if (!safeStorage.isEncryptionAvailable()) {
          return false
        }
        const encrypted = safeStorage.encryptString(serializedSession)
        fs.writeFileSync(getSessionVaultPath(), encrypted, { mode: 0o600 })
        return true
      } catch {
        return false
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.AUTH_LOAD_SESSION, async (): Promise<string | null> => {
    try {
      const vaultPath = getSessionVaultPath()
      if (!fs.existsSync(vaultPath) || !safeStorage.isEncryptionAvailable()) {
        return null
      }
      const encrypted = fs.readFileSync(vaultPath)
      return safeStorage.decryptString(encrypted)
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC_CHANNELS.AUTH_CLEAR_SESSION, async (): Promise<boolean> => {
    try {
      const vaultPath = getSessionVaultPath()
      if (fs.existsSync(vaultPath)) {
        fs.unlinkSync(vaultPath)
      }
      return true
    } catch {
      return false
    }
  })
}

/**
 * Enforce strict Content-Security-Policy (CSP) blocking unauthorized external origins.
 * Upstream provider APIs (Deepgram, Google Gemini) are intentionally excluded so the
 * desktop renderer can ONLY communicate with the Zero-Trust DualAI Gateway and Supabase Auth.
 */
function registerSecurityHeaders(): void {
  const isDev = Boolean(process.env['ELECTRON_RENDERER_URL'])
  const connectSources = isDev
    ? "'self' http://127.0.0.1:8787 ws://127.0.0.1:8787 http://localhost:8787 ws://localhost:8787 ws://localhost:5173 https://*.supabase.co blob: data:"
    : "'self' https://*.universalaisync.com wss://*.universalaisync.com https://*.dualai.app wss://*.dualai.app https://*.supabase.co blob: data:"

  const scriptSources = isDev
    ? "'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:"
    : "'self' 'wasm-unsafe-eval' blob:"

  const cspHeader = [
    "default-src 'self'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    `connect-src ${connectSources}`,
    "object-src 'none'",
    "frame-ancestors 'none'"
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [cspHeader]
      }
    })
  })
}

/**
 * Configure Chromium media permissions and native system audio loopback handler
 * for navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).
 * Supports Windows WASAPI loopback and macOS CoreAudio Tap / ScreenCaptureKit loopback.
 */
function registerMediaAndLoopbackHandlers(): void {
  const defaultSes = session.defaultSession

  defaultSes.setPermissionCheckHandler((_webContents, permission) => {
    if (permission === 'media' || permission === 'display-capture') {
      return true
    }
    return false
  })

  defaultSes.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media' || permission === 'display-capture') {
      callback(true)
    } else {
      callback(false)
    }
  })

  defaultSes.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1, height: 1 }
      })
      const primaryScreen = sources[0]

      if (!primaryScreen) {
        callback({})
        return
      }

      callback({
        video: primaryScreen,
        audio: 'loopback'
      })
    } catch (err) {
      console.error('[DUALAI-MAIN] Native system audio loopback handler error:', err)
      callback({})
    }
  })
}

app.whenReady().then(() => {
  registerSecurityHeaders()
  registerMediaAndLoopbackHandlers()
  registerIpcHandlers()
  registerGlobalShortcuts(DEFAULT_SHORTCUT_BINDINGS)
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
