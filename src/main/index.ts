import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  desktopCapturer,
  screen
} from 'electron'
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
      sandbox: false,
      contextIsolation: true
    }
  })

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
      sandbox: false,
      contextIsolation: true
    }
  })

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
}

app.whenReady().then(() => {
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
