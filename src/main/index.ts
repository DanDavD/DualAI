import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  desktopCapturer,
  screen,
  session,
  safeStorage,
  Menu
} from 'electron'
import fs from 'node:fs'
import http from 'node:http'
import crypto from 'node:crypto'
import { join } from 'path'
import {
  IPC_CHANNELS,
  ScreenSourceInfo,
  TranscriptPayload,
  ShortcutRegistrationReport,
  OAuthPreparedSession,
  OAuthCallbackResult,
  ClientTelemetryPayload
} from '../types/ipc'
import {
  HudBounds,
  HudSettings,
  ShortcutBinding,
  DEFAULT_SHORTCUT_BINDINGS,
  ShortcutActionId
} from '../types/settings'
import {
  setOsMicrophoneMute,
  getOsMicrophoneMute,
  restoreOsMicrophoneOnQuit
} from './systemMicMute'

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
  const isMac = process.platform === 'darwin'
  const isWin = process.platform === 'win32'

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 420,
    minHeight: 340,
    show: false,
    autoHideMenuBar: true,
    title: 'DualAI - Professional Interpretation Engine',
    backgroundColor: isMac ? '#00000000' : '#111114',
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 16, y: 19 },
          vibrancy: 'under-window' as const,
          visualEffectState: 'active' as const,
          transparent: true
        }
      : isWin
        ? {
            titleBarStyle: 'hidden' as const,
            titleBarOverlay: {
              color: '#00000000',
              symbolColor: '#f4f4f5',
              height: 54
            }
          }
        : {}),
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
  const targetDisplay =
    typeof initialBounds?.x === 'number' && typeof initialBounds?.y === 'number'
      ? screen.getDisplayNearestPoint({ x: initialBounds.x, y: initialBounds.y }) || primaryDisplay
      : primaryDisplay
  const workArea = targetDisplay.workArea

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
    minWidth: 320,
    minHeight: 100,
    show: false,
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
  hudWindow.once('ready-to-show', () => {
    hudWindow?.showInactive()
  })

  // Guarantee HUD floats above full-screen Zoom, Teams, and Meet windows without minimizing
  hudWindow.setAlwaysOnTop(true, 'screen-saver')
  if (process.platform === 'darwin' && typeof hudWindow.setVisibleOnAllWorkspaces === 'function') {
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
        if (enabled) {
          hudWindow.setIgnoreMouseEvents(true, { forward: true })
        } else {
          hudWindow.setIgnoreMouseEvents(false)
        }
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
        const vaultPath = getSessionVaultPath()
        const tmpPath = `${vaultPath}.tmp`
        fs.writeFileSync(tmpPath, encrypted, { mode: 0o600 })
        fs.renameSync(tmpPath, vaultPath)
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

  // In-app Paddle checkout: modal child window hosting the Paddle overlay on the approved domain.
  // Uses an isolated session so the app-wide CSP (frame-ancestors 'none') does not apply to it.
  const CHECKOUT_ALLOWED_HOSTS = new Set(['dualai.universalaisync.com'])
  let checkoutWindow: BrowserWindow | null = null

  ipcMain.handle(IPC_CHANNELS.CHECKOUT_OPEN, async (_event, rawUrl: string): Promise<boolean> => {
    try {
      const parsed = new URL(String(rawUrl))
      if (
        parsed.protocol !== 'https:' ||
        !CHECKOUT_ALLOWED_HOSTS.has(parsed.hostname) ||
        !parsed.pathname.startsWith('/checkout')
      ) {
        return false
      }
      if (checkoutWindow && !checkoutWindow.isDestroyed()) {
        checkoutWindow.close()
      }
      let completed = false
      const win = new BrowserWindow({
        width: 520,
        height: 780,
        parent: mainWindow ?? undefined,
        modal: Boolean(mainWindow),
        show: false,
        title: 'DualAI Checkout',
        backgroundColor: '#0b0d12',
        autoHideMenuBar: true,
        minimizable: false,
        maximizable: false,
        webPreferences: {
          partition: 'persist:dualai-checkout',
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true
        }
      })
      checkoutWindow = win
      if (process.platform !== 'darwin') {
        win.removeMenu()
      }
      win.setMenuBarVisibility(false)
      win.once('ready-to-show', () => win.show())
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      win.webContents.on('did-fail-load', () => {
        if (!win.isDestroyed()) {
          win.destroy()
        }
      })
      const onNav = (_e: unknown, navUrl: string): void => {
        try {
          const u = new URL(navUrl)
          if (u.hostname !== 'dualai.universalaisync.com') return
          if (u.pathname.startsWith('/checkout/success')) {
            completed = true
            setTimeout(() => !win.isDestroyed() && win.close(), 1800)
          } else if (u.pathname.startsWith('/checkout/closed')) {
            if (!win.isDestroyed()) win.close()
          }
        } catch {
          // ignore malformed URL
        }
      }
      win.webContents.on('did-navigate', onNav)
      win.on('closed', () => {
        checkoutWindow = null
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.CHECKOUT_CLOSED, completed)
        }
      })
      await win.loadURL(parsed.toString())
      return true
    } catch {
      // Prevent permanent Win32 modal parent deadlock if loadURL fails before ready-to-show
      if (checkoutWindow && !checkoutWindow.isDestroyed()) {
        checkoutWindow.destroy()
      }
      checkoutWindow = null
      return false
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

  // Native Desktop OAuth (Google / Apple via RFC 8252 Local Loopback HTTP Server)
  interface PendingOAuthFlow {
    server: http.Server
    redirectUrl: string
    resolveCallback?: (result: OAuthCallbackResult) => void
    timeout?: NodeJS.Timeout
    settled: boolean
  }

  const pendingOAuthFlows = new Map<string, PendingOAuthFlow>()

  const renderOAuthHtml = (title: string, detail: string, isError = false): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>DualAI - ${title}</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #111114;
      color: rgba(255, 255, 255, 0.94);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .card {
      max-width: 380px;
      padding: 28px 32px;
      border-radius: 22px;
      background: rgba(26, 26, 31, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 24px 64px rgba(0, 0, 0, 0.65);
      text-align: center;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      margin: 0 auto 14px;
      background: ${isError ? '#ff453a' : '#30d158'};
    }
    h1 { margin: 0 0 8px; font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
    p { margin: 0; font-size: 13px; line-height: 1.5; color: rgba(255, 255, 255, 0.62); }
  </style>
</head>
<body>
  <div class="card">
    <div class="dot"></div>
    <h1>${title}</h1>
    <p>${detail}</p>
  </div>
</body>
</html>`

  const renderOAuthHashRelayHtml = (): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>DualAI - Completing Sign In</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #111114;
      color: rgba(255, 255, 255, 0.94);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
    }
    .card {
      max-width: 380px;
      padding: 28px 32px;
      border-radius: 22px;
      background: rgba(26, 26, 31, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.12);
      text-align: center;
    }
    h1 { margin: 0 0 8px; font-size: 17px; font-weight: 600; }
    p { margin: 0; font-size: 13px; color: rgba(255, 255, 255, 0.62); }
  </style>
</head>
<body>
  <div class="card">
    <h1 id="t">Completing sign in...</h1>
    <p id="d">Returning you to DualAI.</p>
  </div>
  <script>
    (function () {
      var hash = window.location.hash ? window.location.hash.slice(1) : '';
      fetch('/auth/callback/hash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: hash
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          document.getElementById('t').textContent = res.ok ? 'Signed in to DualAI' : 'Sign in failed';
          document.getElementById('d').textContent = res.ok
            ? 'You can close this tab and return to DualAI.'
            : (res.error || 'Please try signing in again from DualAI.');
        })
        .catch(function () {
          document.getElementById('t').textContent = 'Sign in failed';
          document.getElementById('d').textContent = 'Could not reach DualAI. Please try again.';
        });
    })();
  </script>
</body>
</html>`

  const finishOAuthFlow = (sessionId: string, result: OAuthCallbackResult): void => {
    const flow = pendingOAuthFlows.get(sessionId)
    if (!flow || flow.settled) return
    flow.settled = true
    if (flow.timeout) clearTimeout(flow.timeout)
    pendingOAuthFlows.delete(sessionId)
    try {
      flow.server.close()
    } catch {
      // Ignore close errors
    }
    if (result.ok && mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      if (process.platform === 'win32') {
        mainWindow.setAlwaysOnTop(true)
        mainWindow.show()
        mainWindow.focus()
        mainWindow.setAlwaysOnTop(false)
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    }
    flow.resolveCallback?.(result)
  }

  ipcMain.handle(IPC_CHANNELS.AUTH_OAUTH_PREPARE, async (): Promise<OAuthPreparedSession> => {
    // Cancel any stale pending OAuth sessions before opening a fresh loopback listener
    for (const staleId of Array.from(pendingOAuthFlows.keys())) {
      finishOAuthFlow(staleId, { ok: false, error: 'Sign-in was superseded by a new attempt.' })
    }

    const sessionId = crypto.randomUUID()

    return new Promise<OAuthPreparedSession>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const reqUrl = new URL(req.url || '/', 'http://127.0.0.1')

        if (req.method === 'GET' && reqUrl.pathname === '/auth/callback') {
          const code = reqUrl.searchParams.get('code')
          const errorParam =
            reqUrl.searchParams.get('error_description') || reqUrl.searchParams.get('error')

          if (errorParam) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(renderOAuthHtml('Sign in canceled', errorParam, true))
            finishOAuthFlow(sessionId, { ok: false, error: errorParam })
            return
          }

          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(
              renderOAuthHtml(
                'Signed in to DualAI',
                'Authentication complete. You can close this tab and return to DualAI.'
              )
            )
            finishOAuthFlow(sessionId, { ok: true, code })
            return
          }

          // Fallback for implicit hash-fragment callbacks (#access_token=...)
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(renderOAuthHashRelayHtml())
          return
        }

        if (req.method === 'POST' && reqUrl.pathname === '/auth/callback/hash') {
          let body = ''
          req.on('data', (chunk) => {
            body += String(chunk)
            if (body.length > 16384) req.destroy()
          })
          req.on('end', () => {
            const params = new URLSearchParams(body)
            const accessToken = params.get('access_token') || undefined
            const refreshToken = params.get('refresh_token') || undefined
            const errorParam =
              params.get('error_description') || params.get('error') || undefined

            if (errorParam) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: errorParam }))
              finishOAuthFlow(sessionId, { ok: false, error: errorParam })
              return
            }

            if (accessToken) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: true }))
              finishOAuthFlow(sessionId, { ok: true, accessToken, refreshToken })
              return
            }

            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Missing authentication credentials.' }))
            finishOAuthFlow(sessionId, {
              ok: false,
              error: 'No authentication token was returned by the provider.'
            })
          })
          return
        }

        res.writeHead(404)
        res.end('Not Found')
      })

      server.on('error', (err) => {
        reject(err)
      })

      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') {
          server.close()
          reject(new Error('Failed to bind local OAuth callback port.'))
          return
        }
        const redirectUrl = `http://127.0.0.1:${address.port}/auth/callback`
        pendingOAuthFlows.set(sessionId, {
          server,
          redirectUrl,
          settled: false
        })
        resolve({ sessionId, redirectUrl })
      })
    })
  })

  ipcMain.handle(
    IPC_CHANNELS.AUTH_OAUTH_LAUNCH_AND_WAIT,
    async (_event, sessionId: string, rawAuthUrl: string): Promise<OAuthCallbackResult> => {
      const flow = pendingOAuthFlows.get(sessionId)
      if (!flow) {
        return { ok: false, error: 'OAuth session expired. Please try again.' }
      }

      try {
        const parsed = new URL(String(rawAuthUrl))
        if (parsed.protocol !== 'https:') {
          finishOAuthFlow(sessionId, { ok: false, error: 'Invalid OAuth URL protocol.' })
          return { ok: false, error: 'Invalid OAuth URL protocol.' }
        }

        const waitPromise = new Promise<OAuthCallbackResult>((resolve) => {
          flow.resolveCallback = resolve
          flow.timeout = setTimeout(() => {
            finishOAuthFlow(sessionId, {
              ok: false,
              error: 'Sign-in timed out. Please try again.'
            })
          }, 180_000)
        })

        await shell.openExternal(parsed.toString())
        return await waitPromise
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to launch browser for sign-in.'
        finishOAuthFlow(sessionId, { ok: false, error: msg })
        return { ok: false, error: msg }
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.AUTH_OAUTH_CANCEL, async (_event, sessionId: string): Promise<void> => {
    finishOAuthFlow(sessionId, { ok: false, error: 'Sign-in canceled.' })
  })

  // OS-Wide System Microphone Mute (for call hold/silence — DualAI never captures mic audio)
  ipcMain.handle(
    IPC_CHANNELS.AUDIO_SET_SYSTEM_MIC_MUTE,
    async (_event, muted: boolean) => {
      return setOsMicrophoneMute(Boolean(muted))
    }
  )

  ipcMain.handle(IPC_CHANNELS.AUDIO_GET_SYSTEM_MIC_MUTE, async () => {
    return getOsMicrophoneMute()
  })

  // Zero-PII client telemetry writer (development diagnostic mode only — works even with Fly.io Gateway)
  ipcMain.on(IPC_CHANNELS.TELEMETRY_RECORD_SESSION, (_event, payload: ClientTelemetryPayload) => {
    if (app.isPackaged || !payload || typeof payload.sessionId !== 'string') return
    try {
      const telemetryDir = join(app.getAppPath(), 'server', '.telemetry')
      if (!fs.existsSync(telemetryDir)) {
        fs.mkdirSync(telemetryDir, { recursive: true })
      }
      if (payload.status === 'closed') {
        const jsonlPath = join(telemetryDir, 'client_soniox_usage.jsonl')
        fs.appendFileSync(jsonlPath, `${JSON.stringify(payload)}\n`, 'utf-8')
        const activePath = join(telemetryDir, 'client_active_session.json')
        if (fs.existsSync(activePath)) {
          fs.unlinkSync(activePath)
        }
      } else {
        const activePath = join(telemetryDir, 'client_active_session.json')
        fs.writeFileSync(activePath, JSON.stringify(payload, null, 2), 'utf-8')
      }
    } catch {
      // Non-fatal diagnostic write
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
    ? "'self' http://127.0.0.1:8787 ws://127.0.0.1:8787 http://localhost:8787 ws://localhost:8787 ws://localhost:5173 https://*.fly.dev wss://*.fly.dev https://*.supabase.co https://*.paddle.com https://api.paddle.com https://buy.paddle.com blob: data:"
    : "'self' https://*.universalaisync.com wss://*.universalaisync.com https://*.dualai.app wss://*.dualai.app https://*.fly.dev wss://*.fly.dev https://*.supabase.co https://*.paddle.com https://api.paddle.com https://buy.paddle.com blob: data:"

  const scriptSources = isDev
    ? "'self' 'unsafe-inline' 'wasm-unsafe-eval' https://*.paddle.com https://cdn.paddle.com blob:"
    : "'self' 'wasm-unsafe-eval' https://*.paddle.com https://cdn.paddle.com blob:"

  const cspHeader = [
    "default-src 'self'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.paddle.com",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "frame-src 'self' https://*.paddle.com https://buy.paddle.com https://checkout.paddle.com",
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

if (process.platform === 'win32') {
  app.setAppUserModelId('com.universalaisync.dualai')
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    if (process.platform !== 'darwin') {
      Menu.setApplicationMenu(null)
    }
    registerSecurityHeaders()
    registerMediaAndLoopbackHandlers()
    registerIpcHandlers()
    registerGlobalShortcuts(DEFAULT_SHORTCUT_BINDINGS)
    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  restoreOsMicrophoneOnQuit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
